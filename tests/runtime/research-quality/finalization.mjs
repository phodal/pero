// Host turn completion precedes the asynchronous Paper observation and artifact handoff.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

export async function waitForResearchFinalization({ readProgram, readExport, events, programId,
  sessionId, signal, minimumModelRequests = 0, pause = signal => delay(100, undefined, { signal }) }) {
  for (;;) {
    signal.throwIfAborted();
    const current = await readProgram(signal);
    assert.equal(current.id, programId, 'Finalization returned another research program');
    if (terminal.has(current.runtime?.status) && current.runtime.modelRequestsUsed >= minimumModelRequests) {
      for (const field of ['modelRequestsUsed', 'appCallsUsed']) {
        assert(Number.isSafeInteger(current.runtime[field]) && current.runtime[field] >= 0,
          `Final research accounting is missing ${field}`);
      }
      const manifest = await readExport(current.checkpoint, signal);
      assert.equal(manifest.programId, programId, 'Export returned another research program');
      assert.equal(manifest.checkpoint, current.checkpoint, 'Export changed the final checkpoint');
      assert(manifest.documents.length > 0, 'Final research export is empty');
      const delivered = new Map();
      for (const event of events()) {
        if (event.kind !== 'artifact_registered' || event.thread_id !== sessionId
          || event.data?.artifact?.thread_id !== sessionId) continue;
        for (const version of event.data.artifact.versions) {
          const source = version.source;
          if (source.kind !== 'research') continue;
          const provenance = source.provenance;
          if (provenance.program_id === programId && provenance.checkpoint_id === current.checkpoint
            && provenance.export_digest === version.sha256) {
            delivered.set(provenance.slot, { artifactId: event.data.artifact.id,
              version: version.version, sha256: version.sha256, slot: provenance.slot });
          }
        }
      }
      if (manifest.documents.every(document => delivered.get(document.slot)?.sha256 === document.sha256)) {
        return { current, artifacts: manifest.documents.map(document => delivered.get(document.slot)) };
      }
    }
    // Bounded observation of an external worker. This never retries or starts a model turn.
    await pause(signal);
  }
}
