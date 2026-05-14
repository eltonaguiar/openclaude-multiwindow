// Patches chatProvider.js with new features:
// - Model validation message handlers
// - Message queue during streaming
// - Force reset thinking
// - Export models
// - Thinking guard integration

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'chat', 'chatProvider.js');
let content = fs.readFileSync(filePath, 'utf8');

// ── Edit 1: Add new imports ──
const oldImports = `const { isAssistantMessage, isPartialMessage, isStreamEvent,`;
const newImports = `const { ModelValidator } = require('./modelValidator');
const { ThinkingGuard } = require('./thinkingGuard');
const { isAssistantMessage, isPartialMessage, isStreamEvent,`;
content = content.replace(oldImports, newImports);

// ── Edit 2: Add message queue + thinking guard to ChatController constructor ──
const oldConstructorEnd = `this._modelDirty = false;  // true if model changed after last process start

    this._onDidChangeState`;
const newConstructorEnd = `this._modelDirty = false;  // true if model changed after last process start
    this._messageQueue = [];    // messages queued during streaming
    this._thinkingGuard = null; // ThinkingGuard instance, set in startSession

    this._onDidChangeState`;
content = content.replace(oldConstructorEnd, newConstructorEnd);

// ── Edit 3: Add thinkingGuard to startSession (after process creation) ──
const oldStartSessionEnd = `this._process = new ProcessManager({`;
const newStartSessionStart = `// Set up thinking guard for this process
    this._thinkingGuard = new ThinkingGuard(null, {
      timeoutMs: vscode.workspace.getConfiguration('openclaude').get('thinkingTimeoutMs', 120000),
    });
    this._thinkingGuard.onThinkingStuck((info) => {
      this._broadcast({ type: 'thinking_stuck', elapsedMs: info.elapsedMs });
    });

    this._process = new ProcessManager({`;
content = content.replace(oldStartSessionEnd, newStartSessionStart);

// ── Edit 4: Wire thinking guard to process ──
const oldWireProcess = `this._process = new ProcessManager({\n      command,`;
// Already replaced above, skip

// ── Edit 5: Add forceReset method to ChatController (before abort()) ──
const oldAbort = `abort() {
    if (this._process) {
      this._process.abort();
      this._broadcast({ type: 'stream_end', text: this._accumulatedText, usage: null });
      this._onDidChangeState.fire('idle');
    }
  }`;

const newAbortMethods = `forceReset() {
    // Hard reset: kill process, clear state, notify UI
    if (this._thinkingGuard) {
      this._thinkingGuard.forceStop();
    }
    if (this._process) {
      this._process.forceReset();
      this._process = null;
    }
    this._streaming = false;
    this._accumulatedText = '';
    this._toolUses = [];
    this._thinkingTokens = 0;
    this._thinkingStartTime = null;
    this._broadcast({ type: 'thinking_end' });
    this._broadcast({ type: 'stream_end', text: '', usage: null, final: true });
    this._broadcast({ type: 'connected', message: 'Reset — ready' });
    this._onDidChangeState.fire('idle');
  }

  getQueuedMessages() {
    return [...this._messageQueue];
  }

  queueMessage(text) {
    this._messageQueue.push({ text, timestamp: Date.now() });
    this._broadcast({ type: 'queue_update', count: this._messageQueue.length });
  }

  async sendQueuedMessages() {
    const queue = [...this._messageQueue];
    this._messageQueue = [];
    this._broadcast({ type: 'queue_update', count: 0 });
    for (const item of queue) {
      await this.sendMessage(item.text);
    }
  }

  abort() {
    if (this._thinkingGuard) {
      this._thinkingGuard.endThinking();
    }
    if (this._process) {
      this._process.abort();
      this._broadcast({ type: 'stream_end', text: this._accumulatedText, usage: null });
      this._onDidChangeState.fire('idle');
    }
  }`;

content = content.replace(oldAbort, newAbortMethods);

// ── Edit 6: Update stopSession to clean up thinking guard ──
const oldStopSession = `stopSession() {
    if (this._process) {
      this._process.dispose();
      this._process = null;
    }
  }`;
const newStopSession = `stopSession() {
    if (this._thinkingGuard) {
      this._thinkingGuard.endThinking();
    }
    if (this._process) {
      this._process.dispose();
      this._process = null;
    }
  }`;
content = content.replace(oldStopSession, newStopSession);

// ── Edit 7: Update _doSend to check queue on stream end ──
const oldDoSendEnd = `this._process.sendUserMessage(text);
      this._messages.push({ role: 'user', text });`;
const newDoSendEnd = `if (this._streaming) {
      // If streaming, queue the message instead
      this.queueMessage(text);
      this._messages.push({ role: 'user', text: '[queued] ' + text });
      return;
    }
    this._process.sendUserMessage(text);
    this._messages.push({ role: 'user', text });`;
content = content.replace(oldDoSendEnd, newDoSendEnd);

// ── Edit 8: Add _handleMessage streaming start for thinking guard ──
const oldThinkingStart = `this._thinkingStartTime = Date.now();
            this._broadcast({ type: 'thinking_start' });`;
const newThinkingStart = `this._thinkingStartTime = Date.now();
            if (this._process && typeof this._process.startThinking === 'function') {
              this._process.startThinking();
            }
            this._broadcast({ type: 'thinking_start' });`;
content = content.replace(oldThinkingStart, newThinkingStart);

const oldThinkingEnd = `this._broadcast({ type: 'thinking_end' });`;
const newThinkingEnd = `if (this._process && typeof this._process.endThinking === 'function') {
              this._process.endThinking();
            }
            this._broadcast({ type: 'thinking_end' });`;
content = content.replace(oldThinkingEnd, newThinkingEnd);

// ── Edit 9: Add stream_end handler for auto-sending queued messages ──
const oldStreamEndIdle = `this._streaming = false;
      this._onDidChangeState.fire('idle');
      return;
    }

    if (isToolProgressMessage(msg))`;
const newStreamEndIdle = `this._streaming = false;
      this._onDidChangeState.fire('idle');
      // Auto-send queued messages after streaming completes
      if (this._messageQueue.length > 0) {
        setTimeout(() => this.sendQueuedMessages(), 300);
      }
      return;
    }

    if (isToolProgressMessage(msg))`;
content = content.replace(oldStreamEndIdle, newStreamEndIdle);

// ── Edit 10: Add new message handlers to attachChatMessageHandler ──
// Add after 'set_context_override' case
const oldCtxOverrideEnd = `case 'set_context_override': {`;
const newBeforeCtxOverride = `// ── Model vetting & validation ──
      case 'validate_models': {
        try {
          const catalog = loadProviderCatalog();
          const mode = msg.mode || 'free';
          const providerFilter = msg.providerFilter || null;
          const modelFilter = msg.modelFilter || null;
          const validator = new ModelValidator(catalog);
          webview.postMessage({ type: 'validation_started', mode, total: 0 });
          const results = await validator.validateAll({
            mode,
            providerFilter,
            modelFilter,
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
          
