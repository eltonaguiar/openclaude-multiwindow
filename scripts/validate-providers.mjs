#!/usr/bin/env node
/**
 * validate-providers.mjs
 *
 * Free check: sends a GET /models (or HEAD /models) to each provider's base URL
 * to confirm reachability and key validity WITHOUT spending tokens.
 *
 * Paid deep check (--deep): sends a minimal 1-token completion to confirm
 * the model actually works end-to-end.
 *
 * Results are written to:
 *   .openclaude-providers.env         — working providers (KEY=VALUE lines, gitignore-safe)
 *   .openclaude-providers-broken.env  — broken providers (commented, with error)
 *
 * Usage:
 *   node scripts/validate-providers.mjs                  # free check (recommended first)
 *   node scripts/validate-providers.mjs --deep           # paid 1-token check
 *   node scripts/validate-providers.mjs --provider groq  # single provider
 *
 * Keys are read from openclaude.providerEnvOverrides in VS Code settings,
 * or from .openclaude-providers.env if it already exists.
 *
 * Keys are NEVER printed to stdout — only redacted forms (sk-...xxxx).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dir, '..');
const CATALOG = JSON.parse(readFileSync(join(ROOT, 'src/chat/providerCatalog.json'), 'utf8'));

const WORKING_FILE = join(ROOT, '.openclaude-providers.env');
const BROKEN_FILE  = join(ROOT, '.openclaude-providers-broken.env');

const args = process.argv.slice(2);
const DEEP = args.includes('--deep');
const _providerIdx = args.indexOf('--provider');
const SINGLE = _providerIdx !== -1 ? (args[_providerIdx + 1] || null) : null;

// ── Key resolution ──────────────────────────────────────────────────────────
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function loadVSCodeSettings() {
  const candidates = [
    join(process.env.APPDATA || '', 'Code/User/settings.json'),
    join(process.env.HOME || '', '.config/Code/User/settings.json'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, 'utf8');
      // Extract just the openclaude.providerEnvOverrides value using a targeted
      // approach. The full settings.json may contain regex strings with "//" that
      // defeat simple comment-stripping, so we carve out only what we need.
      const keyMatch = raw.match(/"openclaude\.providerEnvOverrides"\s*:\s*(\{)/);
      if (!keyMatch) continue;
      const start = raw.indexOf(keyMatch[1], raw.indexOf('"openclaude.providerEnvOverrides"'));
      let depth = 0, i = start, inStr = false, esc = false;
      for (; i < raw.length; i++) {
        const c = raw[i];
        if (esc) { esc = false; continue; }
        if (c === '\\' && inStr) { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
      }
      const slice = raw.slice(start, i);
      return JSON.parse(slice);
    } catch { /* ignore */ }
  }
  return {};
}

const savedEnv   = loadEnvFile(WORKING_FILE);
const vscodeOver = loadVSCodeSettings();

function getProviderEnv(provider) {
  // Priority: VS Code settings > saved .env file > actual process.env
  const over = vscodeOver[provider.id] || {};
  const env = {
    OPENAI_BASE_URL: over.OPENAI_BASE_URL || provider.baseUrl || savedEnv[`${provider.id.toUpperCase().replace(/-/g,'_')}_BASE_URL`] || '',
    OPENAI_API_KEY:  over.OPENAI_API_KEY  || savedEnv[`${provider.id.toUpperCase().replace(/-/g,'_')}_API_KEY`] || process.env.OPENAI_API_KEY || '',
  };
  return env;
}

function redact(key) {
  if (!key || key.length < 8) return '(not set)';
  return key.slice(0, 4) + '...' + key.slice(-4);
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
function httpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, { ...options, timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function freeCheck(provider, env) {
  if (!env.OPENAI_BASE_URL) return { ok: false, reason: 'no base URL configured' };
  if (!env.OPENAI_API_KEY)  return { ok: false, reason: 'no API key configured' };

  const url = env.OPENAI_BASE_URL.replace(/\/$/, '') + '/models';
  try {
    const res = await httpRequest(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, Accept: 'application/json' },
    });
    if (res.status === 200) {
      let models = [];
      try { models = JSON.parse(res.body).data?.map(m => m.id) || []; } catch { /* ignore */ }
      return { ok: true, reason: `${res.status} OK`, models };
    }
    if (res.status === 401) return { ok: false, reason: `401 Unauthorized — invalid API key` };
    if (res.status === 404) {
      // Some providers don't have /models but the key is valid (return ok with warning)
      return { ok: true, reason: `${res.status} /models not supported — key reachability unconfirmed` };
    }
    return { ok: false, reason: `HTTP ${res.status}: ${res.body.slice(0, 120)}` };
  } catch (e) {
    return { ok: false, reason: `Network error: ${e.message}` };
  }
}

