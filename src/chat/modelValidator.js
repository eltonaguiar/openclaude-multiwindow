/**
 * modelValidator.js — Validates AI model/provider existence and health.
 *
 * Two validation modes:
 *   1. FREE:  HEAD/GET to provider's /models endpoint (no token cost)
 *   2. PAID:  POST a minimal "which model are you?" to /chat/completions
 *
 * Usage:
 *   const mv = new ModelValidator(catalog);
 *   const results = await mv.validateAll({ mode: 'free' });
 *   const single = await mv.validateModel('deepseek-v4-pro', { mode: 'paid' });
 */

const https = require('https');
const http = require('http');

const MODEL_CHECK_PROMPT = 'Respond with exactly: "OK: [model_name]" where [model_name] is your full model identifier.';

class ModelValidator {
  constructor(catalog, options = {}) {
    this._catalog = catalog || [];
    this._envOverrides = options.envOverrides || {};
    this._timeoutMs = options.timeoutMs || 15000;
  }

  _resolveModel(modelId) {
    for (const provider of this._catalog) {
      if (!provider.models) continue;
      const model = provider.models.find(m => m === modelId || m.id === modelId);
      if (model) return { provider, model: typeof model === 'string' ? { id: model } : model };
    }
    return null;
  }

  _getProviderEnvKey(providerId) {
    const upper = providerId.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
    return `${upper}_API_KEY`;
  }

  _getProviderBaseUrlEnvKey(providerId) {
    const upper = providerId.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
    return `${upper}_BASE_URL`;
  }

  _getApiKey(providerId) {
    const key = this._getProviderEnvKey(providerId);
    return this._envOverrides[key] || process.env[key] || null;
  }

  _getBaseUrl(provider) {
    const key = this._getProviderBaseUrlEnvKey(provider.id);
    const envUrl = this._envOverrides[key] || process.env[key];
    if (envUrl) return envUrl;
    return provider.baseUrl || null;
  }

  _buildAuthHeaders(apiKey) {
    if (!apiKey) return {};
    return { 'Authorization': `Bearer ${apiKey}` };
  }

  async validateModelFree(modelId) {
    const resolved = this._resolveModel(modelId);
    if (!resolved) {
      return {
        modelId, providerId: null, status: 'unknown', method: 'free',
        details: `Model "${modelId}" not found in catalog`, latencyMs: 0,
      };
    }
    const { provider } = resolved;
    const baseUrl = this._getBaseUrl(provider);
    if (!baseUrl) {
      return {
        modelId, providerId: provider.id, status: 'unknown', method: 'free',
        details: 'No base URL configured for this provider', latencyMs: 0,
      };
    }
    const apiKey = this._getApiKey(provider.id);
    const startTime = Date.now();
    try {
      const result = await this._httpRequest({
        method: 'GET',
        url: `${baseUrl.replace(/\/+$/, '')}/models`,
        headers: { ...this._buildAuthHeaders(apiKey), 'Accept': 'application/json' },
        timeoutMs: this._timeoutMs,
      });
      const latencyMs = Date.now() - startTime;
      if (result.statusCode === 200) {
        let found = false;
        try {
          const body = JSON.parse(result.body);
          const modelList = body.data || body.models || body || [];
          found = Array.isArray(modelList) ? modelList.some(m => (m.id || m) === modelId) : false;
        } catch { found = true; }
        return {
          modelId, providerId: provider.id,
          status: found ? 'verified' : 'unknown', method: 'free',
          details: found ? 'Provider reachable, model found in /models' : 'Provider reachable but model not confirmed in /models listing',
          latencyMs,
        };
      }
      if (result.statusCode === 401 || result.statusCode === 403) {
        return { modelId, providerId: provider.id, status: 'broken', method: 'free', details: `Authentication failed (${result.statusCode})`, latencyMs };
      }
      if (result.statusCode === 404) {
        return { modelId, providerId: provider.id, status: 'unknown', method: 'free', details: '/models endpoint not available (404) — try paid validation', latencyMs };
      }
      return { modelId, providerId: provider.id, status: 'broken', method: 'free', details: `HTTP ${result.statusCode}`, latencyMs };
    } catch (err) {
      return { modelId, providerId: provider.id, status: 'broken', method: 'free', details: `Connection failed: ${err.message}`, latencyMs: Date.now() - startTime };
    }
  }

