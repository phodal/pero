import assert from 'node:assert/strict';
import test from 'node:test';
import { AppSurface, AppUseError } from '../../../packages/app-sdk/src/app-use.ts';
import { labReferenceState } from '../ui-src/reference.ts';

test('Lab approval reference ignores UI churn but rejects a changed experiment or frozen digest', async () => {
  const experiment = { id: 'a'.repeat(32), spec_hash: 'b'.repeat(64), trials: [] };
  const surface = new AppSurface();
  const object = (value: typeof experiment) => ({ id: 'lab', kind: 'lab-experiment', label: 'Lab',
    state: labReferenceState(value), actions: { inspect: { run: () => null } } });
  const handle = surface.register(object(experiment));
  const frozen = surface.observe('lab').objects[0];
  // As with a React re-render, local busy/error/tab/theme fields never enter the domain projection.
  for (const ui of [{ busy: true, error: '', tab: 'runs', theme: 'dark' },
    { busy: false, error: 'A recoverable UI error', tab: 'deck', theme: 'light' }]) {
    handle.update(object({ ...experiment, ...ui }));
    assert.deepEqual(surface.observe('lab').objects[0], frozen);
    await surface.invoke('lab', 'inspect', {}, frozen.revision);
  }
  for (const change of [{ id: 'c'.repeat(32) }, { spec_hash: 'd'.repeat(64) }]) {
    handle.update(object({ ...experiment, ...change }));
    await assert.rejects(surface.invoke('lab', 'inspect', {}, frozen.revision),
      error => error instanceof AppUseError && error.code === 'APP_REVISION_STALE');
  }
});