async function deepCheck(provider, env, model) {
  if (!env.OPENAI_BASE_URL || !env.OPENAI_API_KEY) return { ok: false, reason: 'missing credentials' };

  const url = env.OPENAI_BASE_URL.replace(/\/$/, '') + '/chat/completions';
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Reply with exactly the single word: ok' }],
    max_tokens: 3,
    temperature: 0,
  });
  try {
    const res = await httpRequest(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);
    if (res.status === 200) return { ok: true, reason: '200 OK — tokens consumed' };
    return { ok: false, reason: `HTTP ${res.status}: ${res.body.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, reason: `Network error: ${e.message}` };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
const working = [];
const broken  = [];

const providers = CATALOG.filter(p => {
  if (!p.baseUrl) return false; // skip providers without a base URL (Anthropic direct, Bedrock, etc.)
  if (SINGLE && p.id !== SINGLE) return false;
  return true;
});

console.log(`\nOpenClaude Provider Validation — ${DEEP ? 'DEEP (paid)' : 'FREE'} check`);
console.log(`Checking ${providers.length} provider(s)...\n`);

for (const provider of providers) {
  const env = getProviderEnv(provider);
  process.stdout.write(`  ${provider.label.padEnd(30)} [key: ${redact(env.OPENAI_API_KEY)}] `);

  let result;
  if (DEEP) {
    const model = provider.defaultModel || (provider.models[0] && provider.models[0].id);
    result = await deepCheck(provider, env, model);
  } else {
    result = await freeCheck(provider, env);
  }

  if (result.ok) {
    console.log(`✓ ${result.reason}`);
    working.push({ provider, env, result });
  } else {
    console.log(`✗ ${result.reason}`);
    broken.push({ provider, env, result });
  }
}

// ── Write output files ────────────────────────────────────────────────────────
const workingLines = [
  '# openclaude working providers — auto-generated by validate-providers.mjs',
  '# DO NOT COMMIT — add to .gitignore',
  '',
  ...working.map(({ provider, env, result }) => [
    `# ${provider.label} — ${result.reason}`,
    `${provider.id.toUpperCase().replace(/-/g,'_')}_BASE_URL=${env.OPENAI_BASE_URL}`,
    `${provider.id.toUpperCase().replace(/-/g,'_')}_API_KEY=${env.OPENAI_API_KEY}`,
    ...(result.models ? [`# models: ${result.models.slice(0,8).join(', ')}`] : []),
    '',
  ].join('\n')),
].join('\n');

const brokenLines = [
  '# openclaude broken/unverified providers — auto-generated by validate-providers.mjs',
  '# Investigate and fix credentials, then re-run validate-providers.mjs',
  '',
  ...broken.map(({ provider, env, result }) => [
    `# ${provider.label} — BROKEN: ${result.reason}`,
    `# ${provider.id.toUpperCase().replace(/-/g,'_')}_BASE_URL=${env.OPENAI_BASE_URL || '(not configured)'}`,
    `# ${provider.id.toUpperCase().replace(/-/g,'_')}_API_KEY=${redact(env.OPENAI_API_KEY)}`,
    '',
  ].join('\n')),
].join('\n');

writeFileSync(WORKING_FILE, workingLines, 'utf8');
writeFileSync(BROKEN_FILE,  brokenLines,  'utf8');

console.log(`\nResults:`);
console.log(`  ✓ Working : ${working.length} → ${WORKING_FILE}`);
console.log(`  ✗ Broken  : ${broken.length}  → ${BROKEN_FILE}`);
if (!DEEP && broken.length > 0) {
  console.log(`\n  Run with --deep to do a paid 1-token verification of broken providers.`);
}
console.log('');
