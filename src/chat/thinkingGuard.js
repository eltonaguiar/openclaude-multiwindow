/**
 * thinkingGuard.js — Guards against infinite thinking states.
 *
 * Features:
 *   - Auto-timeout for thinking state (configurable)
 *   - Force-stop capability that sends SIGKILL then SIGTERM
 *   - Thinking state tracking with elapsed time
 *   - Reset signal that creates a fresh process
 *
 * Usage:
 *   const guard = new ThinkingGuard(processManager, { timeoutMs: 120000 });
 *   guard.startMonitoring();
 *   guard.onThinkingStuck(() => { // notify user });
 */

const vscode = require('vscode');

class ThinkingGuard {
  /**
   * @param {object} processManager - The ProcessManager instance to guard
   * @param {object} [options]
   * @param {number} [options.timeoutMs=120000] - Max thinking time in ms (default 2 min)
   * @param {number} [options.pollIntervalMs=5000] - How often to check (default 5s)
   */
  constructor(processManager, options = {}) {
    this._pm = processManager;
    this._timeoutMs = options.timeoutMs || 120000;
    this._pollIntervalMs = options.pollIntervalMs || 5000;
    this._thinkingStart = null;
    this._isThinking = false;
    this._timer = null;
    this._onStuckEmitter = new vscode.EventEmitter();
    this._onResetEmitter = new vscode.EventEmitter();
    this.onThinkingStuck = this._onStuckEmitter.event;
    this.onReset = this._onResetEmitter.event;
  }

  get isThinking() { return this._isThinking; }
  get elapsedMs() {
    if (!this._thinkingStart) return 0;
    return Date.now() - this._thinkingStart;
  }

  /** Call when thinking starts. */
  startThinking() {
    this._isThinking = true;
    this._thinkingStart = Date.now();
    this._startTimer();
  }

  /** Call when thinking ends. */
  endThinking() {
    this._isThinking = false;
    this._thinkingStart = null;
    this._clearTimer();
  }

  /** Force-stop the current process. */
  forceStop() {
    this._clearTimer();
    this._isThinking = false;
    this._thinkingStart = null;
    if (this._pm && typeof this._pm.kill === 'function') {
      try { this._pm.kill(); } catch {}
    }
  }

  /**
   * Hard reset — kills process and signals that a new one should be created.
   * The caller should listen for onReset to create a new ProcessManager.
   */
  hardReset() {
    this._clearTimer();
    this._isThinking = false;
    this._thinkingStart = null;
    if (this._pm && typeof this._pm.dispose === 'function') {
      try { this._pm.dispose(); } catch {}
    }
    this._onResetEmitter.fire();
  }

  _startTimer() {
    this._clearTimer();
    this._timer = setInterval(() => {
      if (this._isThinking && this.elapsedMs >= this._timeoutMs) {
        this._onStuckEmitter.fire({
          elapsedMs: this.elapsedMs,
          timeoutMs: this._timeoutMs,
        });
        this._clearTimer();
      }
    }, this._pollIntervalMs);
  }

  _clearTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  dispose() {
    this._clearTimer();
    this._isThinking = false;
    this._thinkingStart = null;
    this._onStuckEmitter.dispose();
    this._onResetEmitter.dispose();
  }
}

module.exports = { ThinkingGuard };
