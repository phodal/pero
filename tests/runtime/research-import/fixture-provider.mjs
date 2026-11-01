// Scripted provider seam. These are protocol/tool trajectories, never LLM evidence.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as pause } from 'node:timers/promises';
import { skillName, seed } from './host-harness.mjs';

const mcp = name => `mcp__pero-app-use__${name}`;
const tool = (name, args, text) => ({ name, args, text });
function* invoke(name, args, pointer = '', text) {
  const raw = yield tool(name, args, text);
  let value = JSON.parse(raw);
  if (value.type === 'content_reference') {
    const parts = [];
    let request = { id: value.artifact.id, pointer, maxBytes: 16384 };
    while (request) {
      const chunk = yield tool(mcp('content_read'), request);
      const match = /^Content ([a-f0-9]{64}), bytes (\d+)\.\.(\d+) of (\d+)\.\n([\s\S]*)\n(End of selection\.|Next read: (.*))$/.exec(chunk);
      assert(match, 'Expected actual content_read envelope');
      parts.push(match[5]); request = match[7] ? JSON.parse(match[7]) : undefined;
    }
    value = JSON.parse(parts.join(''));
  } else if (pointer) value = pointer.split('/').slice(1).reduce((node, key) => node[key], value);
  return value;
}
const write = function* (name, document, text) { return yield* invoke(mcp('app_write'), { app: 'paper-agent', tool: name, document }, '/result', text); };

function* plan(scene, digest) {
  const catalog = yield* invoke('skill', {});
  const selected = catalog.find(item => item.name === skillName);
  assert.equal(selected?.digest, digest);
  if (scene === 'digest') {
    const error = yield tool('skill', { name: skillName, digest: 'sha256:' + '0'.repeat(64) });
    assert.match(error, /digest must match/);
  }
  const skill = yield* invoke('skill', { name: skillName, digest });
  assert(skill.content.includes('confirmedDownloads'));
  const definitions = yield* invoke(mcp('app_describe'), {}, '/apps');
  assert(definitions.some(item => item.tool === 'inspect-research-link'));
  if (scene === 'unsafe') {
    const error = yield tool(mcp('app_write'), { app: 'paper-agent', tool: 'inspect-research-link', document: { url: 'https://localhost/' } });
    assert.match(error, /Private research URLs are not supported/);
    return 'Synthetic protocol probe: unsafe source refused; no import or download.';
  }
  let draft = yield* write('inspect-research-link', { url: seed });
  while (draft.status === 'inspecting') draft = yield* write('inspect-research-link', { draftId: draft.id });
  assert.equal(draft.status, 'ready');
  assert.deepEqual(draft.resources.map(item => item.kind).sort(), ['benchmark', 'code', 'model', 'paper', 'web_article']);
  const selection = { draftId: draft.id, resourceIds: draft.resources.map(item => item.id), downloadIds: [] };
  const review = 'Synthetic review: ' + JSON.stringify(draft.resources.map(({ kind, title, url, revision, license, size, unresolved }) =>
    ({ kind, title, url, revision, license, size, unresolved }))) + '. Saving references only; no download authorized.';
  const refs = yield* write('commit-research-bundle', selection, review);
  assert.deepEqual(refs.downloadIds, []);
  if (scene !== 'download') return 'Synthetic review verified article/paper/code/model/benchmark references, unresolved metadata, license and size. Saved references only; zero downloads.';
  const offered = draft.resources.flatMap(item => item.assets || []).find(item => item.filename === 'weights.bin');
  assert(offered, 'Fixture must offer the exact consented tiny file');
  yield { answer: `Synthetic review: approve only ${offered.filename}, ${offered.size} bytes, license ${offered.license}, revision ${offered.revision}? No download has started.` };
  const approved = yield* write('commit-research-bundle', { ...selection, downloadIds: [offered.id], confirmedDownloads: true });
  let status = yield* write('research-assets', { operation: 'start', bundleId: approved.id, assetId: offered.id });
  while (!['completed', 'failed', 'cancelled'].includes(status.download?.status))
    status = yield* write('research-assets', { operation: 'status', bundleId: approved.id, assetId: offered.id });
  assert.equal(status.download.status, 'completed');
  assert.equal(status.asset.sha256, offered.sha256); assert.equal(status.asset.size, offered.size);
  return 'Synthetic protocol probe: explicit tiny-file approval produced a verified Data receipt. No clone or execution.';
}

export async function startFixtureProvider(scene, digest) {
  let iterator = plan(scene, digest), finished = false;
  const calls = [], errors = [];
  let requests = 0;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, 'Bearer local-research-fixture');
      assert.equal(request.url, '/v1/chat/completions');
      let body = ''; for await (const part of request) body += part;
      const value = JSON.parse(body); requests++;
      // Audit must work without a synthetic assistant-imposed output/request cap.
      assert.equal(value.max_tokens, undefined);
      const last = value.messages.filter(message => message.role === 'tool').at(-1)?.content;
      if (finished) { iterator = plan(scene, digest); finished = false; }
      const step = iterator.next(last);
      let delta, reason;
      if (step.done || step.value.answer) { finished = step.done; delta = { content: step.done ? step.value : step.value.answer }; reason = 'stop'; }
      else {
        const call = step.value;
        assert(value.tools.some(item => item.function.name === call.name), `Tool not advertised: ${call.name}`);
        calls.push({ name: call.name, arguments: call.args });
        if (call.args.document?.draftId || call.args.document?.operation === 'status') await pause(50);
        delta = { ...(call.text ? { content: call.text } : {}), tool_calls: [{ index: 0, id: `fixture-${requests}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] };
        reason = 'tool_calls';
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`);
    } catch (error) { errors.push(error.message); response.writeHead(500).end('Synthetic fixture assertion failed'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { endpoint: `http://127.0.0.1:${server.address().port}/v1`, calls, errors,
    requests: () => requests,
    async close() { server.closeAllConnections(); await new Promise(done => server.close(done)); } };
}
