import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAppCanvasBinding, appCanvasPath } from '../src/app-canvas.ts';
test('App bindings retain identity and admit only Host panel navigation', () => {
  const binding = { id: 'binding-1', app: 'control-lab', panel: 'main' };
  assert.deepEqual(parseAppCanvasBinding(binding), binding);
  assert.equal(appCanvasPath(binding), '/apps/control-lab/main');
  assert.equal(parseAppCanvasBinding(null), null);
  for (const bad of [{ ...binding, app: 'javascript:alert(1)' }, { ...binding, panel: '../main' }, { ...binding, action: 'execute' }, { ...binding, id: '' }]) assert.throws(() => parseAppCanvasBinding(bad));
});
