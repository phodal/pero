// Unit coverage of the pointer target; hosted E2E verifies the actual menu/action.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openSettings } from './sidebar-controls.mjs';

for (const [layout, bounds] of [
  ['footer below Settings', { x: 8, y: 976, width: 244, height: 32 }],
  ['collapsed sidebar', { x: 8, y: 590, width: 36, height: 32 }],
  ['resized window', { x: 8, y: 450, width: 244, height: 32 }],
]) {
  test(`Settings uses painted bounds: ${layout}`, async () => {
    const clicks = [];
    let menuOpen = false;
    const page = {
      waitForFunction: async () => {},
      evaluate: async callback => callback.toString().includes('peroDiagnostics.snapshot')
        ? { settingsButtonBounds: bounds, settingsMenuOpen: menuOpen }
        : undefined,
      mouse: { click: async (x, y) => { clicks.push([x, y]); menuOpen = true; } },
    };
    await openSettings(page);
    assert.deepEqual(clicks, [[bounds.x + bounds.width / 2, bounds.y + bounds.height / 2]]);
    assert.equal(menuOpen, true);
  });
}
