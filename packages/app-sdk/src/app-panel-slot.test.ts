import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appPanelSlot } from './app-panel-slot.ts';

test('embedded panel regions admit installed identities and bounded visible rectangles', () => {
  const base = { id: 'canvas-one', app: 'skills', panel: 'main', rect: { x: 10, y: 20, width: 600, height: 320 } };
  for (const change of [{}, { rect: null }, { rect: null, release: true }]) assert.doesNotThrow(() => appPanelSlot({ ...base, ...change }));
  for (const change of [
    { app: 'notebook' }, { app: 'https://example.invalid' }, { panel: '../main' }, { id: '' },
    { rect: { ...base.rect, width: 0 } }, { rect: { ...base.rect, height: 179 } },
    { rect: { ...base.rect, x: -1 } }, { rect: { ...base.rect, y: Infinity } }, { release: 'true' },
  ]) assert.throws(() => appPanelSlot({ ...base, ...change }), /Invalid embedded App panel region/);
});
