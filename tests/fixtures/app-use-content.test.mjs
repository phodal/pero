import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { ContentArtifacts } from '../../desktop/src/main/content-artifacts.ts';
import { ContentRead } from '../../packages/content-source/index.ts';
import { appUseContent } from './app-use-content.mjs';

test('App Use fixture resolves exact bounded content through the scoped reader', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pero-app-use-content-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new ContentArtifacts(directory);
  const thread = 'fixture-thread';
  const value = { dom: [{ label: 'Find gene', value: '输入🧬'.repeat(4000) }], revisions: { snapshot: 8 } };
  const text = await store.select(thread, value);
  assert.equal(JSON.parse(text).type, 'content_reference');
  let calls = 0;
  const signal = new AbortController().signal;
  const rpc = async (method, params, receivedSignal) => {
    calls++;
    assert.equal(method, 'tools/call');
    assert.equal(params.name, 'content_read');
    assert.equal(receivedSignal, signal);
    const part = await store.read(thread, ContentRead.parse(params.arguments));
    const next = part.nextRead ? `Next read: ${JSON.stringify(part.nextRead)}` : 'End of selection.';
    return { isError: false, content: [{ type: 'text', text: `Content ${part.artifact.id}, bytes ${part.startByte}..${part.endByte} of ${part.artifact.bytes}.\n${part.text}\n${next}` }] };
  };
  assert.deepEqual(await appUseContent(text, rpc, signal), value);
  assert.ok(calls > 1 && calls <= 8);
  assert.deepEqual(await appUseContent('{"dom":[]}', () => assert.fail('inline must not read')), { dom: [] });
  for (const [name, mutate] of [
    ['missing reference', ref => { delete ref.read; }],
    ['oversized reference', ref => { ref.artifact.bytes = 128 * 1024 + 1; }],
    ['foreign initial reference', ref => { ref.read.arguments.id = '0'.repeat(64); }],
  ]) await t.test(name, async () => {
    const reference = JSON.parse(text); mutate(reference);
    await assert.rejects(appUseContent(JSON.stringify(reference), () => assert.fail('invalid reference must not read')));
  });
  for (const [name, mutate] of [
    ['MCP error', result => ({ ...result, isError: true })],
    ['malformed envelope', result => ({ ...result, content: [{ type: 'text', text: 'preview only' }] })],
    ['premature end', result => ({ ...result, content: [{ type: 'text', text: result.content[0].text.replace(/Next read: .*$/, 'End of selection.') }] })],
    ['foreign continuation', result => ({ ...result, content: [{ type: 'text', text: result.content[0].text.replace(/(Next read: .*\"id\":\")[a-f0-9]{64}/, '$1' + '0'.repeat(64)) }] })],
    ['nonprogressing continuation', result => ({ ...result, content: [{ type: 'text', text: result.content[0].text.replace(/"startByte":\d+/, '"startByte":0') }] })],
    ['changed content', result => ({ ...result, content: [{ type: 'text', text: result.content[0].text.replace('Find gene', 'Fake gene') }] })],
  ]) await t.test(name, async () => {
    await assert.rejects(appUseContent(text, async (...args) => mutate(await rpc(...args)), signal));
  });
  const foreign = async (method, params) => store.read('another-thread', ContentRead.parse(params.arguments));
  await assert.rejects(appUseContent(text, foreign, signal), /ENOENT/);
});
