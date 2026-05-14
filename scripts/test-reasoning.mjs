#!/usr/bin/env node
/**
 * test-reasoning.mjs
 *
 * Probes each provider's model for reasoning/thinking-related errors WITHOUT
 * requiring the full openclaude CLI. Sends raw OpenAI-compatible chat
 * completions to detect known failure modes:
 *
 *   PASS        — single-turn response OK
 *   THINKING    — single-turn works but returned reasoning_content field
 *                 (warns: will fail on turn 2 if re-sent as multi-turn history)
 *   MULTI_FAIL  — single-turn OK but multi-turn (2nd message) fails
 *   FAIL        — single-turn fails outright
 *
 * Results are printed to stdout. No tokens wasted beyond a 3-token cap per call.
 *
 * Usage:
 *   node scripts/test-reasoning.mjs                   # all providers with valid keys
 *   node scripts/test-reasoning.mjs --provider xai-direct
 *   node scripts/test-reasoning.mjs --multi           # also run multi-turn probe
 *
 * Keys are read from VS Code settings (openclaude.providerEnvOverrides) or
 * from .openclaude-providers.env. Keys are NEVER printed in plain form.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dir, '..');
const CATALOG = JSON.parse(readFileSync(join(ROOT, 'src/chat/providerCatalog.json'), 'utf8'));
const WORKING_FILE = join(ROOT, '.openclaude-providers.env');

const args = process.argv.slice(2);
const MULTI  = args.includes('--multi');
const _providerIdx = args.indexOf('--provider');
const SINGLE_PROVIDER = _providerIdx !== -1 ? (args[_providerIdx + 1] || null) : null;

// ── Key resolution ────────────────────────────────────────────────────────────
function loadEnvFile(p) {
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
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
      return JSON.parse(raw.slice(start, i));
    } catch { /* ignore */ }
  }
  return {};
}

const savedEnv   = loadEnvFile(WORKING_FILE);
const vscodeOver = loadVSCodeSettings();

function getProviderCreds(provider) {
  const over = vscodeOver[provider.id] || {};
  const prefix = provider.id.toUpperCase().replace(/-/g, '_');
  return {
    baseUrl: over.OPENAI_BASE_URL || provider.baseUrl || savedEnv[`${prefix}_BASE_URL`] || '',
    apiKey:  over.OPENAI_API_KEY  || savedEnv[`${prefix}_API_KEY`] || process.env.OPENAI_API_KEY || '',
  };
}

