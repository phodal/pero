// Unit coverage of the pointer target; hosted E2E verifies the actual menu/action.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { openSettings, setAppearance } from './sidebar-controls.mjs';

test('Settings waits for bootstrap removal and a hit-testable painted canvas before one click', async () => {
  const bounds = { x: 8, y: 590, width: 244, height: 32 }, clicks = [], diagnostics = [];
  let menuOpen = false, ready = false;
  const page = {
    waitForFunction: async predicate => {
      for (const phase of ['loading', 'wrong-size', 'covered', 'ready']) {
        const canvas = { width: phase === 'wrong-size' ? 1 : 1000, height: 800 };
        const observed = runInNewContext(`(${predicate})()`, { innerWidth:1000, innerHeight:800, devicePixelRatio:1,
          window:{peroDiagnostics:{snapshot:()=>JSON.stringify({settingsButtonBounds:bounds})}},
          document:{ querySelector:()=>canvas, getElementById:()=>phase === 'loading' ? {} : null,
            elementFromPoint:()=>phase === 'covered' ? {} : canvas } });
        assert.equal(observed, phase === 'ready', phase);
      }
      ready = true;
    },
    evaluate: async callback => callback.toString().includes('loading:')
      ? { loading:false, snapshot:{settingsButtonBounds:bounds} }
      : callback.toString().includes('peroDiagnostics.snapshot')
        ? { settingsButtonBounds:bounds, settingsMenuOpen:menuOpen } : undefined,
    mouse:{click:async (x,y)=>{ assert.equal(ready,true); clicks.push([x,y]); menuOpen=true; }},
  };
  await openSettings(page, value=>diagnostics.push(value));
  assert.deepEqual(clicks, [[130,606]]);
  assert.deepEqual(diagnostics, [{loading:false,snapshot:{settingsButtonBounds:bounds}}]);
});

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

for (const mismatch of ['global', 'appearance']) {
  test(`Appearance waits for resolved ${mismatch} state, not only saved preference`, async () => {
    let submitted = false, observations = 0;
    const page = {
      waitForFunction: async () => {},
      evaluate: async callback => {
        if (!callback.toString().includes('peroDiagnostics.snapshot')) return;
        const stale = submitted && ++observations === 1;
        return { settingsButtonBounds: { x: 8, y: 10, width: 100, height: 32 }, settingsMenuOpen: true,
          preferences: { appearance: 'dark' }, dark: !(stale && mismatch === 'global'),
          appearance: { dark: !(stale && mismatch === 'appearance') } };
      },
      mouse: { click: async () => {} },
      keyboard: { press: async key => { if (key === 'Enter') submitted = true; } },
    };
    const applied = await setAppearance(page, 'dark');
    assert.equal(observations, 2);
    assert.equal(applied.dark, true);
    assert.equal(applied.appearance.dark, true);
  });
}
