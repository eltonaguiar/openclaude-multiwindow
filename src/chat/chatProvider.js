/**
 * chatProvider — WebviewViewProvider (sidebar) and WebviewPanel manager
 * (editor tab) that wire ProcessManager events to the chat UI.
 */

const vscode = require('vscode');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { ProcessManager } = require('./processManager');
const { toViewModel } = require('./messageParser');
const { renderChatHtml } = require('./chatRenderer');

let _cachedCatalog = null;
function loadProviderCatalog() {
  if (_cachedCatalog) return _cachedCatalog;
  try {
    const p = path.join(__dirname, 'providerCatalog.json');
    const built = JSON.parse(fs.readFileSync(p, 'utf8'));
    // Merge user extras from settings.
    const cfg = vscode.workspace.getConfiguration('openclaude');
    const extras = cfg.get('modelCatalogExtras', []) || [];
    const merged = Array.isArray(extras) && extras.length > 0
      ? built.concat(extras.filter(p => p && p.id && Array.isArray(p.models)))
      : built;
    _cachedCatalog = merged;
    return merged;
  } catch (err) {
    console.warn('[openclaude] failed to load provider catalog:', err && err.message);
    _cachedCatalog = [];
    return [];
  }
}

// Invalidate cache when settings change.
try {
  vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('openclaude.modelCatalogExtras')) _cachedCatalog = null;
  });
} catch { /* may run outside extension host during tests */ }
const { isAssistantMessage, isPartialMessage, isStreamEvent,
        isContentBlockDelta, isContentBlockStart, isMessageStart,
        isResultMessage, isControlRequest, isToolProgressMessage,
        isStatusMessage, isRateLimitEvent, getTextContent,
        getToolUseBlocks } = require('./protocol');

