// Patch chatProvider.js with new features
const fs = require('fs');
const filePath = __dirname + '/../src/chat/chatProvider.js';
let c = fs.readFileSync(filePath, 'utf8');

// 1. Add new imports
c = c.replace(
  "const { isAssistantMessage, isPartialMessage, isStreamEvent,",
  "const { ModelValidator } = require('./modelValidator');\nconst { ThinkingGuard } = require('./thinkingGuard');\nconst { isAssistantMessage, isPartialMessage, isStreamEvent,"
);

// 2. Add queue + thinkingGuard to constructor
c = c.replace(
  "this._modelDirty = false;  // true if model changed after last process start\n\n    this._onDidChangeState",
  "this._modelDirty = false;\n    this._messageQueue = [];\n    this._thinkingGuard = null;\n\n    this._onDidChangeState"
);

// 3. Add thinking guard before ProcessManager creation in startSession
c = c.replace(
  "this._process = new ProcessManager({\n      command,",
  "this._thinkingGuard = new ThinkingGuard(null, {\n      timeoutMs: vscode.workspace.getConfiguration('openclaude').get('thinkingTimeoutMs', 120000),\n    });\n    this._thinkingGuard.onThinkingStuck((info) => {\n      this._broadcast({ type: 'thinking_stuck', elapsedMs: info.elapsedMs });\n    });\n\n    this._process = new ProcessManager({\n      command,"
);

// 4. Add forceReset, queue methods before abort
const oldAbort = "abort() {\n    if (this._process) {\n      this._process.abort();\n      this._broadcast({ type: 'stream_end', text: this._accumulatedText, usage: null });\n      this._onDidChangeState.fire('idle');\n    }\n  }";

const newMethods = "forceReset() {\n    if (this._thinkingGuard) this._thinkingGuard.forceStop();\n    if (this._process) { this._process.forceReset(); this._process = null; }\n    this._streaming = false;\n    this._accumulatedText = '';\n    this._toolUses = [];\n    this._thinkingTokens = 0;\n    this._thinkingStartTime = null;\n    this._broadcast({ type: 'thinking_end' });\n    this._broadcast({ type: 'stream_end', text: '', usage: null, final: true });\n    this._broadcast({ type: 'connected', message: 'Reset - ready' });\n    this._onDidChangeState.fire('idle');\n  }\n\n  getQueuedMessages() { return [...this._messageQueue]; }\n\n  queueMessage(text) {\n    this._messageQueue.push({ text, timestamp: Date.now() });\n    this._broadcast({ type: 'queue_update', count: this._messageQueue.length });\n  }\n\n  async sendQueuedMessages() {\n    const queue = [...this._messageQueue];\n    this._messageQueue = [];\n    this._broadcast({ type: 'queue_update', count: 0 });\n    for (const item of queue) await this.sendMessage(item.text);\n  }\n\n  abort() {\n    if (this._thinkingGuard) this._thinkingGuard.endThinking();\n    if (this._process) {\n      this._process.abort();\n      this._broadcast({ type: 'stream_end', text: this._accumulatedText, usage: null });\n      this._onDidChangeState.fire('idle');\n    }\n  }";

c = c.replace(oldAbort, newMethods);

// 5. Update stopSession to clean up thinking guard
c = c.replace(
  "stopSession() {\n    if (this._process) {\n      this._process.dispose();\n      this._process = null;\n    }\n  }",
  "stopSession() {\n    if (this._thinkingGuard) { this._thinkingGuard.endThinking(); }\n    if (this._process) { this._process.dispose(); this._process = null; }\n  }"
);

// 6. Update dispose to clean up thinking guard
c = c.replace(
  "dispose() {\n    this.stopSession();\n    this._onDidChangeState.dispose();\n  }",
  "dispose() {\n    this.stopSession();\n    if (this._thinkingGuard) { try { this._thinkingGuard.dispose(); } catch {} this._thinkingGuard = null; }\n    this._onDidChangeState.dispose();\n  }"
);

