import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForResearchFinalization } from './finalization.mjs';

function fixture() {
  const control = new AbortController(), ledger = [];
  let checkpoint = 'running-checkpoint', status = 'running', attempts = 0, reads = 0;
  let resume, paused = Promise.withResolvers();
  const documents = ['report', 'evidence', 'literature', 'log', 'evidence-2']
    .map(slot => ({ slot, sha256: `digest-${slot}` }));
  return {
    documents, control, ledger,
    complete(value = 'completed', count = 17) { status = value; checkpoint = 'terminal-checkpoint-' + count; attempts = count; },
    paused() { return paused.promise; },
    resume() { const next = resume; paused = Promise.withResolvers(); next(); },
    get reads() { return reads; },
    event(document, { thread = 'run', program = 'program', point = checkpoint, digest = document.sha256 } = {}) {
      return { kind: 'artifact_registered', thread_id: thread, data: { artifact: {
        id: `artifact-${document.slot}`, thread_id: thread, versions: [{ version: 2, sha256: digest,
          source: { kind: 'research', provenance: { program_id: program, checkpoint_id: point,
            slot: document.slot, export_digest: digest } } }],
      } } };
    },
    options: {
      programId: 'program', sessionId: 'run', signal: control.signal, events: () => ledger,
      readProgram: async () => { reads++; return { id: 'program', checkpoint,
        runtime: { status, modelRequestsUsed: attempts, appCallsUsed: attempts + 3 } }; },
      readExport: async point => ({ programId: 'program', checkpoint: point, documents }),
      pause: signal => new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        resume = () => { signal.removeEventListener('abort', abort); resolve(); };
        paused.resolve();
      }),
    },
  };
}

test('waits for delayed terminal accounting and every same-checkpoint artifact, not raw event count', async () => {
  const f = fixture();
  // A resumed turn must not settle against the previous cancellation receipt.
  f.complete('cancelled', 11);
  f.options.minimumModelRequests = 17;
  f.ledger.push(...f.documents.map(document => f.event(document)));
  let settled = false;
  const pending = waitForResearchFinalization(f.options).then(value => { settled = true; return value; });
  await f.paused(); assert.equal(settled, false); assert.equal(f.reads, 1);
  f.complete(); f.resume(); await f.paused();
  assert.equal(settled, false, 'old checkpoint artifacts must not settle terminal accounting');
  f.ledger.push(...f.documents.map(document => f.event(document, { thread: 'other-run' })),
    ...f.documents.map(document => f.event(document, { program: 'other-program' })),
    ...f.documents.map(document => f.event(document, { digest: 'wrong-digest' })));
  f.resume(); await f.paused(); assert.equal(settled, false);
  f.ledger.push(...f.documents.slice(0, -1).map(document => f.event(document)));
  f.resume(); await f.paused(); assert.equal(settled, false, 'split export part remains pending');
  f.ledger.push(f.event(f.documents.at(-1))); f.resume();
  const result = await pending;
  assert.equal(result.current.checkpoint, 'terminal-checkpoint-17');
  assert.equal(result.current.runtime.modelRequestsUsed, 17);
  assert.equal(result.artifacts.length, 5);
});

test('failed and cancelled runs settle evidence without turning their status into success', async () => {
  for (const status of ['failed', 'cancelled', 'interrupted']) {
    const f = fixture(); f.complete(status);
    f.ledger.push(...f.documents.map(document => f.event(document)));
    const result = await waitForResearchFinalization(f.options);
    assert.equal(result.current.runtime.status, status);
  }
});

test('deadline aborts pending observation/delivery instead of freezing running state as a result', async () => {
  for (const terminal of [false, true]) {
    const f = fixture(); if (terminal) f.complete();
    const pending = waitForResearchFinalization(f.options);
    await f.paused();
    f.control.abort(new Error('Final research handoff deadline'));
    await assert.rejects(pending, /handoff deadline/);
  }
});
