import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('LoadingSkeleton keeps status label and decorative shapes', async t => {
  const env = await createUiRuntime(t, 'skeleton'); if (!env) return;
  const { React, ui, render } = env;
  const { LoadingSkeleton, SkeletonBlock, SkeletonText, SkeletonCards } = ui;
  await render(React.createElement(LoadingSkeleton, { label: 'Loading projects' },
    React.createElement(SkeletonBlock, { shape: 'title', width: '40%' }),
    React.createElement(SkeletonText, null),
    React.createElement(SkeletonCards, { count: 2 })));
  const root = document.querySelector('.pero-ui-loading');
  assert.ok(root);
  assert.equal(document.querySelector('[role="status"]')?.textContent, 'Loading projects');
  assert.equal(document.querySelector('.pero-ui-loading-shapes')?.getAttribute('aria-hidden'), 'true');
  assert.equal(document.querySelectorAll('.pero-ui-skeleton-card').length, 2);
  assert.ok(document.querySelector('.pero-ui-skeleton-block--title'));
  await render(null);
});
