import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopAppUse } from './app-use-mcp.ts';
import { HostArtifactDelivery, type ArtifactDeliveryInput } from './artifact-delivery.ts';

test('file delivery uses its actual MCP caller without requiring an App or selected Chat', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pero-deliver-artifact-'));
  const delivered: { thread: string; input: ArtifactDeliveryInput }[] = [];
  const service = new DesktopAppUse({
    selectedThread: async () => 'another-selected-conversation',
    page: async () => { throw Error('File delivery must not operate an App'); },
    capture: async () => { throw Error('File delivery must not capture a panel'); },
    presence() {},
  }, () => {}, root, undefined, undefined, async (thread, input, signal) => {
    signal.throwIfAborted();
    delivered.push({ thread, input });
    return { artifact: { id: input.artifact_id || 'saved-item', thread_id: thread, title: input.title || input.path } };
  });
  try {
    for (const thread of ['actual-caller', 'background-caller']) {
      service.accept({ kind: 'session_created', thread_id: thread, data: {} });
      service.accept({ kind: 'turn_started', thread_id: thread });
    }
    const endpoint = await service.start();
    let id = 0;
    const request = async (method: string, params?: unknown, thread = 'actual-caller') => {
      const response = await fetch(endpoint.PERO_APP_USE_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${endpoint.PERO_APP_USE_TOKEN}`,
          'content-type': 'application/json',
          'x-pero-thread': thread,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      });
      return (await response.json()).result;
    };
    const tools = (await request('tools/list')).tools;
    assert.ok(tools.some((tool: { name: string }) => tool.name === 'deliver_artifact'));
    const instructions = (await request('initialize')).instructions;
    assert.ok(instructions.includes('freezes the file bytes'));
    const call = (args: unknown, thread?: string) => request('tools/call', { name: 'deliver_artifact', arguments: args }, thread);

    for (const row of [
      { thread: 'actual-caller', input: { path: 'results/report.md', title: 'Report' } },
      { thread: 'background-caller', input: { path: 'results/report-v2.md', artifact_id: 'saved-item', presentation: 'side',
        related: [{ artifact_id: 'code', version: 1, role: 'code' }] } },
    ]) {
      const result = await call(row.input, row.thread);
      assert.equal(result.isError, false);
      assert.equal(JSON.parse(result.content[0].text).artifact.thread_id, row.thread);
      assert.deepEqual(delivered.at(-1), row);
    }

    for (const input of [
      { path: 'result.txt', thread_id: 'another-conversation' },
      { path: 'result.txt', thread: 'another-conversation' },
      { path: 'result.txt', title: 1 },
      { path: 'result.txt', artifact_id: 1 },
      { path: 'result.txt', presentation: 'tab' },
      { path: 'result.txt', related: [{ artifact_id: 'code', version: 0, role: 'code' }] },
      { path: 'result.txt', related: [{ artifact_id: 'code', version: 1, role: 'passed' }] },
      { path: '' },
      [],
    ]) {
      const result = await call(input);
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /ARTIFACT_DELIVERY_INVALID/);
    }
    assert.equal(delivered.length, 2, 'Invalid arguments must not reach the Host port');
    service.command({ action: 'cancel', thread_id: 'actual-caller' });
    service.accept({ kind: 'turn_finished', thread_id: 'background-caller' });
    for (const thread of ['actual-caller', 'background-caller', 'unknown-caller']) {
      const result = await call({ path: 'result.txt' }, thread);
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /APP_SESSION_INACTIVE/);
    }
    assert.equal(delivered.length, 2, 'Cancelled and finished callers must not dispatch');
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('an unwired shell does not advertise or accept file delivery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pero-delivery-unavailable-'));
  const service = new DesktopAppUse({
    selectedThread: async () => undefined,
    page: async () => ({}),
    capture: async () => { throw Error('No capture'); },
    presence() {},
  }, () => {}, root);
  try {
    const endpoint = await service.start();
    const call = async (method: string, params?: unknown) => (await (await fetch(endpoint.PERO_APP_USE_URL, {
      method: 'POST', headers: { authorization: `Bearer ${endpoint.PERO_APP_USE_TOKEN}`, 'x-pero-thread': 'caller' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })).json()).result;
    assert.ok(!(await call('tools/list')).tools.some((tool: { name: string }) => tool.name === 'deliver_artifact'));
    assert.equal((await call('tools/call', { name: 'deliver_artifact', arguments: { path: 'result.txt' } })).isError, true);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Host delivery returns only its correlated receipt and cleans up stopped requests', async () => {
  for (const outcome of ['registered', 'error', 'aborted', 'closed'] as const) {
    let command: { request_id: string; thread_id: string; [key: string]: unknown } | undefined;
    const transport = new HostArtifactDelivery(value => { command = value; });
    const controller = new AbortController();
    const pending = transport.deliver('actual-thread', { path: 'report.md', artifact_id: 'item' }, controller.signal);
    assert.ok(command);
    assert.equal(command.thread_id, 'actual-thread');
    assert.equal(command.action, 'register_file');
    const receipt = { artifact: { id: 'item', thread_id: 'actual-thread' } };
    const event = { kind: 'artifact_registered', request_id: command.request_id, thread_id: 'actual-thread', data: receipt };
    // Events for another request or conversation cannot resolve this delivery.
    transport.accept({ ...event, request_id: 'unrelated-request', data: { wrong: 'request' } });
    transport.accept({ ...event, thread_id: 'another-thread', data: { wrong: 'thread' } });
    if (outcome === 'registered') {
      transport.accept(event);
      assert.deepEqual(await pending, receipt);
    } else {
      const rejected = assert.rejects(pending, /missing|cancelled|closed/);
      if (outcome === 'error') transport.accept({ ...event, kind: 'artifact_error', text: 'File missing' });
      if (outcome === 'aborted') controller.abort(new Error('Delivery cancelled'));
      if (outcome === 'closed') transport.close();
      await rejected;
      transport.accept(event); // A late receipt cannot revive an ended request.
    }
    transport.close();
  }
});

test('Host snapshot descriptors stay private and resolve only the requested version', async () => {
  let command: { request_id: string; thread_id: string; [key: string]: unknown } | undefined;
  const transport = new HostArtifactDelivery(value => { command = value; });
  const signal = new AbortController().signal;
  try {
    const pending = transport.resolveSnapshot('chat', 'item', 2, signal);
    assert.ok(command);
    assert.equal(command.action, 'resolve_snapshot');
    assert.equal(command.version, 2);
    const snapshot = { thread_id: 'chat', artifact_id: 'item', version: 2, filename: 'plot.png',
      media: { kind: 'image', mime_type: 'image/png' }, sha256: 'a'.repeat(64), bytes: 3, path: '/private/host/snapshot' };
    const event = { kind: 'artifact_snapshot_result', request_id: command.request_id, thread_id: 'chat', data: { ok: true, value: snapshot } };
    assert.equal(transport.accept({ ...event, thread_id: 'other-chat' }), true);
    assert.equal(transport.accept({ ...event, request_id: 'stale-request' }), true);
    assert.equal(transport.accept({ ...event, kind: 'artifact_registered' }), false);
    assert.equal(transport.accept(event), true);
    assert.deepEqual(await pending, snapshot);
    assert.equal(transport.accept(event), true, 'Late private descriptors are still consumed');
    const failed = transport.resolveSnapshot('chat', 'item', 3, signal);
    const rejected = assert.rejects(failed, /Snapshot missing/);
    transport.accept({ ...event, request_id: command.request_id, data: { ok: false, error: 'Snapshot missing' } });
    await rejected;
  } finally { transport.close(); }
});