// 7. Wire thinking start/end to process
c = c.replace(
  "this._thinkingStartTime = Date.now();\n            this._broadcast({ type: 'thinking_start' });",
  "this._thinkingStartTime = Date.now();\n            if (this._process && typeof this._process.startThinking === 'function') {\n              this._process.startThinking();\n            }\n            this._broadcast({ type: 'thinking_start' });"
);

c = c.replace(
  "this._broadcast({ type: 'thinking_end' });",
  "if (this._process && typeof this._process.endThinking === 'function') {\n              this._process.endThinking();\n            }\n            this._broadcast({ type: 'thinking_end' });"
);

// 8. Auto-send queued messages after stream completes
c = c.replace(
  "this._streaming = false;\n      this._onDidChangeState.fire('idle');\n      return;\n    }\n\n    if (isToolProgressMessage(msg))",
  "this._streaming = false;\n      this._onDidChangeState.fire('idle');\n      if (this._messageQueue.length > 0) {\n        setTimeout(() => this.sendQueuedMessages(), 300);\n      }\n      return;\n    }\n\n    if (isToolProgressMessage(msg))"
);

// 9. Add new message handlers before set_context_override
const newHandlers = `      case 'validate_models': {
        try {
          const catalog = loadProviderCatalog();
          const validator = new ModelValidator(catalog);
          const results = await validator.validateAll({
            mode: msg.mode || 'free',
            providerFilter: msg.providerFilter || null,
            modelFilter: msg.modelFilter || null,
            onProgress: (done, total, result) => {
              webview.postMessage({ type: 'validation_progress', done, total, result });
            },
          });
          webview.postMessage({ type: 'validation_complete', results });
        } catch (err) {
          webview.postMessage({ type: 'error', message: 'Validation failed: ' + (err && err.message || String(err)) });
        }
        break;
      }
      case 'validate_single_model': {
        try {
          const catalog = loadProviderCatalog();
          const validator = new ModelValidator(catalog);
          const result = await validator.validateModel(msg.modelId, { mode: msg.mode || 'free' });
          webview.postMessage({ type: 'single_validation_result', result });
        } catch (err) {
          webview.postMessage({ type: 'error', message: 'Validation failed: ' + (err && err.message || String(err)) });
        }
        break;
      }
      case 'export_models': {
        try {
          const catalog = loadProviderCatalog();
          const exportJson = JSON.stringify({
            exportedAt: new Date().toISOString(),
            version: '1.0',
            scope: msg.scope || 'all',
            vetting: msg.vettingData || {},
            models: catalog.map(p => ({
              providerId: p.id,
              label: p.label || p.id,
              baseUrl: p.baseUrl || null,
              models: (p.models || []).map(m => typeof m === 'string' ? { id: m } : { id: m.id || m }),
            })),
          }, null, 2);
          webview.postMessage({ type: 'export_data', data: exportJson });
        } catch (err) {
          webview.postMessage({ type: 'error', message: 'Export failed: ' + (err && err.message || String(err)) });
        }
        break;
      }
      case 'reset_thinking': {
        const c = getController();
        if (c && typeof c.forceReset === 'function') c.forceReset();
        break;
      }
      case 'queue_message': {
        const c = getController();
        if (c && typeof c.queueMessage === 'function') c.queueMessage(msg.text);
        break;
      }
      case 'get_queued_messages': {
        const c = getController();
        if (c && typeof c.getQueuedMessages === 'function') {
          const msgs = c.getQueuedMessages();
          webview.postMessage({ type: 'queue_update', messages: msgs, count: msgs.length });
        }
        break;
      }
      case 'set_context_override': {`;

c = c.replace("      case 'set_context_override': {", newHandlers);

fs.writeFileSync(filePath, c);
console.log('chatProvider.js patched successfully');
