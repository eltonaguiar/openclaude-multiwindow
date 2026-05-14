/**
 * ChatRegistry unit tests — runs under `node --test`.
 *
 * The registry depends on vscode.EventEmitter via ChatController. We stub
 * the `vscode` module before requiring chatRegistry so the test runs without
 * a real VS Code host.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// Stub the `vscode` module before requiring chatRegistry.
const vscodeStub = {
  EventEmitter: class {
    constructor() { this._listeners = []; this.event = (fn) => { this._listeners.push(fn); return { dispose: () => { this._listeners = this._listeners.filter(l => l !== fn); } }; }; }
    fire(value) { for (const l of this._listeners.slice()) l(value); }
    dispose() { this._listeners = []; }
  },
  workspace: { getConfiguration: () => ({ get: (k, d) => d }), workspaceFolders: [] },
  window: {},
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') return require.resolve('node:path'); // any real module
  return origResolve.call(this, request, ...rest);
};
require.cache[require.resolve('node:path')] = { exports: vscodeStub, loaded: true };

// Stub ProcessManager to avoid spawning anything.
const pmPath = require.resolve('./processManager.js');
require.cache[pmPath] = {
  exports: {
    ProcessManager: class {
      constructor() { this.running = false; }
      start() {}
      sendUserMessage() {}
      sendControlResponse() {}
      write() {}
      abort() {}
      kill() {}
      dispose() {}
      get sessionId() { return null; }
    },
  },
  loaded: true,
};

const { ChatRegistry, MAX_CHATS, shortModelLabel } = require('./chatRegistry.js');

test('ChatRegistry creates and lists chats', () => {
  const r = new ChatRegistry({});
  const id = r.create({ title: 'A', model: 'claude-opus-4-7' });
  assert.equal(r.size, 1);
  const list = r.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal(list[0].title, 'A');
  assert.equal(list[0].model, 'Opus 4.7');
  assert.equal(list[0].isActive, true);
});

test('ChatRegistry switches active chat', () => {
  const r = new ChatRegistry({});
  const a = r.create({ title: 'A' });
  const b = r.create({ title: 'B' });
  assert.equal(r.activeId, a);
  assert.equal(r.setActive(b), true);
  assert.equal(r.activeId, b);
  assert.equal(r.setActive('nope'), false);
});

test('ChatRegistry remove reassigns active', () => {
  const r = new ChatRegistry({});
  const a = r.create({});
  const b = r.create({});
  r.setActive(a);
  r.remove(a);
  assert.equal(r.activeId, b);
  assert.equal(r.size, 1);
});

test('ChatRegistry enforces MAX_CHATS cap', () => {
  const r = new ChatRegistry({});
  for (let i = 0; i < MAX_CHATS; i += 1) r.create({});
  assert.throws(() => r.create({}), /limit reached/);
});

test('ChatRegistry serialize/restore round-trip', () => {
  const r1 = new ChatRegistry({});
  const a = r1.create({ title: 'Alpha', model: 'claude-sonnet-4-6' });
  const b = r1.create({ title: 'Beta', model: 'claude-haiku-4-5' });
  r1.setActive(b);
  // Pretend chat A has a sessionId.
  r1.get(a)._currentSessionId = 'sess_abc';
  const snap = r1.serialize();
  assert.equal(snap.chats.length, 2);
  assert.equal(snap.activeId, b);

  const r2 = new ChatRegistry({});
  r2.restore(snap);
  assert.equal(r2.size, 2);
  assert.equal(r2.activeId, b);
  assert.equal(r2.get(a)._currentSessionId, 'sess_abc');
});

test('shortModelLabel maps known ids', () => {
  assert.equal(shortModelLabel('claude-opus-4-7'), 'Opus 4.7');
  assert.equal(shortModelLabel('inherit'), 'Inherit');
  assert.equal(shortModelLabel('custom-thing'), 'custom-thing');
});

test('emits onDidChange on create/remove/setActive/setModel', () => {
  const r = new ChatRegistry({});
  let fires = 0;
  r.onDidChange(() => { fires += 1; });
  const a = r.create({});
  const b = r.create({});
  r.setActive(b);
  r.setModel(b, 'claude-haiku-4-5');
  r.remove(a);
  assert.ok(fires >= 5);
});
