/**
 * ChatRegistry — owns a Map<chatId, ChatController> for the multi-chat
 * Command Centre. Each chat has its own ProcessManager (CLI subprocess),
 * its own model, its own session id, and its own webview subscribers.
 *
 * Persistence note: registry metadata (id, title, model, sessionId) is
 * serialized to globalState by the extension. Message history is NOT
 * stored here — it lives in the CLI's session files and is reloaded
 * on demand via SessionManager.loadSession(sessionId).
 */

const vscode = require('vscode');
const crypto = require('crypto');
const { ChatController } = require('./chatProvider');

const MAX_CHATS = 8;
const DEFAULT_MODEL = 'inherit';

function makeChatId() {
  return 'c_' + crypto.randomBytes(6).toString('hex');
}

function shortModelLabel(model) {
  if (!model || model === 'inherit') return 'Inherit';
  const map = {
    'claude-opus-4-7': 'Opus 4.7',
    'claude-opus-4-7-1m': 'Opus 4.7 1M',
    'claude-sonnet-4-6': 'Sonnet 4.6',
    'claude-haiku-4-5': 'Haiku 4.5',
  };
  return map[model] || model;
}

class ChatRegistry {
  constructor(sessionManager) {
    this._sessionManager = sessionManager;
    this._chats = new Map(); // chatId -> { controller, title, model, sessionId, createdAt }
    this._order = [];
    this._activeId = null;
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChange = this._onDidChange.event;
  }

  get sessionManager() { return this._sessionManager; }
  get size() { return this._chats.size; }
  get activeId() { return this._activeId; }

  list() {
    return this._order
      .map(id => {
        const entry = this._chats.get(id);
        if (!entry) return null;
        return {
          id,
          title: entry.title,
          model: shortModelLabel(entry.model),
          fullModel: entry.model,
          sessionId: entry.controller.sessionId,
          isStreaming: !!entry.controller.isStreaming,
          isActive: id === this._activeId,
        };
      })
      .filter(Boolean);
  }

  get(chatId) {
    const entry = this._chats.get(chatId);
    return entry ? entry.controller : null;
  }

  getEntry(chatId) {
    return this._chats.get(chatId) || null;
  }

  create({ title, model, sessionId } = {}) {
    if (this._chats.size >= MAX_CHATS) {
      throw new Error(`Multi-chat limit reached (${MAX_CHATS}). Close a chat first.`);
    }
    const id = makeChatId();
    const controller = new ChatController(this._sessionManager);
    const entry = {
      controller,
      title: title || `Chat ${this._order.length + 1}`,
      model: model || DEFAULT_MODEL,
      sessionId: sessionId || null,
      createdAt: Date.now(),
    };
    this._chats.set(id, entry);
    this._order.push(id);
    // Forward streaming-state changes for the tab-strip badge.
    const sub = controller.onDidChangeState(() => this._fire());
    entry._sub = sub;
    if (!this._activeId) this._activeId = id;
    this._fire();
    return id;
  }

  remove(chatId) {
    const entry = this._chats.get(chatId);
    if (!entry) return false;
    try { entry._sub && entry._sub.dispose(); } catch { /* ignore */ }
    try { entry.controller.dispose(); } catch { /* ignore */ }
    this._chats.delete(chatId);
    this._order = this._order.filter(id => id !== chatId);
    if (this._activeId === chatId) {
      this._activeId = this._order[0] || null;
    }
    this._fire();
    return true;
  }

  setActive(chatId) {
    if (!this._chats.has(chatId)) return false;
    if (this._activeId === chatId) return true;
    this._activeId = chatId;
    this._fire();
    return true;
  }

  setTitle(chatId, title) {
    const entry = this._chats.get(chatId);
    if (!entry) return false;
    entry.title = title;
    this._fire();
    return true;
  }

  setModel(chatId, model) {
    const entry = this._chats.get(chatId);
    if (!entry) return false;
    entry.model = model || DEFAULT_MODEL;
    this._fire();
    return true;
  }

  setSessionId(chatId, sessionId) {
    const entry = this._chats.get(chatId);
    if (!entry) return false;
    entry.sessionId = sessionId || null;
    return true;
  }

  serialize() {
    return {
      chats: this._order
        .map(id => {
          const e = this._chats.get(id);
          if (!e) return null;
          return {
            id,
            title: e.title,
            model: e.model,
            sessionId: e.controller.sessionId || e.sessionId || null,
            createdAt: e.createdAt,
          };
        })
        .filter(Boolean),
      activeId: this._activeId,
    };
  }

  /**
   * Re-create chats from a serialized snapshot.
   * Controllers are NOT auto-started; the user triggers process spawn by
   * sending the first message, which is when --resume <sessionId> kicks in.
   */
  restore(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.chats)) return;
    for (const c of snapshot.chats) {
      if (this._chats.size >= MAX_CHATS) break;
      const controller = new ChatController(this._sessionManager);
      // Pre-seed the controller's saved session id so the next sendMessage
      // resumes it instead of starting fresh.
      if (c.sessionId) controller._currentSessionId = c.sessionId;
      const sub = controller.onDidChangeState(() => this._fire());
      this._chats.set(c.id, {
        controller,
        title: c.title || 'Chat',
        model: c.model || DEFAULT_MODEL,
        sessionId: c.sessionId || null,
        createdAt: c.createdAt || Date.now(),
        _sub: sub,
      });
      this._order.push(c.id);
    }
    this._activeId = snapshot.activeId && this._chats.has(snapshot.activeId)
      ? snapshot.activeId
      : (this._order[0] || null);
    this._fire();
  }

  dispose() {
    for (const id of Array.from(this._chats.keys())) this.remove(id);
    this._onDidChange.dispose();
  }

  _fire() {
    try { this._onDidChange.fire(this.list()); } catch { /* ignore */ }
  }
}

module.exports = { ChatRegistry, MAX_CHATS, DEFAULT_MODEL, shortModelLabel };
