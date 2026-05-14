/**
 * chatRenderer — produces the full self-contained HTML document for the chat
 * webview.  All CSS and JS are inlined (no external bundles).
 *
 * The webview JS communicates with the extension host via postMessage.
 * Incoming messages update the DOM incrementally so streaming feels fluid.
 */

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderChatHtml({ nonce, platform }) {
  const modKey = platform === 'darwin' ? 'Cmd' : 'Ctrl';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --oc-bg: #0a0908;
      --oc-panel: #110d0c;
      --oc-panel-strong: #17110f;
      --oc-panel-soft: #1d1512;
      --oc-border: #645041;
      --oc-border-soft: rgba(220,195,170,0.14);
      --oc-text: #f7efe5;
      --oc-text-dim: #dcc3aa;
      --oc-text-soft: #aa9078;
      --oc-accent: #d77757;
      --oc-accent-bright: #f09464;
      --oc-accent-soft: rgba(240,148,100,0.18);
      --oc-positive: #e8b86b;
      --oc-warning: #f3c969;
      --oc-critical: #ff8a6c;
      --oc-focus: #ffd3a1;
      --oc-user-bg: rgba(240,148,100,0.12);
      --oc-user-border: rgba(240,148,100,0.28);
      --oc-assistant-bg: rgba(255,255,255,0.03);
      --oc-assistant-border: rgba(220,195,170,0.10);
      --oc-code-bg: #1a1310;
      --oc-code-border: rgba(220,195,170,0.12);
      --oc-tool-bg: rgba(232,184,107,0.06);
      --oc-tool-border: rgba(232,184,107,0.22);
      --oc-perm-bg: rgba(255,138,108,0.08);
      --oc-perm-border: rgba(255,138,108,0.35);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; }
    body {
      font-family: var(--vscode-font-family, "Segoe UI", system-ui, sans-serif);
      font-size: 13px;
      color: var(--oc-text);
      background: var(--oc-bg);
      display: flex;
      flex-direction: column;
      position: relative;
    }

    /* ── Header ── */
    .chat-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--oc-border-soft);
      background: var(--oc-panel);
      flex-shrink: 0;
    }
    .chat-header .brand {
      font-weight: 700;
      font-size: 14px;
      color: var(--oc-text);
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chat-header .brand-accent { color: var(--oc-accent-bright); }
    .header-btn {
      border: 1px solid var(--oc-border-soft);
      border-radius: 6px;
      background: rgba(255,255,255,0.04);
      color: var(--oc-text-dim);
      padding: 4px 8px;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .header-btn:hover { border-color: var(--oc-accent); color: var(--oc-text); }
    .header-btn.danger { border-color: var(--oc-critical); color: var(--oc-critical); }
    .header-btn.danger:hover { background: rgba(255,138,108,0.12); }
    #abortBtn { display: none; }

    /* ── Status bar ── */
    .status-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      font-size: 11px;
      color: var(--oc-text-soft);
      border-bottom: 1px solid var(--oc-border-soft);
      background: var(--oc-panel);
      flex-shrink: 0;
    }
    .status-bar .status-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--oc-text-soft);
      flex-shrink: 0;
    }
    .status-bar .status-dot.connected { background: var(--oc-positive); }
    .status-bar .status-dot.streaming { background: var(--oc-accent-bright); animation: pulse 1s infinite; }
    .status-bar .status-dot.error { background: var(--oc-critical); }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    .status-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status-usage { color: var(--oc-text-soft); }

    /* ── Message list ── */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .messages::-webkit-scrollbar { width: 6px; }
    .messages::-webkit-scrollbar-track { background: transparent; }
    .messages::-webkit-scrollbar-thumb { background: rgba(220,195,170,0.18); border-radius: 3px; }

    /* ── Welcome screen ── */
    .welcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      text-align: center;
      padding: 32px 16px;
      gap: 16px;
    }
    .welcome-title { font-size: 20px; font-weight: 700; color: var(--oc-text); }
    .welcome-title .accent { color: var(--oc-accent-bright); }
    .welcome-sub { font-size: 13px; color: var(--oc-text-dim); max-width: 36ch; }
    .welcome-hint { font-size: 11px; color: var(--oc-text-soft); }
    .welcome-hint kbd {
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid var(--oc-border-soft);
      background: rgba(255,255,255,0.04);
      font-family: inherit;
      font-size: 11px;
    }

    /* ── User message ── */
    .msg-user {
      align-self: flex-end;
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 14px 14px 4px 14px;
      background: var(--oc-user-bg);
      border: 1px solid var(--oc-user-border);
      word-break: break-word;
      white-space: pre-wrap;
    }

    /* ── Assistant message ── */
    .msg-assistant {
      align-self: flex-start;
      max-width: 95%;
      padding: 10px 14px;
      border-radius: 4px 14px 14px 14px;
      background: var(--oc-assistant-bg);
      border: 1px solid var(--oc-assistant-border);
      word-break: break-word;
    }
    .msg-assistant .md-content { line-height: 1.55; }
    .msg-assistant .md-content:empty { display: none; }
    .msg-assistant .md-content p { margin-bottom: 8px; }
    .msg-assistant .md-content p:last-child { margin-bottom: 0; }
    .msg-assistant .md-content ul,
    .msg-assistant .md-content ol { padding-left: 20px; margin-bottom: 8px; }
    .msg-assistant .md-content li { margin-bottom: 4px; }
    .msg-assistant .md-content h1,
    .msg-assistant .md-content h2,
    .msg-assistant .md-content h3 {
      color: var(--oc-text);
      margin: 12px 0 6px;
      font-size: 14px;
      font-weight: 700;
    }
    .msg-assistant .md-content h1 { font-size: 16px; }
    .msg-assistant .md-content a { color: var(--oc-accent-bright); text-decoration: underline; }
    .msg-assistant .md-content strong { color: var(--oc-text); font-weight: 700; }
    .msg-assistant .md-content em { font-style: italic; color: var(--oc-text-dim); }
    .msg-assistant .md-content blockquote {
      border-left: 3px solid var(--oc-accent);
      padding: 4px 12px;
      margin: 8px 0;
      color: var(--oc-text-dim);
    }
    .msg-assistant .md-content hr {
      border: none;
      border-top: 1px solid var(--oc-border-soft);
      margin: 12px 0;
    }

    /* inline code */
    .md-content code:not(.code-block code) {
      padding: 1px 5px;
      border-radius: 4px;
      background: var(--oc-code-bg);
      border: 1px solid var(--oc-code-border);
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 12px;
      color: var(--oc-accent-bright);
    }

    /* fenced code */
    .code-wrapper {
      position: relative;
      margin: 8px 0;
      border-radius: 8px;
      border: 1px solid var(--oc-code-border);
      background: var(--oc-code-bg);
      overflow: hidden;
    }
    .code-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 10px;
      font-size: 11px;
      color: var(--oc-text-soft);
      border-bottom: 1px solid var(--oc-code-border);
      background: rgba(255,255,255,0.02);
    }
    .code-copy-btn {
      border: none;
      background: transparent;
      color: var(--oc-text-soft);
      cursor: pointer;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .code-copy-btn:hover { background: rgba(255,255,255,0.08); color: var(--oc-text); }
    .code-block {
      display: block;
      padding: 10px 12px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 12px;
      line-height: 1.5;
      white-space: pre;
      color: var(--oc-text-dim);
    }
    .code-block::-webkit-scrollbar { height: 4px; }
    .code-block::-webkit-scrollbar-thumb { background: rgba(220,195,170,0.2); border-radius: 2px; }

    /* keyword highlighting */
    .hl-keyword { color: #c586c0; }
    .hl-string { color: #ce9178; }
    .hl-comment { color: #6a9955; font-style: italic; }
    .hl-number { color: #b5cea8; }
    .hl-func { color: #dcdcaa; }
    .hl-type { color: #4ec9b0; }

    /* ── Tool use card ── */
    .tool-card {
      margin: 8px 0;
      border-radius: 8px;
      border: 1px solid var(--oc-tool-border);
      background: var(--oc-tool-bg);
      overflow: hidden;
    }
    .tool-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      cursor: pointer;
      user-select: none;
    }
    .tool-icon { font-size: 14px; flex-shrink: 0; }
    .tool-name { font-weight: 600; font-size: 12px; color: var(--oc-text); flex: 1; }
    .tool-status { font-size: 11px; color: var(--oc-text-soft); }
    .tool-status.running { color: var(--oc-accent-bright); }
    .tool-status.error { color: var(--oc-critical); }
    .tool-status.complete { color: var(--oc-positive); }
    .tool-chevron {
      font-size: 10px;
      color: var(--oc-text-soft);
      transition: transform 150ms;
    }
    .tool-card.expanded .tool-chevron { transform: rotate(90deg); }
    .tool-body {
      display: none;
      padding: 0 10px 10px;
      font-size: 12px;
      border-top: 1px solid var(--oc-tool-border);
    }
    .tool-card.expanded .tool-body { display: block; }
    .tool-input-label,
    .tool-output-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--oc-text-soft);
      margin: 8px 0 4px;
    }
    .tool-input-content,
    .tool-output-content {
      padding: 6px 8px;
      border-radius: 6px;
      background: rgba(0,0,0,0.2);
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 11px;
      color: var(--oc-text-dim);
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 200px;
      overflow-y: auto;
    }
    .tool-output-content.error { color: var(--oc-critical); }
    .tool-path {
      font-weight: 400;
      color: var(--oc-text-soft);
      font-size: 11px;
      margin-left: 4px;
    }
    .file-link {
      color: var(--oc-accent-bright);
      cursor: pointer;
      text-decoration: none;
      border-bottom: 1px dotted var(--oc-accent);
      transition: color 120ms, border-color 120ms;
    }
    .file-link:hover {
      color: var(--oc-focus);
      border-bottom-color: var(--oc-focus);
    }
    .tool-input-content.tool-diff-old {
      border-left: 3px solid var(--oc-critical);
      padding-left: 10px;
      color: #ff9e8a;
      text-decoration: line-through;
      opacity: 0.7;
    }
    .tool-input-content.tool-diff-new {
      border-left: 3px solid var(--oc-positive);
      padding-left: 10px;
      color: #c8e6a0;
    }
    .tool-diff-btn {
      margin-top: 6px;
      border: 1px solid var(--oc-accent);
      border-radius: 6px;
      background: rgba(240,148,100,0.08);
      color: var(--oc-accent-bright);
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
    }
    .tool-diff-btn:hover { background: rgba(240,148,100,0.16); }

    /* ── Permission card ── */
    .perm-card {
      margin: 8px 0;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--oc-perm-border);
      background: var(--oc-perm-bg);
    }
    .perm-title { font-weight: 700; font-size: 12px; color: var(--oc-critical); margin-bottom: 6px; }
    .perm-desc { font-size: 12px; color: var(--oc-text-dim); margin-bottom: 8px; }
    .perm-input {
      padding: 6px 8px;
      margin-bottom: 8px;
      border-radius: 6px;
      background: rgba(0,0,0,0.2);
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 11px;
      color: var(--oc-text-dim);
      white-space: pre-wrap;
      max-height: 120px;
      overflow-y: auto;
    }
    .perm-actions { display: flex; gap: 6px; }
    .perm-btn {
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid;
    }
    .perm-btn.allow {
      background: rgba(232,184,107,0.14);
      border-color: var(--oc-positive);
      color: var(--oc-positive);
    }
    .perm-btn.deny {
      background: rgba(255,138,108,0.1);
      border-color: var(--oc-critical);
      color: var(--oc-critical);
    }
    .perm-btn.allow-session {
      background: rgba(232,184,107,0.08);
      border-color: rgba(232,184,107,0.4);
      color: var(--oc-text-dim);
    }
    .perm-btn:hover { filter: brightness(1.15); }

    /* ── Status pill ── */
    .msg-status {
      align-self: center;
      font-size: 11px;
      color: var(--oc-text-soft);
      padding: 4px 12px;
      border-radius: 999px;
      border: 1px solid var(--oc-border-soft);
      background: rgba(255,255,255,0.02);
    }

    /* ── Rate limit ── */
    .msg-rate-limit {
      align-self: center;
      font-size: 11px;
      color: var(--oc-warning);
      padding: 6px 14px;
      border-radius: 8px;
      border: 1px solid rgba(243,201,105,0.3);
      background: rgba(243,201,105,0.06);
    }

    /* ── Thinking block ── */
    .thinking-block {
      display: none;
      align-self: flex-start;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid rgba(200,160,255,0.25);
      background: rgba(160,120,220,0.08);
      margin: 4px 0;
      gap: 6px;
      flex-direction: column;
    }
    .thinking-block.visible { display: flex; }
    .thinking-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #c4a0ff;
      font-weight: 600;
    }
    .thinking-spinner {
      width: 12px; height: 12px;
      border: 2px solid rgba(200,160,255,0.3);
      border-top-color: #c4a0ff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .thinking-meta {
      font-size: 11px;
      color: var(--oc-text-soft);
    }

    /* ── Typing indicator ── */
    .typing-indicator {
      display: none;
      align-self: flex-start;
      padding: 10px 14px;
      gap: 4px;
    }
    .typing-indicator.visible { display: flex; }
    .typing-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--oc-accent);
      animation: typingBounce 1.2s infinite;
    }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typingBounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30% { transform: translateY(-4px); opacity: 1; }
    }

    /* ── Input area ── */
    .input-area {
      display: flex;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid var(--oc-border-soft);
      background: var(--oc-panel);
      flex-shrink: 0;
      align-items: flex-end;
    }
    .input-area textarea {
      flex: 1;
      min-height: 36px;
      max-height: 160px;
      padding: 8px 12px;
      border: 1px solid var(--oc-border-soft);
      border-radius: 10px;
      background: rgba(255,255,255,0.04);
      color: var(--oc-text);
      font-family: inherit;
      font-size: 13px;
      resize: none;
      outline: none;
      line-height: 1.4;
    }
    .input-area textarea::placeholder { color: var(--oc-text-soft); }
    .input-area textarea:focus { border-color: var(--oc-accent); }
    .send-btn {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      border: 1px solid var(--oc-accent);
      background: linear-gradient(135deg, rgba(240,148,100,0.2), rgba(215,119,87,0.12));
      color: var(--oc-accent-bright);
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .send-btn:hover { background: rgba(240,148,100,0.25); }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    /* ── Session list overlay ── */
    .session-overlay {
      display: none;
      position: absolute;
      inset: 0;
      z-index: 100;
      background: rgba(5,5,5,0.92);
      flex-direction: column;
    }
    .session-overlay.visible { display: flex; }
    .session-overlay-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--oc-border-soft);
    }
    .session-overlay-header h2 { font-size: 14px; font-weight: 700; flex: 1; }
    .session-search {
      margin: 8px 12px;
      padding: 8px 10px;
      border: 1px solid var(--oc-border-soft);
      border-radius: 8px;
      background: rgba(255,255,255,0.04);
      color: var(--oc-text);
      font-size: 13px;
      outline: none;
    }
    .session-search:focus { border-color: var(--oc-accent); }
    .session-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px;
    }
    .session-group-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--oc-text-soft);
      padding: 8px 0 4px;
    }
    .session-item {
      padding: 10px;
      border-radius: 8px;
      border: 1px solid transparent;
      cursor: pointer;
      margin-bottom: 4px;
    }
    .session-item:hover { background: rgba(255,255,255,0.04); border-color: var(--oc-border-soft); }
    .session-item-title { font-weight: 600; font-size: 13px; color: var(--oc-text); margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-item-preview { font-size: 11px; color: var(--oc-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-item-time { font-size: 10px; color: var(--oc-text-soft); margin-top: 2px; }
    .session-empty { text-align: center; padding: 32px; color: var(--oc-text-soft); }

    /* ── Tab strip (multi-chat) ── */
    .tab-strip { display: flex; align-items: stretch; background: var(--oc-panel-strong); border-bottom: 1px solid var(--oc-border-soft); height: 34px; flex-shrink: 0; }
    .tab-strip.hidden { display: none; }
    .tab-strip-inner { display: flex; overflow-x: auto; overflow-y: hidden; flex: 1; align-items: stretch; scrollbar-width: thin; scrollbar-color: var(--oc-border-soft) transparent; }
    .tab-strip-inner::-webkit-scrollbar { height: 4px; }
    .tab-strip-inner::-webkit-scrollbar-thumb { background: var(--oc-border-soft); border-radius: 2px; }
    .tab { display: flex; align-items: center; gap: 6px; padding: 0 10px; cursor: pointer; border-right: 1px solid var(--oc-border-soft); white-space: nowrap; font-size: 12px; color: var(--oc-text-dim); background: transparent; transition: background 0.15s; user-select: none; min-width: 0; }
    .tab:hover { background: rgba(255,255,255,0.04); color: var(--oc-text); }
    .tab.active { background: rgba(240,148,100,0.10); border-bottom: 2px solid var(--oc-accent-bright); color: var(--oc-text); }
    .tab.streaming .tab-title::before { content: '● '; color: var(--oc-accent-bright); animation: tab-pulse 1.2s infinite; }
    @keyframes tab-pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
    .tab-title { overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
    .tab-model { font-size: 10px; padding: 1px 5px; border-radius: 3px; background: rgba(240,148,100,0.12); color: var(--oc-accent-bright); flex-shrink: 0; }
    .tab-close, .tab-popout { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 3px; font-size: 12px; line-height: 1; color: var(--oc-text-soft); background: transparent; border: none; cursor: pointer; padding: 0; }
    .tab-close:hover { background: rgba(255,138,108,0.25); color: var(--oc-critical); }
    .tab-popout:hover { background: rgba(240,148,100,0.20); color: var(--oc-accent-bright); }
    .tab-new { display: flex; align-items: center; justify-content: center; width: 32px; flex-shrink: 0; background: transparent; border: none; border-left: 1px solid var(--oc-border-soft); color: var(--oc-text-soft); font-size: 18px; cursor: pointer; }
    .tab-new:hover { background: rgba(240,148,100,0.15); color: var(--oc-accent-bright); }

    /* ── Model picker ── */
    .model-picker { position: relative; display: inline-flex; align-items: center; margin-right: 6px; }
    .model-picker-button { display: flex; align-items: center; gap: 6px; padding: 4px 10px; background: rgba(240,148,100,0.10); border: 1px solid rgba(240,148,100,0.40); border-radius: 6px; color: var(--oc-text); cursor: pointer; font-size: 12px; white-space: nowrap; font-weight: 600; }
    .model-picker-button:hover:not(:disabled) { border-color: var(--oc-accent-bright); background: rgba(240,148,100,0.18); }
    .model-resolved-hint { font-size: 10px; color: var(--oc-text-soft); font-weight: 400; margin-left: 4px; }
    .model-picker-button:disabled { opacity: 0.55; cursor: not-allowed; }
    .model-chevron { font-size: 9px; opacity: 0.7; }
    .model-lock { font-size: 11px; margin-left: 2px; }
    .model-popover { position: absolute; top: 100%; right: 0; margin-top: 4px; min-width: 320px; max-width: 420px; background: var(--oc-panel-strong); border: 1px solid var(--oc-border-soft); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.4); z-index: 1000; padding: 4px 0; display: flex; flex-direction: column; max-height: 60vh; }
    .model-popover[hidden] { display: none; }
    .model-search { margin: 6px 8px 4px; }
    .model-list { overflow-y: auto; flex: 1; min-height: 0; padding-bottom: 4px; }
    .model-provider-header { padding: 8px 12px 3px; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--oc-text-soft); position: sticky; top: 0; background: var(--oc-panel-strong); }
    .model-option { padding: 5px 14px 5px 22px; cursor: pointer; font-size: 12px; color: var(--oc-text); display: flex; align-items: baseline; gap: 8px; }
    .model-option:hover { background: rgba(240,148,100,0.18); }
    .model-option.active { background: rgba(240,148,100,0.10); color: var(--oc-accent-bright); font-weight: 600; }
    .model-option.no-results { padding: 14px; color: var(--oc-text-soft); cursor: default; font-style: italic; }
    .model-option.no-results:hover { background: transparent; }
    .model-option-id { font-family: var(--vscode-editor-font-family, Consolas, monospace); font-size: 11px; color: var(--oc-text-dim); }
    .model-option.preset { padding-left: 14px; font-weight: 500; }
    .model-divider { height: 1px; background: var(--oc-border-soft); margin: 4px 8px; }
    .model-custom-row { padding: 4px 10px 8px; }
    .model-custom-row[hidden] { display: none; }
    .model-custom-input { width: 100%; box-sizing: border-box; padding: 4px 8px; border: 1px solid var(--oc-border-soft); border-radius: 4px; background: var(--oc-bg); color: var(--oc-text); font-size: 12px; outline: none; font-family: inherit; }
    .model-custom-input:focus { border-color: var(--oc-accent-bright); }
    .model-dirty-badge { padding: 4px 14px 6px; font-size: 10px; color: var(--oc-warning); }
    .model-dirty-badge[hidden] { display: none; }
  </style>
</head>
<body>
  <div class="tab-strip" id="tabStrip">
    <div class="tab-strip-inner" id="tabStripInner"></div>
    <button class="tab-new" id="tabNewBtn" title="New chat">+</button>
  </div>

  <div class="chat-header">
    <div class="brand">Open<span class="brand-accent">Claude</span></div>
    <div class="model-picker" id="modelPicker">
      <button class="model-picker-button" id="modelPickerButton" title="Model used for THIS chat tab. Click to change. Each tab can use a different model." type="button">
        <span class="model-label" id="modelLabel">CLI default</span>
        <span class="model-resolved-hint" id="modelResolvedHint" hidden></span>
        <span class="model-chevron">&#x25be;</span>
        <span class="model-lock" id="modelLock" hidden>&#x1f512;</span>
      </button>
      <div class="model-popover" id="modelPopover" hidden>
        <input class="model-custom-input model-search" id="modelSearch" type="text" placeholder="Search 100+ models, or type a custom id…" autocomplete="off" />
        <div class="model-list" id="modelList">
          <div class="model-option" data-model="inherit">CLI default</div>
        </div>
        <div class="model-dirty-badge" id="modelDirtyBadge" hidden>&#x21bb; applies on next message (model only updates on process restart)</div>
      </div>
    </div>
    <button class="header-btn" id="historyBtn" title="Session history">History</button>
    <button class="header-btn" id="newChatBtn" title="New chat">+ New</button>
    <button class="header-btn danger" id="abortBtn" title="Abort generation">Stop</button>
  </div>
  <div class="status-bar">
    <span class="status-dot" id="statusDot"></span>
    <span class="status-text" id="statusText">Ready</span>
    <span class="status-usage" id="statusUsage"></span>
  </div>

  <div class="messages" id="messages">
    <div class="welcome" id="welcomeScreen">
      <div class="welcome-title">Open<span class="accent">Claude</span></div>
      <div class="welcome-sub">Ask a question, request a code change, or start a new task.</div>
      <div class="welcome-hint">Press <kbd>${escapeHtml(modKey)}+L</kbd> to focus input</div>
    </div>
  </div>

  <div class="thinking-block" id="thinkingBlock">
    <div class="thinking-header">
      <div class="thinking-spinner"></div>
      <span id="thinkingLabel">Thinking...</span>
    </div>
    <div class="thinking-meta" id="thinkingMeta"></div>
  </div>

  <div class="typing-indicator" id="typingIndicator">
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
  </div>

  <div class="input-area">
    <textarea id="chatInput" placeholder="Message OpenClaude..." rows="1"></textarea>
    <button class="send-btn" id="sendBtn" title="Send message">&#x27A4;</button>
  </div>

  <!-- Session list overlay -->
  <div class="session-overlay" id="sessionOverlay">
    <div class="session-overlay-header">
      <h2>Session History</h2>
      <button class="header-btn" id="closeSessionsBtn">Close</button>
    </div>
    <input class="session-search" id="sessionSearch" type="text" placeholder="Search sessions..." />
    <div class="session-list" id="sessionList">
      <div class="session-empty">No sessions found</div>
    </div>
  </div>

<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();

  const messagesEl = document.getElementById('messages');
  const welcomeEl = document.getElementById('welcomeScreen');
  const inputEl = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const abortBtn = document.getElementById('abortBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const historyBtn = document.getElementById('historyBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const statusUsage = document.getElementById('statusUsage');
  const typingIndicator = document.getElementById('typingIndicator');
  const sessionOverlay = document.getElementById('sessionOverlay');
  const closeSessionsBtn = document.getElementById('closeSessionsBtn');
  const sessionSearch = document.getElementById('sessionSearch');
  const sessionList = document.getElementById('sessionList');

  let isStreaming = false;
  let currentAssistantEl = null;
  let currentTextEl = null;
  const toolResultMap = {};

  /* ── Markdown renderer ── */
  function renderMarkdown(text) {
    if (!text) return '';
    let html = escapeForMd(text);

    // fenced code blocks
    html = html.replace(/\`\`\`(\\w*?)\\n([\\s\\S]*?)\`\`\`/g, (_, lang, code) => {
      const langLabel = lang || 'text';
      const highlighted = highlightCode(code, langLabel);
      const id = 'cb-' + Math.random().toString(36).slice(2, 8);
      return '<div class="code-wrapper"><div class="code-header">' +
        '<span>' + langLabel + '</span>' +
        '<button class="code-copy-btn" data-copy-id="' + id + '">Copy</button></div>' +
        '<code class="code-block" id="' + id + '">' + highlighted + '</code></div>';
    });

    // inline code
    html = html.replace(/\`([^\`]+?)\`/g, '<code>$1</code>');

    // headings
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // hr
    html = html.replace(/^---$/gm, '<hr/>');

    // bold / italic
    html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');

    // links
    html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" title="$2">$1</a>');

    // unordered lists (simple)
    html = html.replace(/^[\\-\\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\\/li>\\n?)+)/g, '<ul>$1</ul>');

    // ordered lists
    html = html.replace(/^\\d+\\. (.+)$/gm, '<li>$1</li>');

    // paragraphs (double newline)
    html = html.replace(/\\n\\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\\/p>/g, '');
    html = html.replace(/<p>(<h[123]>)/g, '$1');
    html = html.replace(/(<\\/h[123]>)<\\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\\/ul>)<\\/p>/g, '$1');
    html = html.replace(/<p>(<blockquote>)/g, '$1');
    html = html.replace(/(<\\/blockquote>)<\\/p>/g, '$1');
    html = html.replace(/<p>(<hr\\/>)/g, '$1');
    html = html.replace(/(<hr\\/>)<\\/p>/g, '$1');
    html = html.replace(/<p>(<div class="code-wrapper">)/g, '$1');
    html = html.replace(/(<\\/div>)<\\/p>/g, '$1');

    return html;
  }

  function escapeForMd(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function highlightCode(code, lang) {
    let result = code;
    const kwPattern = /\\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|typeof|instanceof|switch|case|break|default|continue|do|in|of|yield|void|delete|true|false|null|undefined|this|super|extends|implements|interface|type|enum|public|private|protected|static|readonly|abstract|def|print|self|elif|except|finally|with|as|lambda|pass|raise|None|True|False)\\b/g;
    const strPattern = /(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|'[^']*?'|"[^"]*?")/g;
    const commentPattern = /(\\/{2}.*$|#.*$)/gm;
    const numPattern = /\\b(\\d+\\.?\\d*)\\b/g;

    result = result.replace(commentPattern, '<span class="hl-comment">$1</span>');
    result = result.replace(strPattern, '<span class="hl-string">$1</span>');
    result = result.replace(kwPattern, '<span class="hl-keyword">$1</span>');
    result = result.replace(numPattern, '<span class="hl-number">$1</span>');

    return result;
  }

  /* ── DOM helpers ── */
  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function hideWelcome() {
    if (welcomeEl) welcomeEl.style.display = 'none';
  }

  function showWelcome() {
    if (welcomeEl) welcomeEl.style.display = 'flex';
  }

  function setStreaming(val, label) {
    isStreaming = val;
    abortBtn.style.display = val ? 'block' : 'none';
    sendBtn.disabled = val;
    typingIndicator.classList.toggle('visible', val);
    statusDot.className = 'status-dot ' + (val ? 'streaming' : 'connected');
    statusText.textContent = label || (val ? 'Generating...' : 'Ready');
  }

  function setStatusLabel(label) {
    statusText.textContent = label;
  }

  function appendUserMessage(text) {
    hideWelcome();
    const el = document.createElement('div');
    el.className = 'msg-user';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function getOrCreateAssistantEl() {
    if (!currentAssistantEl) {
      hideWelcome();
      currentAssistantEl = document.createElement('div');
      currentAssistantEl.className = 'msg-assistant';
      currentTextEl = document.createElement('div');
      currentTextEl.className = 'md-content';
      currentAssistantEl.appendChild(currentTextEl);
      messagesEl.appendChild(currentAssistantEl);
    }
    return { container: currentAssistantEl, textEl: currentTextEl };
  }

  function finalizeAssistant() {
    // Hide the text div if it's empty (model went straight to tool use)
    if (currentTextEl && !currentTextEl.textContent.trim()) {
      currentTextEl.style.display = 'none';
    }
    // Remove the entire bubble if it has no visible content at all
    if (currentAssistantEl) {
      const hasText = currentTextEl && currentTextEl.textContent.trim();
      const hasToolCards = currentAssistantEl.querySelector('.tool-card');
      if (!hasText && !hasToolCards) {
        currentAssistantEl.remove();
      }
    }
    currentAssistantEl = null;
    currentTextEl = null;
  }

  function appendToolCard(toolUse) {
    const { container } = getOrCreateAssistantEl();
    const card = document.createElement('div');
    card.className = 'tool-card expanded';
    card.dataset.toolId = toolUse.id || '';
    const statusClass = toolUse.status || 'running';
    const statusLabel = statusClass === 'running' ? 'Running...'
      : statusClass === 'error' ? 'Error' : 'Done';

    var inputSummary = '';
    if (toolUse.input && typeof toolUse.input === 'object') {
      if (toolUse.input.file_path || toolUse.input.path) {
        inputSummary = (toolUse.input.file_path || toolUse.input.path);
      }
      if (toolUse.input.command) {
        inputSummary = toolUse.input.command;
      }
    }
    if (!inputSummary) inputSummary = toolUse.inputPreview || '';

    var inputDetail = '';
    if (toolUse.input && typeof toolUse.input === 'object') {
      if (toolUse.input.new_string || toolUse.input.content) {
        var content = toolUse.input.new_string || toolUse.input.content || '';
        if (content.length > 500) content = content.slice(0, 500) + '... (truncated)';
        inputDetail = '<div class="tool-input-label">Changes</div>' +
          '<div class="tool-input-content">' + escapeForMd(content) + '</div>';
      }
      if (toolUse.input.old_string && toolUse.input.new_string) {
        var oldStr = toolUse.input.old_string;
        var newStr = toolUse.input.new_string;
        if (oldStr.length > 300) oldStr = oldStr.slice(0, 300) + '...';
        if (newStr.length > 300) newStr = newStr.slice(0, 300) + '...';
        inputDetail = '<div class="tool-input-label">Replace</div>' +
          '<div class="tool-input-content tool-diff-old">' + escapeForMd(oldStr) + '</div>' +
          '<div class="tool-input-label">With</div>' +
          '<div class="tool-input-content tool-diff-new">' + escapeForMd(newStr) + '</div>';
      }
    }

    var isFileTool = inputSummary && !toolUse.input?.command;
    var fileLink = isFileTool
      ? '<a class="file-link" data-filepath="' + escapeForMd(inputSummary) + '" title="Open in editor">' + escapeForMd(inputSummary.split(/[\\/]/).pop() || inputSummary) + '</a>'
      : (inputSummary ? escapeForMd(inputSummary.split(/[\\/]/).pop() || inputSummary) : '');
    var pathDisplay = isFileTool
      ? '<div class="tool-input-label">Path</div><div class="tool-input-content"><a class="file-link" data-filepath="' + escapeForMd(inputSummary) + '" title="Open in editor">' + escapeForMd(inputSummary) + '</a></div>'
      : (inputSummary ? '<div class="tool-input-label">' + (toolUse.input?.command ? 'Command' : 'Path') + '</div><div class="tool-input-content">' + escapeForMd(inputSummary) + '</div>' : '');

    card.innerHTML =
      '<div class="tool-header">' +
        '<span class="tool-icon">' + (toolUse.icon || '') + '</span>' +
        '<span class="tool-name">' + escapeForMd(toolUse.displayName || toolUse.name || 'Tool') +
          (fileLink ? ' <span class="tool-path">' + fileLink + '</span>' : '') +
        '</span>' +
        '<span class="tool-status ' + statusClass + '">' + statusLabel + '</span>' +
        '<span class="tool-chevron">&#9654;</span>' +
      '</div>' +
      '<div class="tool-body">' +
        pathDisplay +
        inputDetail +
        '<div class="tool-output-label">Output</div>' +
        '<div class="tool-output-content" data-tool-output="' + (toolUse.id || '') + '">Running...</div>' +
      '</div>';
    card.querySelector('.tool-header').addEventListener('click', () => {
      card.classList.toggle('expanded');
    });
    container.appendChild(card);
    scrollToBottom();
    return card;
  }

  function updateToolResult(toolUseId, content, isError) {
    const outputEl = document.querySelector('[data-tool-output="' + toolUseId + '"]');
    if (outputEl) {
      outputEl.textContent = content || '(done)';
      if (isError) outputEl.classList.add('error');
    }
    const card = document.querySelector('[data-tool-id="' + toolUseId + '"]');
    if (card) {
      const statusEl = card.querySelector('.tool-status');
      if (statusEl) {
        statusEl.className = 'tool-status ' + (isError ? 'error' : 'complete');
        statusEl.textContent = isError ? 'Error' : 'Done';
      }
    }
  }

  function updateToolProgress(toolUseId, content) {
    const outputEl = document.querySelector('[data-tool-output="' + toolUseId + '"]');
    if (outputEl && (outputEl.textContent === 'Waiting...' || outputEl.textContent === 'Running...')) {
      outputEl.textContent = content || '';
    }
  }

  function updateToolInput(toolUseId, input, toolName) {
    const card = document.querySelector('[data-tool-id="' + toolUseId + '"]');
    if (!card) return;
    const body = card.querySelector('.tool-body');
    if (!body) return;

    if (!input || typeof input !== 'object') return;

    // Update the header with clickable file path
    const nameEl = card.querySelector('.tool-name');
    if (nameEl && (input.file_path || input.path)) {
      const fp = input.file_path || input.path;
      const shortName = fp.split(/[\\/]/).pop() || fp;
      if (!nameEl.querySelector('.tool-path')) {
        nameEl.insertAdjacentHTML('beforeend', ' <span class="tool-path"><a class="file-link" data-filepath="' + escapeForMd(fp) + '" title="Open in editor">' + escapeForMd(shortName) + '</a></span>');
      }
    }

    // Update path display
    var pathHtml = '';
    if (input.file_path || input.path) {
      var fp = input.file_path || input.path;
      pathHtml = '<div class="tool-input-label">Path</div><div class="tool-input-content">' +
        '<a class="file-link" data-filepath="' + escapeForMd(fp) + '" title="Open in editor">' + escapeForMd(fp) + '</a></div>';
    }
    if (input.command) {
      pathHtml = '<div class="tool-input-label">Command</div><div class="tool-input-content">' +
        escapeForMd(input.command) + '</div>';
    }

    // Build diff display for edit operations
    var diffHtml = '';
    if (input.old_string && input.new_string) {
      var oldStr = input.old_string;
      var newStr = input.new_string;
      if (oldStr.length > 500) oldStr = oldStr.slice(0, 500) + '... (truncated)';
      if (newStr.length > 500) newStr = newStr.slice(0, 500) + '... (truncated)';
      diffHtml = '<div class="tool-input-label">Replace</div>' +
        '<div class="tool-input-content tool-diff-old">' + escapeForMd(oldStr) + '</div>' +
        '<div class="tool-input-label">With</div>' +
        '<div class="tool-input-content tool-diff-new">' + escapeForMd(newStr) + '</div>';
    } else if (input.content || input.new_string) {
      var content = input.content || input.new_string || '';
      if (content.length > 800) content = content.slice(0, 800) + '... (truncated)';
      diffHtml = '<div class="tool-input-label">Content</div>' +
        '<div class="tool-input-content tool-diff-new">' + escapeForMd(content) + '</div>';
    }

    // Keep the output element
    const outputEl = body.querySelector('[data-tool-output]');
    const outputHtml = outputEl ? outputEl.outerHTML : '';
    const outputLabel = '<div class="tool-output-label">Output</div>';

    body.innerHTML = pathHtml + diffHtml + outputLabel + outputHtml;
    card.classList.add('expanded');
    scrollToBottom();
  }

  function appendPermissionCard(perm) {
    hideWelcome();
    const el = document.createElement('div');
    el.className = 'perm-card';
    el.dataset.requestId = perm.requestId || '';
    el.innerHTML =
      '<div class="perm-title">Permission Required: ' + escapeForMd(perm.displayName || perm.toolName || 'Tool') + '</div>' +
      (perm.description ? '<div class="perm-desc">' + escapeForMd(perm.description) + '</div>' : '') +
      (perm.inputPreview ? '<div class="perm-input">' + escapeForMd(perm.inputPreview) + '</div>' : '') +
      '<div class="perm-actions">' +
        '<button class="perm-btn allow" data-action="allow">Allow</button>' +
        '<button class="perm-btn deny" data-action="deny">Deny</button>' +
        '<button class="perm-btn allow-session" data-action="allow-session">Allow for session</button>' +
      '</div>';
    el.querySelectorAll('.perm-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        vscode.postMessage({
          type: 'permission_response',
          requestId: perm.requestId,
          toolUseId: perm.toolUseId || null,
          action: action,
        });
        el.querySelectorAll('.perm-btn').forEach(b => { b.disabled = true; b.style.opacity = '0.4'; });
        btn.style.opacity = '1';
      });
    });
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function appendStatusMessage(text) {
    const el = document.createElement('div');
    el.className = 'msg-status';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function appendRateLimitMessage(text) {
    const el = document.createElement('div');
    el.className = 'msg-rate-limit';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  /* ── Thinking block ── */
  const thinkingBlock = document.getElementById('thinkingBlock');
  const thinkingLabel = document.getElementById('thinkingLabel');
  const thinkingMeta = document.getElementById('thinkingMeta');

  function showThinkingBlock() {
    thinkingBlock.classList.add('visible');
    thinkingLabel.textContent = 'Thinking...';
    thinkingMeta.textContent = '';
    setStatusLabel('Thinking...');
    scrollToBottom();
  }

  function updateThinkingBlock(tokens, elapsed) {
    const elapsedStr = elapsed >= 60
      ? Math.floor(elapsed / 60) + 'm ' + (elapsed % 60) + 's'
      : elapsed + 's';
    thinkingLabel.textContent = 'Thinking...';
    thinkingMeta.textContent = elapsedStr + ' · ~' + tokens + ' tokens';
    setStatusLabel('Thinking... (' + elapsedStr + ')');
  }

  function hideThinkingBlock() {
    thinkingBlock.classList.remove('visible');
    setStatusLabel('Generating...');
  }

  /* ── Session list ── */
  function renderSessionList(sessions) {
    if (!sessions || sessions.length === 0) {
      sessionList.innerHTML = '<div class="session-empty">No sessions found</div>';
      return;
    }
    const groups = groupByDate(sessions);
    let html = '';
    for (const [label, items] of groups) {
      html += '<div class="session-group-label">' + escapeForMd(label) + '</div>';
      for (const s of items) {
        html += '<div class="session-item" data-session-id="' + (s.id || '') + '">' +
          '<div class="session-item-title">' + escapeForMd(s.title || s.id || 'Untitled') + '</div>' +
          '<div class="session-item-preview">' + escapeForMd(s.preview || '') + '</div>' +
          '<div class="session-item-time">' + escapeForMd(s.timeLabel || '') + '</div>' +
        '</div>';
      }
    }
    sessionList.innerHTML = html;
    sessionList.querySelectorAll('.session-item').forEach(el => {
      el.addEventListener('click', () => {
        vscode.postMessage({ type: 'resume_session', sessionId: el.dataset.sessionId });
        sessionOverlay.classList.remove('visible');
      });
    });
  }

  function groupByDate(sessions) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const weekAgo = today - 604800000;
    const groups = new Map();
    for (const s of sessions) {
      const t = s.timestamp || 0;
      let label;
      if (t >= today) label = 'Today';
      else if (t >= yesterday) label = 'Yesterday';
      else if (t >= weekAgo) label = 'This Week';
      else label = 'Older';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(s);
    }
    return groups;
  }

  /* ── Input handling ── */
  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isStreaming) return;
    appendUserMessage(text);
    vscode.postMessage({ type: 'send_message', text });
    inputEl.value = '';
    autoResizeInput();
    setStreaming(true);
  }

  function autoResizeInput() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  }

  inputEl.addEventListener('input', autoResizeInput);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  sendBtn.addEventListener('click', sendMessage);
  abortBtn.addEventListener('click', () => vscode.postMessage({ type: 'abort' }));
  newChatBtn.addEventListener('click', () => vscode.postMessage({ type: 'new_session' }));
  historyBtn.addEventListener('click', () => {
    sessionOverlay.classList.toggle('visible');
    if (sessionOverlay.classList.contains('visible')) {
      vscode.postMessage({ type: 'request_sessions' });
      sessionSearch.focus();
    }
  });
  closeSessionsBtn.addEventListener('click', () => sessionOverlay.classList.remove('visible'));
  sessionSearch.addEventListener('input', () => {
    const q = sessionSearch.value.toLowerCase();
    sessionList.querySelectorAll('.session-item').forEach(el => {
      const text = el.textContent.toLowerCase();
      el.style.display = text.includes(q) ? '' : 'none';
    });
  });

  // Copy code handler (event delegation)
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.code-copy-btn');
    if (copyBtn) {
      const id = copyBtn.dataset.copyId;
      const codeEl = document.getElementById(id);
      if (codeEl) {
        const text = codeEl.textContent;
        vscode.postMessage({ type: 'copy_code', text });
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      }
      return;
    }

    const fileLink = e.target.closest('.file-link');
    if (fileLink) {
      e.preventDefault();
      e.stopPropagation();
      const filepath = fileLink.dataset.filepath;
      if (filepath) {
        vscode.postMessage({ type: 'open_file', path: filepath });
      }
      return;
    }
  });

  /* ── Message handling from extension ── */
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;

    switch (msg.type) {
      case 'stream_start':
        setStreaming(true, 'Generating...');
        getOrCreateAssistantEl();
        break;

      case 'stream_delta': {
        setStatusLabel('Generating...');
        const { textEl } = getOrCreateAssistantEl();
        textEl.innerHTML = renderMarkdown(msg.text || '');
        scrollToBottom();
        break;
      }

      case 'stream_end':
        if (msg.text) {
          const { textEl } = getOrCreateAssistantEl();
          textEl.innerHTML = renderMarkdown(msg.text);
        }
        finalizeAssistant();
        if (msg.usage) {
          const u = msg.usage;
          statusUsage.textContent = (u.input_tokens || 0) + ' in / ' + (u.output_tokens || 0) + ' out';
        }
        if (msg.final) {
          setStreaming(false);
        }
        scrollToBottom();
        break;

      case 'tool_use':
        appendToolCard(msg.toolUse);
        setStatusLabel('Running: ' + (msg.toolUse.displayName || msg.toolUse.name || 'tool') + '...');
        break;

      case 'tool_result':
        updateToolResult(msg.toolUseId, msg.content, msg.isError);
        break;

      case 'tool_input_ready':
        updateToolInput(msg.toolUseId, msg.input, msg.name);
        break;

      case 'tool_progress':
        updateToolProgress(msg.toolUseId, msg.content);
        break;

      case 'permission_request':
        appendPermissionCard(msg);
        break;

      case 'status':
        setStatusLabel(msg.content || 'Working...');
        break;

      case 'rate_limit':
        appendRateLimitMessage(msg.message || 'Rate limited');
        break;

      case 'thinking_start':
        showThinkingBlock();
        break;

      case 'thinking_delta':
        updateThinkingBlock(msg.tokens || 0, msg.elapsed || 0);
        break;

      case 'thinking_end':
        hideThinkingBlock();
        break;

      case 'system_info':
        if (msg.model) {
          statusUsage.textContent = msg.model;
        }
        break;

      case 'error':
        setStreaming(false);
        finalizeAssistant();
        statusDot.className = 'status-dot error';
        statusText.textContent = 'Error: ' + (msg.message || 'Unknown error');
        break;

      case 'session_list':
        renderSessionList(msg.sessions);
        break;

      case 'session_cleared':
        messagesEl.innerHTML = '';
        if (welcomeEl) {
          messagesEl.appendChild(welcomeEl);
          showWelcome();
        }
        currentAssistantEl = null;
        currentTextEl = null;
        statusUsage.textContent = '';
        statusDot.className = 'status-dot connected';
        statusText.textContent = 'Ready';
        break;

      case 'restore_messages':
        hideWelcome();
        if (msg.messages) {
          for (const m of msg.messages) {
            if (m.role === 'user') {
              appendUserMessage(m.text || '');
            } else if (m.role === 'assistant') {
              const { textEl } = getOrCreateAssistantEl();
              textEl.innerHTML = renderMarkdown(m.text || '');
              if (m.toolUses && m.toolUses.length > 0) {
                for (const tu of m.toolUses) {
                  var displayName = tu.name || 'Tool';
                  var icon = '';
                  var inputPreview = '';
                  if (tu.input && typeof tu.input === 'object') {
                    inputPreview = tu.input.file_path || tu.input.path || tu.input.command || '';
                  }
                  var card = appendToolCard({
                    id: tu.id,
                    name: tu.name,
                    displayName: displayName,
                    icon: icon,
                    inputPreview: inputPreview,
                    input: tu.input,
                    status: tu.status || 'complete',
                  });
                  if (tu.input) {
                    updateToolInput(String(tu.id), tu.input, tu.name);
                  }
                  if (tu.result !== undefined && tu.result !== null) {
                    updateToolResult(String(tu.id), tu.result, tu.isError || false);
                  } else {
                    updateToolResult(String(tu.id), '(done)', false);
                  }
                }
              }
              finalizeAssistant();
            }
          }
        }
        scrollToBottom();
        break;

      case 'connected':
        setStreaming(false);
        statusDot.className = 'status-dot connected';
        statusText.textContent = msg.message || 'Connected';
        break;

      default:
        break;
    }
  });

  // Focus input on Ctrl/Cmd+L
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
      e.preventDefault();
      inputEl.focus();
    }
  });

  // Restore state
  const prevState = vscode.getState();
  if (prevState && prevState.hasMessages) {
    vscode.postMessage({ type: 'restore_request' });
  }

  // ── Multi-chat: tab strip + model picker (registry-aware) ──
  let currentBindToken = 0;
  let currentChatId = null;
  let currentModel = 'inherit';
  let currentStreaming = false;
  let currentDirty = false;
  let panelMode = false;

  const tabStripEl = document.getElementById('tabStrip');
  const tabStripInner = document.getElementById('tabStripInner');
  const tabNewBtn = document.getElementById('tabNewBtn');

  const modelBtn = document.getElementById('modelPickerButton');
  const modelLabel = document.getElementById('modelLabel');
  const modelResolvedHint = document.getElementById('modelResolvedHint');
  const modelPopover = document.getElementById('modelPopover');
  const modelLock = document.getElementById('modelLock');
  const modelDirtyBadge = document.getElementById('modelDirtyBadge');
  const modelSearch = document.getElementById('modelSearch');
  const modelList = document.getElementById('modelList');
  let resolvedModel = null;
  let providerCatalog = []; // [{id, label, baseUrl, defaultModel, models: [{id, label}]}]

  const MODEL_LABELS = {
    'inherit': 'CLI default',
    'claude-opus-4-7': 'Opus 4.7',
    'claude-opus-4-7-1m': 'Opus 4.7 1M',
    'claude-sonnet-4-6': 'Sonnet 4.6',
    'claude-haiku-4-5': 'Haiku 4.5',
  };
  function modelShortLabel(m) {
    if (!m || m === 'inherit') return 'CLI default';
    return MODEL_LABELS[m] || m;
  }

  function renderTabs(tabs) {
    while (tabStripInner.firstChild) tabStripInner.removeChild(tabStripInner.firstChild);
    for (const tab of tabs) {
      const div = document.createElement('div');
      div.className = 'tab' + (tab.isActive ? ' active' : '') + (tab.isStreaming ? ' streaming' : '');
      div.dataset.chatId = tab.id;
      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = tab.title || 'Chat';
      div.appendChild(titleSpan);
      if (tab.model) {
        const m = document.createElement('span');
        m.className = 'tab-model';
        m.textContent = tab.model;
        div.appendChild(m);
      }
      if (tab.isActive && !panelMode) {
        const popout = document.createElement('button');
        popout.className = 'tab-popout';
        popout.type = 'button';
        popout.title = 'Open in new editor tab';
        popout.textContent = '↗';
        popout.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: 'open_in_new_tab', chatId: tab.id, bindToken: currentBindToken });
        });
        div.appendChild(popout);
      }
      if (!panelMode && tabs.length > 1) {
        const close = document.createElement('button');
        close.className = 'tab-close';
        close.type = 'button';
        close.title = 'Close chat';
        close.textContent = '×';
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: 'close_tab', chatId: tab.id, bindToken: currentBindToken });
        });
        div.appendChild(close);
      }
      div.addEventListener('click', () => {
        if (!tab.isActive) {
          vscode.postMessage({ type: 'switch_tab', chatId: tab.id, bindToken: currentBindToken });
        }
      });
      tabStripInner.appendChild(div);
    }
  }

  if (tabNewBtn) {
    tabNewBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'new_tab', bindToken: currentBindToken });
    });
  }

  function updateModelUI() {
    // Show resolved model in the label itself when CLI default is in use,
    // so users always see what's actually running.
    const isInherit = !currentModel || currentModel === 'inherit';
    if (isInherit && resolvedModel) {
      modelLabel.textContent = resolvedModel;
      modelResolvedHint.hidden = false;
      modelResolvedHint.textContent = '(default)';
      modelBtn.title = 'CLI default resolved to "' + resolvedModel + '". Click to override the model for THIS tab. Each chat tab can use a different model.';
    } else {
      modelLabel.textContent = modelShortLabel(currentModel);
      modelResolvedHint.hidden = true;
      modelResolvedHint.textContent = '';
      modelBtn.title = (currentModel || 'CLI default') + ' — click to change model for THIS chat tab. Each tab can have its own model.';
    }
    // Keep the picker openable even while streaming. Model changes can't be
    // hot-swapped (--model is a launch flag), so we just show the dirty badge
    // and apply on next process restart.
    modelBtn.disabled = false;
    modelLock.hidden = !currentStreaming;
    modelLock.title = currentStreaming ? 'Chat is streaming — model change will apply on next message' : '';
    modelDirtyBadge.hidden = !currentDirty;
    const opts = modelPopover.querySelectorAll('.model-option[data-model]');
    opts.forEach(el => {
      el.classList.toggle('active', el.dataset.model === currentModel);
    });
  }

  function setModelLocal(model) {
    if (!currentChatId) return;
    currentModel = model;
    modelPopover.hidden = true;
    updateModelUI();
    vscode.postMessage({ type: 'set_model', chatId: currentChatId, model: model, bindToken: currentBindToken });
  }

  function renderCatalog(filter) {
    const q = (filter || '').trim().toLowerCase();
    while (modelList.firstChild) modelList.removeChild(modelList.firstChild);

    // CLI default + Anthropic Claude Code presets always shown.
    const presets = [
      { id: 'inherit', label: 'CLI default (your openclaude config picks)' },
      { id: 'claude-opus-4-7', label: 'Opus 4.7' },
      { id: 'claude-opus-4-7-1m', label: 'Opus 4.7 (1M ctx)' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
    ];
    const headerEl = document.createElement('div');
    headerEl.className = 'model-provider-header';
    headerEl.textContent = 'Quick presets';
    modelList.appendChild(headerEl);
    let shown = 0;
    for (const p of presets) {
      if (q && !(p.id.toLowerCase().includes(q) || p.label.toLowerCase().includes(q))) continue;
      const opt = document.createElement('div');
      opt.className = 'model-option preset' + (p.id === currentModel ? ' active' : '');
      opt.dataset.model = p.id;
      opt.textContent = p.label;
      opt.addEventListener('click', () => setModelLocal(p.id));
      modelList.appendChild(opt);
      shown += 1;
    }

    // Provider catalog (grouped).
    for (const provider of providerCatalog) {
      const matchingModels = provider.models.filter(m => {
        if (!q) return true;
        return m.id.toLowerCase().includes(q) || (m.label || '').toLowerCase().includes(q) || provider.label.toLowerCase().includes(q);
      });
      if (matchingModels.length === 0) continue;
      const ph = document.createElement('div');
      ph.className = 'model-provider-header';
      ph.textContent = provider.label + (provider.baseUrl ? ' · ' + provider.baseUrl : '');
      modelList.appendChild(ph);
      for (const m of matchingModels) {
        const opt = document.createElement('div');
        opt.className = 'model-option' + (m.id === currentModel ? ' active' : '');
        opt.dataset.model = m.id;
        const labelSpan = document.createElement('span');
        labelSpan.textContent = m.label || m.id;
        opt.appendChild(labelSpan);
        if (m.label && m.label !== m.id) {
          const idSpan = document.createElement('span');
          idSpan.className = 'model-option-id';
          idSpan.textContent = m.id;
          opt.appendChild(idSpan);
        }
        opt.addEventListener('click', () => setModelLocal(m.id));
        modelList.appendChild(opt);
        shown += 1;
      }
    }

    // Custom-id row when the search isn't an exact match.
    if (q) {
      const exists = (providerCatalog.some(p => p.models.some(m => m.id.toLowerCase() === q)) ||
                      presets.some(p => p.id.toLowerCase() === q));
      if (!exists) {
        const ph = document.createElement('div');
        ph.className = 'model-provider-header';
        ph.textContent = 'Custom';
        modelList.appendChild(ph);
        const opt = document.createElement('div');
        opt.className = 'model-option';
        const labelSpan = document.createElement('span');
        labelSpan.textContent = 'Use "' + filter.trim() + '" as custom model id';
        opt.appendChild(labelSpan);
        opt.addEventListener('click', () => setModelLocal(filter.trim()));
        modelList.appendChild(opt);
        shown += 1;
      }
    }

    if (shown === 0) {
      const empty = document.createElement('div');
      empty.className = 'model-option no-results';
      empty.textContent = 'No matching models. Press Enter to use as custom id.';
      modelList.appendChild(empty);
    }
  }

  modelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = modelPopover.hidden;
    modelPopover.hidden = !willOpen;
    if (willOpen) {
      modelSearch.value = '';
      renderCatalog('');
      setTimeout(() => modelSearch.focus(), 0);
    }
  });
  document.addEventListener('click', (e) => {
    if (!modelPopover.hidden && !modelPopover.contains(e.target) && e.target !== modelBtn && !modelBtn.contains(e.target)) {
      modelPopover.hidden = true;
    }
  });
  modelSearch.addEventListener('input', () => renderCatalog(modelSearch.value));
  modelSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      modelPopover.hidden = true;
    } else if (e.key === 'Enter') {
      const v = modelSearch.value.trim();
      if (v) setModelLocal(v);
    }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'tab_state') {
      currentBindToken = msg.bindToken || 0;
      panelMode = !!msg.panelMode;
      if (panelMode && tabNewBtn) tabNewBtn.style.display = 'none';
      if (panelMode) tabStripEl.classList.add('hidden');
      else tabStripEl.classList.remove('hidden');
      const tabs = Array.isArray(msg.tabs) ? msg.tabs : [];
      renderTabs(tabs);
    } else if (msg.type === 'model_state') {
      currentChatId = msg.chatId || null;
      currentModel = msg.model || 'inherit';
      currentStreaming = !!msg.streaming;
      currentDirty = !!msg.dirty;
      updateModelUI();
    } else if (msg.type === 'model_changed') {
      currentModel = msg.model || 'inherit';
      currentDirty = !!msg.dirty;
      updateModelUI();
    } else if (msg.type === 'provider_catalog') {
      providerCatalog = Array.isArray(msg.providers) ? msg.providers : [];
    }
  });

  // Notify ready
  vscode.postMessage({ type: 'webview_ready' });
})();
</script>
</body>
</html>`;
}

module.exports = { renderChatHtml };
