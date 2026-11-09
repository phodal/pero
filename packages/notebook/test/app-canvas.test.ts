import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAppCanvasBinding, appCanvasPath, appCanvasAvailability } from '../src/app-canvas.ts';
test('App bindings retain identity and admit only Host panel navigation', () => {
  const binding = { id: 'binding-1', app: 'control-lab', panel: 'main' };
  assert.deepEqual(parseAppCanvasBinding(binding), binding);
  assert.equal(appCanvasPath(binding), '/apps/control-lab/main');
  assert.equal(parseAppCanvasBinding(null), null);
  for (const bad of [{ ...binding, app: 'javascript:alert(1)' }, { ...binding, panel: '../main' }, { ...binding, action: 'execute' }, { ...binding, id: '' }]) assert.throws(() => parseAppCanvasBinding(bad));
});
test('saved bindings survive unavailable Apps; only Host declarations establish current availability', () => {
  const binding = Object.freeze({ id: 'binding-1', app: 'control-lab', panel: 'main' });
  const app = { app: 'control-lab', enabled: true, panels: [{ id: 'main' }] };
  for (const [catalog, expected] of [
    [null, 'unknown'], [[], 'missing-app'], [[{ ...app, enabled: false }], 'disabled-app'],
    [[{ ...app, panels: [{ id: 'other' }] }], 'missing-panel'], [[app], 'available'],
  ] as const) {
    assert.equal(appCanvasAvailability(binding, catalog), expected);
    assert.deepEqual(binding, { id: 'binding-1', app: 'control-lab', panel: 'main' });
  }
  assert.equal(appCanvasAvailability(null, [app]), 'unbound');
});
test('embedded bindings preserve exact inputs and unverified retained bytes across serialization', () => {
  const binding = { id: 'binding', app: 'data', panel: 'main', view: 'dataset-inspector', declaration: 'a'.repeat(64), inputs: { datasetId: 'ds-' + 'b'.repeat(32) }, receipt: { imported: 'not authenticated evidence' } };
  assert.deepEqual(parseAppCanvasBinding(JSON.parse(JSON.stringify(binding))), binding);
  for (const bad of [{ ...binding, declaration: 'old' }, { ...binding, inputs: [] }, { ...binding, view: '../private' }, { ...binding, receipt: 'done' }, { id: 'binding', app: 'data', panel: 'main', receipt: {} }]) assert.throws(() => parseAppCanvasBinding(bad));
});

test('embedded availability uses actual current declaration rather than panel availability', () => {
  const binding = { id: 'binding', app: 'data', panel: 'main', view: 'dataset-inspector', declaration: 'a'.repeat(64), inputs: {} };
  const app = { app: 'data', enabled: true, revision: binding.declaration, panels: [{ id: 'main' }], canvases: [{ id: 'dataset-inspector' }] };
  assert.equal(appCanvasAvailability(binding, [app]), 'available');
  assert.equal(appCanvasAvailability(binding, [{ ...app, canvases: [] }]), 'missing-view');
  assert.equal(appCanvasAvailability(binding, [{ ...app, revision: 'b'.repeat(64) }]), 'changed-declaration');
});