function redact(k) {
  if (!k || k.length < 8) return '(not set)';
  return k.slice(0, 4) + '...' + k.slice(-4);
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function post(url, apiKey, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: 'POST',
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

// ── Probe functions ───────────────────────────────────────────────────────────
async function probeSingleTurn(baseUrl, apiKey, model) {
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  const body = {
    model,
    messages: [{ role: 'user', content: 'Reply with exactly the single word: pong' }],
    max_tokens: 5,
    temperature: 0,
  };
  try {
    const res = await post(url, apiKey, body);
    if (res.status !== 200) {
      return { ok: false, reason: `HTTP ${res.status}`, detail: res.body.slice(0, 200) };
    }
    const parsed = JSON.parse(res.body);
    const choice = parsed.choices && parsed.choices[0];
    const msg = choice && choice.message;
    // Detect thinking mode: presence of reasoning_content in message
    const hasReasoning = msg && (msg.reasoning_content !== undefined || msg.reasoning !== undefined);
    const text = (msg && msg.content) || '';
    return { ok: true, hasReasoning, text: text.slice(0, 100), usage: parsed.usage };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function probeMultiTurn(baseUrl, apiKey, model) {
  // Turn 1: get an answer
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  const turn1Body = {
    model,
    messages: [{ role: 'user', content: 'Say the word: pong' }],
    max_tokens: 5,
    temperature: 0,
  };
  let turn1;
  try {
    const r1 = await post(url, apiKey, turn1Body);
    if (r1.status !== 200) return { ok: false, reason: `Turn 1 HTTP ${r1.status}` };
    turn1 = JSON.parse(r1.body);
  } catch (e) {
    return { ok: false, reason: `Turn 1 error: ${e.message}` };
  }

  const choice = turn1.choices && turn1.choices[0];
  const assistantMsg = choice && choice.message;
  if (!assistantMsg) return { ok: false, reason: 'No assistant message in turn 1' };

  // Turn 2: include history INCLUDING any reasoning_content (this triggers the DeepSeek bug)
  const messages = [
    { role: 'user', content: 'Say the word: pong' },
    assistantMsg,  // verbatim — may include reasoning_content if model returned it
    { role: 'user', content: 'Now say: done' },
  ];
  try {
    const r2 = await post(url, apiKey, { model, messages, max_tokens: 5, temperature: 0 });
    if (r2.status !== 200) {
      const body = r2.body.slice(0, 400);
      const isReasoningBug = /reasoning_content.*thinking mode/i.test(body) || /thinking mode.*reasoning/i.test(body);
      return {
        ok: false,
        reasoningBug: isReasoningBug,
        reason: `Turn 2 HTTP ${r2.status}`,
        detail: body,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Turn 2 error: ${e.message}` };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
const providers = CATALOG.filter(p => {
  if (!p.baseUrl) return false;
  if (SINGLE_PROVIDER && p.id !== SINGLE_PROVIDER) return false;
  const creds = getProviderCreds(p);
  return creds.baseUrl && creds.apiKey && !creds.apiKey.includes('your-') && !creds.apiKey.includes('placeholder');
});

console.log(`\nOpenClaude Reasoning Probe — ${MULTI ? 'single-turn + multi-turn' : 'single-turn only'}`);
console.log(`Testing ${providers.length} provider(s) with valid keys...\n`);

const results = [];

for (const provider of providers) {
  const { baseUrl, apiKey } = getProviderCreds(provider);
  const model = provider.defaultModel || (provider.models[0] && provider.models[0].id);
  if (!model) continue;

  process.stdout.write(`  ${(provider.label + ' / ' + model).padEnd(50)} [${redact(apiKey)}] `);

  const s = await probeSingleTurn(baseUrl, apiKey, model);
  if (!s.ok) {
    console.log(`FAIL  — ${s.reason}`);
    if (s.detail) console.log(`         ${s.detail}`);
    results.push({ provider: provider.id, model, status: 'FAIL', reason: s.reason });
    continue;
  }

  let status = 'PASS';
  let note = '';

  if (s.hasReasoning) {
    status = 'THINKING';
    note = 'returned reasoning_content — multi-turn will fail if history re-sent verbatim';
  }

  if (MULTI) {
    const m = await probeMultiTurn(baseUrl, apiKey, model);
    if (!m.ok) {
      if (m.reasoningBug) {
        status = 'REASONING_BUG';
        note = 'multi-turn FAILS: reasoning_content must be re-sent but OpenAI shim drops it';
      } else {
        status = 'MULTI_FAIL';
        note = `multi-turn failed: ${m.reason}`;
      }
    }
  }

  const icon = status === 'PASS' ? '✓' : (status.includes('BUG') || status === 'MULTI_FAIL' ? '⚠' : '~');
  console.log(`${icon} ${status}${note ? '  — ' + note : ''}`);
  results.push({ provider: provider.id, model, status, note });
}

console.log('\n── Summary ──────────────────────────────────────────────────');
const pass     = results.filter(r => r.status === 'PASS');
const thinking = results.filter(r => r.status === 'THINKING');
const bugs     = results.filter(r => r.status === 'REASONING_BUG' || r.status === 'MULTI_FAIL');
const fails    = results.filter(r => r.status === 'FAIL');

console.log(`  ✓ PASS          : ${pass.length}`);
if (thinking.length) console.log(`  ~ THINKING      : ${thinking.length}  (single-turn works; multi-turn risk)`);
if (bugs.length)     console.log(`  ⚠ REASONING_BUG : ${bugs.length}  (multi-turn fails with reasoning_content error)`);
if (fails.length)    console.log(`  ✗ FAIL          : ${fails.length}`);

if (bugs.length) {
  console.log('\nModels with reasoning_content multi-turn bug:');
  for (const r of bugs) {
    console.log(`  - ${r.provider} / ${r.model}`);
  }
  console.log('\nWorkaround: start a new chat after each answer (do not continue the conversation).');
  console.log('The openclaude extension shows a "Provider error" card when this triggers.');
}

console.log('');