  async validateModelPaid(modelId) {
    const resolved = this._resolveModel(modelId);
    if (!resolved) {
      return { modelId, providerId: null, status: 'unknown', method: 'paid', details: `Model "${modelId}" not found in catalog`, actualModel: null, tokensUsed: 0, latencyMs: 0 };
    }
    const { provider } = resolved;
    const baseUrl = this._getBaseUrl(provider);
    if (!baseUrl) {
      return { modelId, providerId: provider.id, status: 'unknown', method: 'paid', details: 'No base URL configured', actualModel: null, tokensUsed: 0, latencyMs: 0 };
    }
    const apiKey = this._getApiKey(provider.id);
    if (!apiKey) {
      return { modelId, providerId: provider.id, status: 'broken', method: 'paid', details: 'No API key configured', actualModel: null, tokensUsed: 0, latencyMs: 0 };
    }
    const startTime = Date.now();
    try {
      const payload = JSON.stringify({ model: modelId, messages: [{ role: 'user', content: MODEL_CHECK_PROMPT }], max_tokens: 20, temperature: 0 });
      const result = await this._httpRequest({
        method: 'POST',
        url: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
        headers: { ...this._buildAuthHeaders(apiKey), 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: payload,
        timeoutMs: this._timeoutMs,
      });
      const latencyMs = Date.now() - startTime;
      if (result.statusCode === 200) {
        try {
          const body = JSON.parse(result.body);
          return { modelId, providerId: provider.id, status: 'verified', method: 'paid', details: `Responded as "${body.model || 'unknown'}"`, actualModel: body.model || null, tokensUsed: body.usage?.total_tokens || 0, latencyMs };
        } catch {
          return { modelId, providerId: provider.id, status: 'verified', method: 'paid', details: 'Got 200 OK', actualModel: null, tokensUsed: 0, latencyMs };
        }
      }
      if (result.statusCode === 401 || result.statusCode === 403) {
        return { modelId, providerId: provider.id, status: 'broken', method: 'paid', details: `Auth failed (${result.statusCode})`, actualModel: null, tokensUsed: 0, latencyMs };
      }
      if (result.statusCode === 404) {
        return { modelId, providerId: provider.id, status: 'broken', method: 'paid', details: `Model not found (404)`, actualModel: null, tokensUsed: 0, latencyMs };
      }
      return { modelId, providerId: provider.id, status: 'broken', method: 'paid', details: `HTTP ${result.statusCode}`, actualModel: null, tokensUsed: 0, latencyMs };
    } catch (err) {
      return { modelId, providerId: provider.id, status: 'broken', method: 'paid', details: `Request failed: ${err.message}`, actualModel: null, tokensUsed: 0, latencyMs: Date.now() - startTime };
    }
  }

  async validateAll(options = {}) {
    const { mode = 'free', providerFilter, modelFilter, onProgress } = options;
    const validateFn = mode === 'paid' ? this.validateModelPaid.bind(this) : this.validateModelFree.bind(this);
    const allModels = [];
    for (const provider of this._catalog) {
      if (providerFilter && !providerFilter.includes(provider.id)) continue;
      if (!provider.models) continue;
      for (const model of provider.models) {
        const modelId = typeof model === 'string' ? model : (model.id || model);
        if (modelFilter && !modelFilter.includes(modelId)) continue;
        allModels.push({ modelId, providerId: provider.id });
      }
    }
    const results = [];
    for (let i = 0; i < allModels.length; i++) {
      const result = await validateFn(allModels[i].modelId);
      results.push(result);
      if (onProgress) onProgress(i + 1, allModels.length, result);
    }
    return results;
  }


  async validateModel(modelId, options = {}) {
    const { mode = 'free' } = options;
    if (mode === 'paid') return this.validateModelPaid(modelId);
    return this.validateModelFree(modelId);
  }

  /**
   * Low-level HTTP request helper.
   * @param {object} opts
   * @param {string} opts.method - GET or POST
   * @param {string} opts.url - Full URL
   * @param {object} [opts.headers] - Request headers
   * @param {string} [opts.body] - Request body for POST
   * @param {number} [opts.timeoutMs=15000]
   * @returns {Promise<{statusCode: number, headers: object, body: string}>}
   */
  _httpRequest(opts) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const url = new URL(opts.url);
      const transport = url.protocol === 'https:' ? require('https') : require('http');
      const req = transport.request(
        url,
        {
          method: opts.method || 'GET',
          headers: opts.headers || {},
          timeout: opts.timeoutMs || 15000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
          res.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
        }
      );
      req.on('timeout', () => { if (!settled) { settled = true; req.destroy(); reject(new Error('Request timed out')); } });
      req.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
      if (opts.body) req.write(opts.body);
      req.end();
    });
  }

  /** Return all model IDs in the catalog (flattened). */
  getAllModelIds() {
    const ids = [];
    for (const provider of this._catalog) {
      if (!provider.models) continue;
      for (const model of provider.models) {
        ids.push(typeof model === 'string' ? model : (model.id || model));
      }
    }
    return ids;
  }

  /** Return summary of available providers. */
  getProviderSummary() {
    return this._catalog.map(p => ({
      id: p.id,
      label: p.label || p.id,
      modelCount: p.models ? p.models.length : 0,
    }));
  }
}

module.exports = { ModelValidator };
