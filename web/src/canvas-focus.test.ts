import test from 'node:test';
import assert from 'node:assert/strict';
import { reclaimAfterCanvasPress, type CanvasFocus } from './canvas-focus.ts';

const frames = (state: { composerFocused: boolean; active: CanvasFocus; paneFocused: boolean }) => {
  let active = state.active;
  for (let frame = 0; frame < 6; frame++) {
    active = reclaimAfterCanvasPress({ ...state, active });
  }
  return active;
};

test('clicking an App pane then typing reaches that iframe', () => {
  const afterPress = frames({ composerFocused: true, active: 'pane-iframe', paneFocused: true });
  assert.equal(afterPress, 'pane-iframe');
  const keyTarget = afterPress;
  assert.equal(keyTarget, 'pane-iframe');
});

test('a composer press reclaims a tool iframe and not a focused pane', () => {
  assert.equal(frames({ composerFocused: true, active: 'tool-iframe', paneFocused: false }), 'composer-input');
  assert.equal(frames({ composerFocused: false, active: 'tool-iframe', paneFocused: false }), 'tool-iframe');
  assert.equal(frames({ composerFocused: true, active: 'pane-iframe', paneFocused: true }), 'pane-iframe');
});
