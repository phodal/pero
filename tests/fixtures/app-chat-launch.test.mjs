import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { requestAppChat } from './app-chat-launch.mjs';

function frame() {
  const listeners = new Set(), timers = new Map(), sent = [];
  let now = 0, nextTimer = 0;
  const parent = { postMessage: (data, origin) => sent.push({ data, origin }) };
  const window = {
    parent,
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  };
  const launch = runInNewContext(`(${requestAppChat.toString()})(null, {text:'app-use:full',parentOrigin:'pero://workbench'})`, {
    window, crypto: { randomUUID: () => 'launch-1' },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  return {
    launch, sent, listeners, timers,
    reply: (change = {}) => {
      const event = { source: parent, origin: 'pero://workbench', data: { type: 'pero:app:chat-result', id: 'launch-1', ok: true, value: { threadId: 'original', references: [] } }, ...change };
      for (const listener of listeners) listener(event);
    },
    advance: time => {
      now = time;
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    },
  };
}

test('launch waits for its acknowledgement beyond the old composer window without resending', async () => {
  const f = frame();
  let settled = false;
  f.launch.then(() => { settled = true; });
  f.advance(6000);
  await Promise.resolve();
  assert.equal(settled, false);
  f.reply();
  assert.equal((await f.launch).threadId, 'original');
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].data.text, 'app-use:full');
  assert.equal(f.sent[0].origin, 'pero://workbench');
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
});

for (const change of [
  { source: {} }, { origin: 'pero://other' },
  { data: { type: 'pero:app:chat-result', id: 'other', ok: true } },
  { data: { type: 'other', id: 'launch-1', ok: true } },
]) test(`unrelated acknowledgement cannot complete launch: ${JSON.stringify(change)}`, async () => {
  const f = frame();
  f.reply(change);
  assert.equal(f.listeners.size, 1);
  assert.equal(f.timers.size, 1);
  f.reply();
  assert.equal((await f.launch).threadId, 'original');
  assert.equal(f.sent.length, 1);
});

test('negative acknowledgement fails immediately and cleans up without retry', async () => {
  const f = frame();
  f.reply({ data: { type: 'pero:app:chat-result', id: 'launch-1', ok: false, error: 'APP_DRAFT_CHANGED' } });
  await assert.rejects(f.launch, /APP_DRAFT_CHANGED/);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.sent.length, 1);
});

test('the existing SDK deadline rejects missing acknowledgement and removes the listener', async () => {
  const f = frame();
  f.advance(124999);
  assert.equal(f.listeners.size, 1);
  f.advance(125000);
  await assert.rejects(f.launch, /App chat request timed out/);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
  f.reply();
  assert.equal(f.sent.length, 1);
});
