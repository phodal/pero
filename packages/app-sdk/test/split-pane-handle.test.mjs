import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('SplitPaneHandle keeps separator ARIA, clamp, side deltas and commit', async t => {
  const env = await createUiRuntime(t, 'split-pane-handle'); if (!env) return;
  const { React, dom, ui, render } = env;
  const { SplitPaneHandle } = ui;
  const key = async (target, value, shiftKey = false) => {
    await React.act(async () => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })));
  };

  await t.test('roles, clamp, left/right arrow, Home/End and double-click reset', async () => {
    const values = [];
    const commits = [];
    const tree = (value, side = 'left') => React.createElement(SplitPaneHandle, {
      label: 'Resize', value, min: 100, max: 400, valueText: `${value}px`, side, step: 20, largeStep: 40, homeEnd: true,
      defaultValue: 200, onValueChange: next => values.push(next), onCommit: () => commits.push(true),
    });
    await render(tree(200));
    const handle = document.querySelector('[role="separator"]');
    assert.equal(handle.getAttribute('aria-orientation'), 'vertical');
    assert.equal(handle.getAttribute('aria-valuemin'), '100');
    assert.equal(handle.getAttribute('aria-valuemax'), '400');
    assert.equal(handle.getAttribute('aria-valuenow'), '200');
    assert.equal(handle.tabIndex, 0);
    await key(handle, 'ArrowRight');
    assert.deepEqual(values, [220]);
    assert.equal(commits.length, 1);
    await render(tree(220));
    await key(handle, 'ArrowRight', true);
    assert.equal(values.at(-1), 260);
    await render(tree(260, 'right'));
    await key(handle, 'ArrowRight');
    assert.equal(values.at(-1), 240, 'right pane shrinks when the handle moves right');
    await render(tree(240));
    await key(handle, 'Home');
    assert.equal(values.at(-1), 100);
    await render(tree(100));
    await key(handle, 'End');
    assert.equal(values.at(-1), 400);
    await render(tree(400));
    await React.act(async () => handle.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true })));
    assert.equal(values.at(-1), 200);
    await render(null);
  });

  await t.test('horizontal grip uses the Y axis keys and grows a pane below when moved up', async () => {
    const values = [];
    await render(React.createElement(SplitPaneHandle, {
      label: 'Resize panel', orientation: 'horizontal', side: 'right', value: 200, min: 100, max: 400, valueText: '200px', step: 20,
      onValueChange: next => values.push(next),
    }));
    const handle = document.querySelector('[role="separator"]');
    assert.equal(handle.getAttribute('aria-orientation'), 'horizontal');
    await key(handle, 'ArrowRight');
    assert.deepEqual(values, [], 'horizontal grip ignores X-axis keys');
    await key(handle, 'ArrowUp');
    assert.equal(values.at(-1), 220, 'the pane below grows when the grip moves up');
    await key(handle, 'ArrowDown');
    assert.equal(values.at(-1), 180);
    await render(null);
  });

  await t.test('Enter callback and hidden tabIndex', async () => {
    let enters = 0;
    await render(React.createElement(SplitPaneHandle, {
      label: 'Swap', value: 300, min: 100, max: 500, valueText: '300', onValueChange: () => {}, onEnter: () => { enters += 1; },
    }));
    await key(document.querySelector('[role="separator"]'), 'Enter');
    assert.equal(enters, 1);
    await render(React.createElement(SplitPaneHandle, {
      label: 'Hidden', value: 300, min: 100, max: 500, valueText: '300', hidden: true, onValueChange: () => {},
    }));
    assert.equal(document.querySelector('[role="separator"]').tabIndex, -1);
    await render(null);
  });
});