async function openFileInEditor(filePath) {
  try {
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch {
    vscode.window.showWarningMessage(`Could not open file: ${filePath}`);
  }
}

function getLaunchConfig() {
  const cfg = vscode.workspace.getConfiguration('openclaude');
  const command = cfg.get('launchCommand', 'openclaude');
  const shimEnabled = cfg.get('useOpenAIShim', false);
  const permissionMode = cfg.get('permissionMode', 'acceptEdits');
  const overrides = cfg.get('modelContextOverrides', {}) || {};
  const env = {};
  if (shimEnabled) env.CLAUDE_CODE_USE_OPENAI = '1';
  if (overrides && typeof overrides === 'object' && Object.keys(overrides).length > 0) {
    // Two formats so different forks/utility scripts of openclaude can pick
    // it up: a JSON blob and discrete OPENCLAUDE_CTX_<MODEL> entries.
    env.OPENCLAUDE_MODEL_CONTEXT_OVERRIDES = JSON.stringify(overrides);
    for (const [model, tokens] of Object.entries(overrides)) {
      const safe = String(model).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      env['OPENCLAUDE_CTX_' + safe] = String(tokens);
    }
  }
  const folders = vscode.workspace.workspaceFolders;
  const cwd = folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
  return { command, cwd, env, permissionMode };
}

class ChatController {
  constructor(sessionManager) {
    this._sessionManager = sessionManager;
    this._process = null;
    this._webviews = new Set();
    this._accumulatedText = '';
    this._toolUses = [];
    this._messages = [];
    this._currentSessionId = null;
    this._streaming = false;
    this._lastResult = null;
    this._thinkingTokens = 0;
    this._thinkingStartTime = null;
    this._currentBlockType = null;
    this._model = null;        // per-chat model override (CLI --model)
    this._modelDirty = false;  // true if model changed after last process start

    this._onDidChangeState = new vscode.EventEmitter();
    this.onDidChangeState = this._onDidChangeState.event;
  }

  get sessionId() { return this._currentSessionId; }
  get isStreaming() { return Boolean(this._process && this._process.running); }
  get sessionManager() { return this._sessionManager; }
  get model() { return this._model; }
  get modelDirty() { return this._modelDirty; }

  setModel(model) {
    const next = model || null;
    if (next === this._model) return false;
    this._model = next;
    // If a process is running, the new model only takes effect on the next
    // process start (--model is a launch flag, not hot-swappable).
    if (this._process && this._process.running) {
      this._modelDirty = true;
    }
    this._broadcast({ type: 'model_changed', model: this._model, dirty: this._modelDirty });
    return true;
  }

  registerWebview(webview) {
    this._webviews.add(webview);
    return { dispose: () => this._webviews.delete(webview) };
  }

  broadcast(msg) {
    for (const wv of this._webviews) {
      try { wv.postMessage(msg); } catch { /* webview might be disposed */ }
    }
  }

  _broadcast(msg) {
    this.broadcast(msg);
  }

  async startSession(opts = {}) {
    this.stopSession();
    this._accumulatedText = '';
    this._toolUses = [];
    // Only clear messages if this is a brand new session (not continuing)
    if (!opts.continueSession && !opts.sessionId) {
      this._messages = [];
    }
    this._currentSessionId = opts.sessionId || this._currentSessionId || null;

    const { command, cwd, env, permissionMode } = getLaunchConfig();

    const effectiveModel = opts.model || this._model || null;
    this._process = new ProcessManager({
      command,
      cwd,
      env,
      sessionId: opts.sessionId,
      continueSession: opts.continueSession || false,
      model: effectiveModel === 'inherit' ? null : effectiveModel,
      permissionMode,
      extraArgs: opts.extraArgs || [],
    });
    this._modelDirty = false;

    this._readyResolve = null;
    this._readyPromise = new Promise(resolve => { this._readyResolve = resolve; });

    this._process.onMessage((msg) => {
      if (msg.type === 'system' && this._readyResolve) {
        this._readyResolve();
        this._readyResolve = null;
      }
      this._handleMessage(msg);
    });
    this._process.onError((err) => {
      this._broadcast({ type: 'error', message: err.message || String(err) });
    });
    this._process.onExit(({ code }) => {
      // Flush any remaining streamed text
      if (this._streaming && this._accumulatedText) {
        this._broadcast({ type: 'stream_end', text: this._accumulatedText, usage: null, final: true });
      } else if (this._streaming) {
        this._broadcast({ type: 'stream_end', text: '', usage: (this._lastResult || {}).usage || null, final: true });
      }
      this._streaming = false;
      this._accumulatedText = '';
      this._toolUses = [];
      this._lastResult = null;
      this._broadcast({
        type: 'connected',
        message: code === 0 ? 'Ready' : `Process exited (code ${code})`,
      });
      this._onDidChangeState.fire('idle');
    });

    try {
      this._process.start();
      this._broadcast({ type: 'connected', message: 'Connected' });
      this._onDidChangeState.fire('connected');
    } catch (err) {
      this._broadcast({ type: 'error', message: `Failed to start: ${err.message}` });
    }
  }

  stopSession() {
    if (this._process) {
      this._process.dispose();
      this._process = null;
    }
  }

  async sendMessage(text) {
    // Keep the process alive for multi-turn — just send directly.
    // The CLI maintains full session state (tools, history) across turns.
    // Only start a new process if none exists or it died.
    if (!this._process || !this._process.running) {
      await this.startSession({
        sessionId: this._currentSessionId || undefined,
      });
    }
    await this._doSend(text);
  }

  async _doSend(text) {
    if (!this._process) return;
    // On first message after process start, wait for CLI to be ready.
    // On subsequent messages, the process is already running and accepting input.
    if (this._readyPromise) {
      const grace = new Promise(resolve => setTimeout(resolve, 8000));
      await Promise.race([this._readyPromise, grace]);
      this._readyPromise = null;
    }
    this._accumulatedText = '';
    this._toolUses = [];
    try {
      this._process.sendUserMessage(text);
      this._messages.push({ role: 'user', text });
    } catch (err) {
      this._broadcast({ type: 'error', message: err.message });
    }
  }

  abort() {
    if (this._process) {
      this._process.abort();
      this._broadcast({ type: 'stream_end', text: this._accumulatedText, usage: null });
      this._onDidChangeState.fire('idle');
    }
  }

  sendPermissionResponse(requestId, action, toolUseId) {
    if (!this._process) return;
    if (action === 'deny') {
      try {
        this._process.write({
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: requestId,
            error: 'User denied permission',
          },
        });
      } catch (err) {
        this._broadcast({ type: 'error', message: err.message });
      }
      return;
    }
    try {
      this._process.sendControlResponse(requestId, {
        toolUseID: toolUseId || undefined,
        ...(action === 'allow-session' ? { remember: true } : {}),
      });
    } catch (err) {
      this._broadcast({ type: 'error', message: err.message });
    }
  }

  getMessages() { return this._messages; }

  _handleMessage(msg) {
    if (msg.session_id && !this._currentSessionId) {
      this._currentSessionId = msg.session_id;
    }

    // System message — extract model and session info
    if (msg.type === 'system') {
      this._resolvedModel = msg.model || null;
      this._broadcast({
        type: 'system_info',
        model: msg.model || null,
        sessionId: msg.session_id || msg.sessionId || null,
      });
      // Also push a model_state update so the badge can show the actual
      // resolved model when the user picked "CLI default" / "inherit".
      this._broadcast({
        type: 'model_state',
        chatId: null, // webview keeps its own currentChatId; null means "current"
        model: this._model || 'inherit',
        resolvedModel: msg.model || null,
        streaming: this.isStreaming,
        dirty: this._modelDirty,
      });
      return;
    }

    // Control request (permission prompt) — check EARLY before other handlers
    if (msg.type === 'control_request' || isControlRequest(msg)) {
      const req = msg.request || {};
      const { toolDisplayName, parseToolInput } = require('./messageParser');
      this._broadcast({
        type: 'permission_request',
        requestId: msg.request_id,
        toolName: req.tool_name || 'Unknown',
        displayName: req.display_name || req.title || toolDisplayName(req.tool_name),
        description: req.description || '',
        inputPreview: parseToolInput(req.input),
        toolUseId: req.tool_use_id || null,
      });
      return;
    }

    // Control cancel request
    if (msg.type === 'control_cancel_request') {
      return;
    }

    // Handle Anthropic raw stream events (the primary streaming mechanism)
    if (isStreamEvent(msg)) {
      this._handleStreamEvent(msg);
      return;
    }

    // Assistant message — always mid-turn; true completion comes from 'result'
    if (isAssistantMessage(msg)) {
      const inner = msg.message || msg;
      const text = getTextContent(inner);
      const toolBlocks = getToolUseBlocks(inner);
      const { toolDisplayName, toolIcon } = require('./messageParser');
      const toolUseVms = toolBlocks.map(tu => ({
        id: tu.id,
        name: tu.name,
        displayName: toolDisplayName(tu.name),
        icon: toolIcon(tu.name),
        inputPreview: typeof tu.input === 'string' ? tu.input : JSON.stringify(tu.input || ''),
        input: tu.input,
        status: 'running',
      }));
      this._messages.push({ role: 'assistant', text, toolUses: toolUseVms });
      const usage = inner.usage || msg.usage || null;

      // Finalize current text bubble but stay streaming — true completion
      // is signaled by the 'result' message, not by the assistant message.
      this._broadcast({ type: 'stream_end', text, usage, final: false });
      this._accumulatedText = '';

      if (toolBlocks.length > 0) {
        for (const tu of toolBlocks) {
          this._broadcast({
            type: 'tool_input_ready',
            toolUseId: tu.id,
            input: tu.input,
            name: tu.name,
          });
        }
        this._broadcast({ type: 'status', content: 'Using tools...' });
      }
      return;
    }

    // User message with tool_use_result — this is the tool output
    if (msg.type === 'user' && msg.message) {
      const content = msg.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const resultText = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map(b => b.text || '').join('')
                : '';
            this._broadcast({
              type: 'tool_result',
              toolUseId: block.tool_use_id,
              content: resultText.slice(0, 2000) || '(done)',
              isError: block.is_error || false,
            });
          }
        }
      }
      this._broadcast({ type: 'status', content: 'Thinking...' });
      return;
    }

    // Session result — turn is complete. Go idle. The process stays alive
    // in stream-json mode for multi-turn conversation.
    if (msg.type === 'result' && msg.subtype) {
      this._lastResult = msg;
      // Only use result text if nothing was shown via streaming yet
      const text = this._accumulatedText || '';
      this._broadcast({ type: 'stream_end', text, usage: msg.usage || null, final: true });
      // Show turn info: if the model stopped without using tools (num_turns=1),
      // the user knows the model chose not to edit
      if (msg.num_turns !== undefined) {
        const reason = msg.stop_reason || 'done';
        this._broadcast({
          type: 'status',
          content: msg.num_turns > 1
            ? 'Completed (' + msg.num_turns + ' turns)'
            : 'Ready',
        });
      }
      this._accumulatedText = '';
      this._toolUses = [];
      this._streaming = false;
      this._onDidChangeState.fire('idle');
      return;
    }

    if (isToolProgressMessage(msg)) {
      const vm = toViewModel(msg)[0];
      this._broadcast({
        type: 'tool_progress',
        toolUseId: vm.toolUseId,
        content: vm.content,
      });
      return;
    }

    if (isStatusMessage(msg)) {
      const vm = toViewModel(msg)[0];
      this._broadcast({ type: 'status', content: vm.content });
      return;
    }

    if (isRateLimitEvent(msg)) {
      const vm = toViewModel(msg)[0];
      this._broadcast({ type: 'rate_limit', message: vm.message });
      return;
    }

    // Log unhandled message types for debugging
    if (msg.type && msg.type !== 'stream_event') {
      this._broadcast({ type: 'status', content: '[debug] unhandled: ' + msg.type });
    }
  }

  _handleStreamEvent(msg) {
    const event = msg.event;
    if (!event) return;

    switch (event.type) {
      case 'message_start':
        this._accumulatedText = '';
        this._thinkingTokens = 0;
        this._currentBlockType = null;
        if (!this._streaming) {
          this._streaming = true;
          this._toolUses = [];
          this._onDidChangeState.fire('streaming');
        }
        this._broadcast({ type: 'stream_start' });
        break;

      case 'content_block_start':
        if (event.content_block) {
          this._currentBlockType = event.content_block.type;
          if (event.content_block.type === 'tool_use') {
            const tu = event.content_block;
            this._toolUses.push({ id: tu.id, name: tu.name, input: '' });
            const { toolDisplayName, toolIcon } = require('./messageParser');
            this._broadcast({
              type: 'tool_use',
              toolUse: {
                id: tu.id,
                name: tu.name,
                displayName: toolDisplayName(tu.name),
                icon: toolIcon(tu.name),
                inputPreview: '',
                input: tu.input || null,
                status: 'running',
              },
            });
          } else if (event.content_block.type === 'thinking') {
            this._thinkingTokens = 0;
            this._thinkingStartTime = Date.now();
            this._broadcast({ type: 'thinking_start' });
          }
        }
        break;

      case 'content_block_delta':
        if (event.delta) {
          if (event.delta.type === 'text_delta' && event.delta.text) {
            this._accumulatedText += event.delta.text;
            this._broadcast({ type: 'stream_delta', text: this._accumulatedText });
          } else if (event.delta.type === 'thinking_delta') {
            this._thinkingTokens += (event.delta.thinking || '').length;
            const elapsed = Math.round((Date.now() - (this._thinkingStartTime || Date.now())) / 1000);
            this._broadcast({
              type: 'thinking_delta',
              tokens: this._thinkingTokens,
              elapsed,
            });
          } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
            const lastTool = this._toolUses[this._toolUses.length - 1];
            if (lastTool) {
              lastTool.input = (lastTool.input || '') + event.delta.partial_json;
            }
          }
        }
        break;

      case 'content_block_stop':
        if (this._currentBlockType === 'thinking') {
          this._broadcast({ type: 'thinking_end' });
        }
        this._currentBlockType = null;
        break;

      case 'message_delta':
        break;

      case 'message_stop':
        break;

      default:
        break;
    }
  }

  dispose() {
    this.stopSession();
    this._onDidChangeState.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Multi-chat providers
// ─────────────────────────────────────────────────────────────────────────
//
// Both providers share a `bindToken` discipline:
//
//   - Host sends `tab_state {bindToken: N}` on every tab change.
//   - Webview echoes the bindToken on every outgoing message.
//   - Host drops any message whose bindToken is stale (< current).
//
// This prevents cross-chat leaks during rapid sidebar tab switching
// (deepseek's "biggest risk" in the swarm review).

function attachChatMessageHandler({ webview, getController, registry, panelManager, postBind, getBindToken }) {
  webview.onDidReceiveMessage(async (msg) => {
    if (!msg || typeof msg !== 'object') return;

    // Stale-token filter for chat-scoped messages. Tab/registry-scoped
    // messages (switch_tab, new_tab, close_tab, open_in_new_tab,
    // request_sessions, restore_request, webview_ready) are NOT filtered
    // because they target the registry, not a specific chat.
    const chatScoped = ['send_message', 'abort', 'new_session', 'resume_session',
                        'permission_response', 'set_model'].includes(msg.type);
    if (chatScoped && getBindToken && msg.bindToken !== undefined && msg.bindToken !== getBindToken()) {
      return; // stale, drop
    }

    switch (msg.type) {
      // ── Tab / registry actions ──
      case 'new_tab': {
        const id = registry.create({});
        registry.setActive(id);
        postBind && postBind();
        break;
      }
      case 'switch_tab': {
        if (registry.setActive(msg.chatId)) postBind && postBind();
        break;
      }
      case 'close_tab': {
        registry.remove(msg.chatId);
        postBind && postBind();
        break;
      }
      case 'open_in_new_tab': {
        if (panelManager) panelManager.openPanelForChat(msg.chatId);
        break;
      }

      // ── Chat-scoped actions ──
      case 'send_message': {
        const c = getController();
        if (c) c.sendMessage(msg.text);
        break;
      }
      case 'abort': {
        const c = getController();
        if (c) c.abort();
        break;
      }
      case 'new_session': {
        const c = getController();
        if (c) {
          c.stopSession();
          webview.postMessage({ type: 'session_cleared' });
        }
        break;
      }
      case 'resume_session': {
        const c = getController();
        if (!c) break;
        try {
          c.stopSession();
          webview.postMessage({ type: 'session_cleared' });
          await loadAndDisplaySession(c, webview, msg.sessionId);
          await c.startSession({ sessionId: msg.sessionId });
        } catch (err) {
          webview.postMessage({ type: 'error', message: 'Resume failed: ' + (err && err.message || String(err)) });
        }
        break;
      }
      case 'permission_response': {
        const c = getController();
        if (c) c.sendPermissionResponse(msg.requestId, msg.action, msg.toolUseId);
        break;
      }
      case 'set_model': {
        if (registry.setModel(msg.chatId, msg.model)) {
          const entry = registry.getEntry(msg.chatId);
          if (entry) entry.controller.setModel(msg.model);
          postBind && postBind();
        }
        break;
      }

      // ── Webview helpers ──
      case 'copy_code':
        if (msg.text) await vscode.env.clipboard.writeText(msg.text);
        break;
      case 'open_file':
        if (msg.path) await openFileInEditor(msg.path);
        break;
      case 'request_sessions':
        await sendSessionList(getController(), webview);
        break;
      case 'restore_request': {
        const c = getController();
        if (c) {
          const messages = c.getMessages();
          if (messages.length > 0) webview.postMessage({ type: 'restore_messages', messages });
        }
        break;
      }
      case 'webview_ready':
        try {
          webview.postMessage({ type: 'provider_catalog', providers: loadProviderCatalog() });
        } catch { /* ignore */ }
        postBind && postBind();
        break;
    }
  });
}

async function sendSessionList(controller, webview) {
  if (!controller || !controller.sessionManager) {
    webview.postMessage({ type: 'session_list', sessions: [] });
    return;
  }
  try {
    const sessions = await controller.sessionManager.listSessions();
    webview.postMessage({ type: 'session_list', sessions });
  } catch {
    webview.postMessage({ type: 'session_list', sessions: [] });
  }
}

async function loadAndDisplaySession(controller, webview, sessionId) {
  if (!controller || !controller.sessionManager) return;
  try {
    const messages = await controller.sessionManager.loadSession(sessionId);
    if (messages && messages.length > 0) {
      controller._messages = messages;
      webview.postMessage({ type: 'restore_messages', messages });
    }
  } catch { /* session may not be loadable */ }
}

/**
 * Sidebar Command Centre: hosts the tab strip + one chat view bound to
 * the registry's active chatId. On tab switch we rebind the webview to
 * the new controller (deregister/register), bump bindToken, and send
 * a fresh restore.
 */
class OpenClaudeChatViewProvider {
  constructor(registry, panelManager) {
    this._registry = registry;
    this._panelManager = panelManager;
    this._webviewView = null;
    this._currentRegistration = null;
    this._currentChatId = null;
    this._bindToken = 0;
    this._registryListener = null;
  }

  resolveWebviewView(webviewView, _context, _token) {
    this._webviewView = webviewView;
    const webview = webviewView.webview;
    webview.options = { enableScripts: true };

    webview.html = this._getHtml();

    attachChatMessageHandler({
      webview,
      getController: () => this._currentController(),
      registry: this._registry,
      panelManager: this._panelManager,
      postBind: () => this._rebindAndPost(),
      getBindToken: () => this._bindToken,
    });

    // Auto-create a first chat if registry is empty.
    if (this._registry.size === 0) {
      this._registry.create({ title: 'Chat 1' });
    }
    this._rebindAndPost();

    this._registryListener = this._registry.onDidChange(() => {
      // Re-post tab list. If active chat changed externally, rebind.
      if (this._currentChatId !== this._registry.activeId) {
        this._rebindAndPost();
      } else {
        this._postTabState();
      }
    });

    webviewView.onDidDispose(() => {
      if (this._currentRegistration) {
        try { this._currentRegistration.dispose(); } catch { /* ignore */ }
        this._currentRegistration = null;
      }
      if (this._registryListener) {
        try { this._registryListener.dispose(); } catch { /* ignore */ }
        this._registryListener = null;
      }
      if (this._webviewView === webviewView) this._webviewView = null;
    });
  }

  _getHtml() {
    const nonce = crypto.randomBytes(16).toString('hex');
    return renderChatHtml({ nonce, platform: process.platform, multi: true });
  }

  _currentController() {
    return this._registry.get(this._currentChatId);
  }

  _rebindAndPost() {
    const activeId = this._registry.activeId;
    if (activeId !== this._currentChatId) {
      // Detach from previous controller's broadcast set.
      if (this._currentRegistration) {
        try { this._currentRegistration.dispose(); } catch { /* ignore */ }
        this._currentRegistration = null;
      }
      this._currentChatId = activeId;
      this._bindToken += 1;

      if (activeId) {
        const controller = this._registry.get(activeId);
        if (controller && this._webviewView) {
          this._currentRegistration = controller.registerWebview(this._webviewView.webview);
          const msgs = controller.getMessages();
          if (msgs.length > 0) {
            // Atomic swap: send restore first; webview's restore handler clears
            // existing DOM before re-rendering, so no empty-flash.
            this._webviewView.webview.postMessage({ type: 'restore_messages', messages: msgs, replace: true });
          } else {
            this._webviewView.webview.postMessage({ type: 'session_cleared' });
          }
        }
      }
    }
    this._postTabState();
  }

  _postTabState() {
    if (!this._webviewView) return;
    const tabs = this._registry.list();
    const active = tabs.find(t => t.isActive);
    this._webviewView.webview.postMessage({
      type: 'tab_state',
      tabs,
      activeId: this._registry.activeId,
      bindToken: this._bindToken,
    });
    if (active) {
      this._webviewView.webview.postMessage({
        type: 'model_state',
        chatId: active.id,
        model: active.fullModel || 'inherit',
        streaming: active.isStreaming,
        dirty: this._currentController() ? this._currentController().modelDirty : false,
      });
    }
  }
}

/**
 * Editor-area webview panels, pinned per-chatId. Closing a panel detaches
 * only the webview from the controller — it does NOT kill the controller
 * (the sidebar tab keeps working).
 */
class OpenClaudeChatPanelManager {
  constructor(registry) {
    this._registry = registry;
    this._panels = new Map(); // chatId -> { panel, registration, bindToken }
    this._registryListener = null;
    this._registryListener = registry.onDidChange(() => this._refreshAllTabState());
  }

  openPanelForChat(chatId) {
    if (!this._registry.get(chatId)) return;

    const existing = this._panels.get(chatId);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside, false);
      return;
    }

    const entry = this._registry.getEntry(chatId);
    const title = entry ? `OpenClaude · ${entry.title}` : 'OpenClaude Chat';
    const panel = vscode.window.createWebviewPanel(
      'openclaude.chatPanel',
      title,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    const controller = this._registry.get(chatId);
    const registration = controller.registerWebview(panel.webview);
    const state = { panel, registration, bindToken: 0 };
    this._panels.set(chatId, state);

    panel.onDidDispose(() => {
      try { registration.dispose(); } catch { /* ignore */ }
      this._panels.delete(chatId);
    });

    const nonce = crypto.randomBytes(16).toString('hex');
    panel.webview.html = renderChatHtml({ nonce, platform: process.platform, multi: false });

    attachChatMessageHandler({
      webview: panel.webview,
      getController: () => this._registry.get(chatId),
      registry: this._registry,
      panelManager: this,
      postBind: () => this._postPanelState(chatId),
      getBindToken: () => state.bindToken,
    });

    const msgs = controller.getMessages();
    if (msgs.length > 0) panel.webview.postMessage({ type: 'restore_messages', messages: msgs });
    this._postPanelState(chatId);
  }

  _postPanelState(chatId) {
    const state = this._panels.get(chatId);
    if (!state) return;
    const entry = this._registry.getEntry(chatId);
    if (!entry) return;
    state.bindToken += 1;
    state.panel.webview.postMessage({
      type: 'tab_state',
      tabs: [{
        id: chatId,
        title: entry.title,
        model: entry.controller.model || entry.model,
        fullModel: entry.controller.model || entry.model,
        isStreaming: entry.controller.isStreaming,
        isActive: true,
      }],
      activeId: chatId,
      bindToken: state.bindToken,
      panelMode: true,
    });
    state.panel.webview.postMessage({
      type: 'model_state',
      chatId,
      model: entry.controller.model || entry.model || 'inherit',
      streaming: entry.controller.isStreaming,
      dirty: entry.controller.modelDirty,
    });
  }

  _refreshAllTabState() {
    for (const chatId of Array.from(this._panels.keys())) {
      if (!this._registry.get(chatId)) {
        // Underlying chat removed — close the panel.
        const state = this._panels.get(chatId);
        if (state) try { state.panel.dispose(); } catch { /* ignore */ }
        continue;
      }
      this._postPanelState(chatId);
    }
  }

  dispose() {
    if (this._registryListener) {
      try { this._registryListener.dispose(); } catch { /* ignore */ }
      this._registryListener = null;
    }
    for (const { panel } of this._panels.values()) {
      try { panel.dispose(); } catch { /* ignore */ }
    }
    this._panels.clear();
  }
}

module.exports = {
  ChatController,
  OpenClaudeChatViewProvider,
  OpenClaudeChatPanelManager,
};
