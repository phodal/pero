// Synthetic Paper backend for the real Host/Harness transport test. No provider network.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const config = JSON.parse(await readFile(new URL('./fixture.json', import.meta.url), 'utf8'));
const data = process.env.PERO_APP_DATA;
const statePath = join(data, 'state.json');
let failedTerminal = false;
let state = { checkpoint: config.checkpoints[0], finished: false, threadId: null };
await writeFile(statePath, JSON.stringify(state));
const descriptor = () => ({ context: config.context, protocol: config.protocol,
  checkpoint: state.checkpoint, prompt: config.instructions });
function exported(checkpoint) {
  assert(config.checkpoints.includes(checkpoint), 'unknown fixture checkpoint');
  const documents = [
    ['report', 'research-report.md', `# Fixture research\n\nReview: needs_review\nCheckpoint: ${checkpoint}\n`],
    ['evidence', 'evidence-matrix.json', JSON.stringify({ checkpoint, acceptance: 'needs_review', claims: [] })],
    ['literature', 'literature.md', `# Literature\n\nSynthetic source; no scientific acceptance.\nCheckpoint: ${checkpoint}\n`],
    ['log', 'research-log.jsonl', JSON.stringify({ event: 'fixture-checkpoint', checkpoint }) + '\n'],
  ].map(([slot, filename, content]) => ({ slot, filename, content,
    sha256: createHash('sha256').update(content).digest('hex') }));
  return { programId: config.context.programId, checkpoint, documents, acceptance: 'needs_review' };
}
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/internal/research-program');
    assert.equal(request.headers['x-pero-app-token'], process.env.PERO_APP_TOKEN);
    assert.equal(request.headers['x-pero-research-internal'], '1');
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const value = JSON.parse(raw);
    assert.equal(value.programId, config.context.programId);
    await appendFile(join(data, 'calls.jsonl'), JSON.stringify(value) + '\n');
    const controlPath = join(data, 'block-read');
    if (value.operation === 'read') {
      const blocked = await readFile(controlPath, 'utf8').then(() => true, () => false);
      if (blocked) {
        await writeFile(join(data, 'read-blocked'), 'ready');
        while (await readFile(controlPath, 'utf8').then(() => true, () => false))
          await new Promise(done => setTimeout(done, 20));
      }
    }
    if (config.failTerminalObservation && value.operation === 'observe-run' && value.status === 'completed' && !failedTerminal) {
      failedTerminal = true;
      response.writeHead(503).end('Synthetic first terminal observation failure');
      return;
    }
    let result;
    if (value.operation === 'bind') {
      assert.equal(value.protocolDigest, config.context.protocolDigest);
      assert(!state.threadId || state.threadId === value.threadId, 'program belongs to its original thread');
      state.threadId = value.threadId;
      result = descriptor();
    } else if (value.operation === 'launch') {
      result = descriptor();
    } else {
      assert(state.threadId && state.threadId === value.threadId, 'caller is not the bound thread');
      switch (value.operation) {
        case 'read': result = { id: value.programId, ...state, protocol: config.protocol }; break;
        case 'feedback': result = { programId: value.programId, checkpoint: state.checkpoint,
          continueResearch: !state.finished, nextAction: config.nextAction,
          stopReason: state.finished ? 'no_progress' : null }; break;
        case 'finish':
          assert.equal(value.expectedCheckpoint, state.checkpoint);
          assert(value.operationId.startsWith(state.threadId + ':'), 'Host did not bind the operation identity');
          state.finished = true;
          state.checkpoint = config.checkpoints[1];
          result = { ...state, stopReason: 'no_progress' };
          break;
        case 'observe-run':
          state.executionStatus = value.status;
          state.modelRequestsUsed = value.modelRequestsUsed;
          state.appCallsUsed = value.appCallsUsed;
          result = { ...state };
          break;
        case 'export-manifest':
          result = exported(value.checkpoint || state.checkpoint);
          result.documents = result.documents.map(({ content, ...metadata }) => metadata);
          break;
        case 'export':
          result = exported(value.checkpoint || state.checkpoint);
          result.documents = result.documents.filter(document => document.slot === value.slot);
          assert.equal(result.documents.length, 1);
          break;
        default: throw Error(`unexpected fixture operation: ${value.operation}`);
      }
    }
    await writeFile(statePath, JSON.stringify(state));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result));
  } catch (error) {
    response.writeHead(409, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: String(error) }));
  }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })));
