#!/usr/bin/env node
/**
 * mock-openclaude — minimal stand-in for the openclaude CLI used during
 * extension development without an ANTHROPIC_API_KEY.
 *
 * Speaks the same NDJSON-on-stdout / NDJSON-on-stdin protocol as the real
 * CLI, just enough to exercise the multi-chat extension. It echoes the
 * --model flag back in `system` messages so you can verify per-chat model
 * routing in the sidebar.
 *
 * Usage in VSCode:
 *   "openclaude.launchCommand": "node C:\\openclaude-multiwindow\\scripts\\mock-openclaude.cjs"
 */
'use strict';

const readline = require('readline');
const crypto = require('crypto');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const sessionId = arg('--resume', null) || ('mock_' + crypto.randomBytes(4).toString('hex'));
const model = arg('--model', 'mock-model');

function emit(obj) {
  obj.session_id = sessionId;
  process.stdout.write(JSON.stringify(obj) + '\n');
}

emit({ type: 'system', subtype: 'init', model: model });

const rl = readline.createInterface({ input: process.stdin });

let turn = 0;
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg && msg.type === 'user') {
    turn += 1;
    const text = (msg.message && msg.message.content)
      ? (typeof msg.message.content === 'string' ? msg.message.content : JSON.stringify(msg.message.content))
      : '';
    const reply = `[${model}] (turn ${turn}) you said: ${String(text).slice(0, 200)}`;

    // Stream-event sequence: message_start → text deltas → message_stop → result.
    emit({ type: 'stream_event', event: { type: 'message_start' } });
    emit({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } });

    const chunks = reply.match(/.{1,20}/g) || [reply];
    let i = 0;
    const send = () => {
      if (i >= chunks.length) {
        emit({ type: 'stream_event', event: { type: 'content_block_stop' } });
        emit({ type: 'stream_event', event: { type: 'message_stop' } });
        emit({ type: 'assistant', message: { content: [{ type: 'text', text: reply }], usage: { input_tokens: 8, output_tokens: 12 } } });
        emit({ type: 'result', subtype: 'success', usage: { input_tokens: 8, output_tokens: 12 }, num_turns: 1, stop_reason: 'end_turn' });
        return;
      }
      emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: chunks[i] } } });
      i += 1;
      setTimeout(send, 25);
    };
    send();
  }
});

rl.on('close', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
