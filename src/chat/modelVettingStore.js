/**
 * modelVettingStore.js — Persists model validation results and user preferences.
 *
 * Tracks three categories:
 *   - vetted: models that passed validation (user-confirmed working)
 *   - disabled: models the user has explicitly disabled
 *   - broken: models that failed validation
 *
 * Also provides secure export (API keys redacted).
 *
 * Usage:
 *   const store = new ModelVettingStore(context);
 *   store.markVerified('deepseek-v4-pro');
 *   const vetted = store.getVettedModels();
 *   const exported = store.exportConfig({ includeApiKeys: false });
 */

const STATE_KEY = 'openclaude.modelVetting.v1';

class ModelVettingStore {
  /**
   * @param {vscode.ExtensionContext} context - VS Code extension context for globalState
   */
  constructor(context) {
    this._context = context;
    this._data = this._load();
  }

  _load() {
    const saved = this._context.globalState.get(STATE_KEY);
    if (saved && typeof saved === 'object') {
      return {
        vetted: Array.isArray(saved.vetted) ? saved.vetted : [],
        disabled: Array.isArray(saved.disabled) ? saved.disabled : [],
        broken: Array.isArray(saved.broken) ? saved.broken : [],
        lastValidation: saved.lastValidation || null,
        validationResults: Array.isArray(saved.validationResults) ? saved.validationResults : [],
        contextOverrides: saved.contextOverrides || {},
      };
    }
    return { vetted: [], disabled: [], broken: [], lastValidation: null, validationResults: [], contextOverrides: {} };
  }

  _save() {
    this._context.globalState.update(STATE_KEY, this._data);
  }

  /** Mark a model as verified (user-confirmed working). */
  _markVerifiedNoSave(modelId) {
    if (!this._data.vetted.includes(modelId)) this._data.vetted.push(modelId);
    this._data.broken = this._data.broken.filter(m => m !== modelId);
    this._data.disabled = this._data.disabled.filter(m => m !== modelId);
  }

  _markBrokenNoSave(modelId) {
    if (!this._data.broken.includes(modelId)) this._data.broken.push(modelId);
    this._data.vetted = this._data.vetted.filter(m => m !== modelId);
  }

  markVerified(modelId) {
    if (!this._data.vetted.includes(modelId)) {
      this._data.vetted.push(modelId);
    }
    // Remove from broken/disabled if present
    this._data.broken = this._data.broken.filter(m => m !== modelId);
    this._data.disabled = this._data.disabled.filter(m => m !== modelId);
    this._save();
  }

  /** Mark a model as broken (failed validation). */
  markBroken(modelId, reason = '') {
    if (!this._data.broken.includes(modelId)) {
      this._data.broken.push(modelId);
    }
    this._data.vetted = this._data.vetted.filter(m => m !== modelId);
    this._save();
  }

  /** Disable a model (user doesn't want to see it). */
  disable(modelId) {
    if (!this._data.disabled.includes(modelId)) {
      this._data.disabled.push(modelId);
    }
    this._data.vetted = this._data.vetted.filter(m => m !== modelId);
    this._save();
  }

  /** Re-enable a previously disabled model. */
  enable(modelId) {
    this._data.disabled = this._data.disabled.filter(m => m !== modelId);
    this._save();
  }

  /** Store validation results from a bulk validation run. */
  storeValidationResults(results) {
    this._data.validationResults = results;
    this._data.lastValidation = new Date().toISOString();
    // Auto-mark based on results
    for (const r of results) {
      if (r.status === 'verified') this.markVerified(r.modelId);
      else if (r.status === 'broken') this.markBroken(r.modelId, r.details);
    }
    this._save();
  }

  /** Set context window override for a model. */
  setContextOverride(modelId, tokens) {
    if (tokens === null || tokens === undefined || tokens === '') {
      delete this._data.contextOverrides[modelId];
    } else {
      this._data.contextOverrides[modelId] = Number(tokens);
    }
    this._save();
  }

  /** Get all context overrides. */
  getContextOverrides() {
    return { ...this._data.contextOverrides };
  }

  /** Get list of vetted (verified) model IDs. */
  getVettedModels() {
    return [...this._data.vetted];
  }

  /** Get list of broken model IDs. */
  getBrokenModels() {
    return [...this._data.broken];
  }

  /** Get list of disabled model IDs. */
  getDisabledModels() {
    return [...this._data.disabled];
  }

  /** Get the full validation results from last run. */
  getLastValidationResults() {
    return [...this._data.validationResults];
  }

  /** Get last validation timestamp. */
  getLastValidationTime() {
    return this._data.lastValidation;
  }

  /**
   * Get the model status for UI display.
   * @returns {'verified'|'broken'|'disabled'|'unknown'}
   */
  getModelStatus(modelId) {
    if (this._data.disabled.includes(modelId)) return 'disabled';
    if (this._data.broken.includes(modelId)) return 'broken';
    if (this._data.vetted.includes(modelId)) return 'verified';
    return 'unknown';
  }

  /**
   * Export model configurations securely.
   * @param {object} options
   * @param {boolean} options.includeApiKeys - Whether to include API keys (default: false)
   * @param {string} options.scope - 'vetted' | 'all' | 'disabled' (default: 'all')
   * @param {Array} catalog - Provider catalog to resolve model details
   * @returns {string} JSON string of export
   */
  exportConfig(options = {}) {
    const { includeApiKeys = false, scope = 'all', catalog = [] } = options;

    const exportData = {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      scope,
      models: [],
    };

    for (const provider of catalog) {
      if (!provider.models) continue;
      const providerEntry = {
        providerId: provider.id,
        label: provider.label || provider.id,
        baseUrl: provider.baseUrl || null,
        models: [],
      };

      for (const model of provider.models) {
        const modelId = typeof model === 'string' ? model : (model.id || model);
        const status = this.getModelStatus(modelId);

        // Filter by scope
        if (scope === 'vetted' && status !== 'verified') continue;
        if (scope === 'disabled' && status !== 'disabled') continue;

        providerEntry.models.push({
          id: modelId,
          status,
          contextOverride: this._data.contextOverrides[modelId] || null,
        });
      }

      if (providerEntry.models.length > 0) {
        // Only include API key info if requested AND the model is vetted
        if (includeApiKeys) {
          const envKey = provider.id.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase() + '_API_KEY';
          const apiKey = process.env[envKey];
          providerEntry.apiKeyHint = apiKey
            ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
            : null;
        }
        exportData.models.push(providerEntry);
      }
    }

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Get a filtered catalog based on vetting status.
   * Used to provide the "vetted view" vs "original view" in the model picker.
   */
  getFilteredCatalog(catalog, mode = 'all') {
    if (mode === 'all') return catalog;

    return catalog.map(provider => {
      if (!provider.models) return provider;
      const filteredModels = provider.models.filter(model => {
        const modelId = typeof model === 'string' ? model : (model.id || model);
        const status = this.getModelStatus(modelId);
        switch (mode) {
          case 'vetted': return status === 'verified' || status === 'unknown';
          case 'disabled': return status === 'disabled';
          case 'working': return status === 'verified';
          default: return true;
        }
      });
      return filteredModels.length > 0 ? { ...provider, models: filteredModels } : null;
    }).filter(Boolean);
  }

  /** Clear all vetting data. */
  reset() {
    this._data = { vetted: [], disabled: [], broken: [], lastValidation: null, validationResults: [], contextOverrides: {} };
    this._save();
  }
}

module.exports = { ModelVettingStore };
