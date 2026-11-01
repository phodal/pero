import assert from 'node:assert/strict';
import test from 'node:test';
import { connectHost } from './host-connection.ts';
import type { HostEvent } from '../../protocol/generated/host';
const event = (kind: 'ready' | 'disconnected'): HostEvent => ({ version: 1, kind, request_id: null, text: '' });

test('Host ready during renderer initialization is recovered from current state', async () => {
  // Renderer had no listener while GPU initialization was in progress.
  let listener: ((value: HostEvent) => void) | undefined;
  const received: string[] = [];
  await connectHost({
    onEvent(callback) { listener = callback; return () => {}; },
    async connect() { return event('ready'); },
  }, value => received.push(value.kind));
  listener!({ version: 1, kind: 'agents', request_id: null, text: '', data: [] });
  listener!(event('disconnected'));
  listener!(event('ready'));
  assert.deepEqual(received, ['ready', 'agents', 'disconnected', 'ready']);
});

for (const [stale, live] of [['disconnected', 'ready'], ['ready', 'disconnected']] as const) {
  test(`live ${live} supersedes pending ${stale} snapshot`, async () => {
    let listener!: (value: HostEvent) => void;
    let resolve!: (value: HostEvent) => void;
    const response = new Promise<HostEvent>(done => { resolve = done; });
    const received: string[] = [];
    const connecting = connectHost({
      onEvent(callback) { listener = callback; return () => {}; },
      connect() { return response; },
    }, value => received.push(value.kind));
    listener({ version: 1, kind: 'agents', request_id: null, text: '', data: [] });
    listener(event(live));
    resolve(event(stale));
    await connecting;
    assert.deepEqual(received, ['agents', live]);
  });
}
