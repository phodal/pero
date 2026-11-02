import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('MarkdownText renders the supported document structures without a blank-line requirement', async t => {
  const env = await createUiRuntime(t, 'markdown-text'); if (!env) return;
  const { React, ui, render } = env;
  await render(React.createElement(ui.MarkdownText, { text: '# Title\n## Section\nText **strong** and `code`\n- first\n- second\n1. next\n2. last\n| Name | Value |\n| --- | --- |\n| `a|b` | escaped \\| bar |' }));
  const root = document.querySelector('.pero-ui-markdown-text');
  assert.equal(root.querySelector('h2').textContent, 'Title');
  assert.equal(root.querySelector('h3').textContent, 'Section');
  assert.equal(root.querySelector('strong').textContent, 'strong');
  assert.equal(root.querySelector('p code').textContent, 'code');
  assert.deepEqual([...root.querySelectorAll('ul li')].map(node => node.textContent), ['first', 'second']);
  assert.deepEqual([...root.querySelectorAll('ol li')].map(node => node.textContent), ['next', 'last']);
  assert.deepEqual([...root.querySelectorAll('td')].map(node => node.textContent), ['a|b', 'escaped | bar']);
  assert.equal(root.querySelector('.pero-ui-markdown-table').tabIndex, 0);
  assert.equal(root.querySelector('th').scope, 'col');
});

test('MarkdownText keeps HTML, links, images and Mermaid inert', async t => {
  const env = await createUiRuntime(t, 'markdown-text'); if (!env) return;
  const { React, ui, render } = env;
  const source = '<script>globalThis.executed=true</script>\n<img src="https://example.invalid/image" onerror="alert(1)">\n[run](javascript:alert(1))\n![image](https://example.invalid/image)\nhttps://example.invalid\n```mermaid\nflowchart LR\nA-->B\n```';
  await render(React.createElement(ui.MarkdownText, { text: source }));
  const root = document.querySelector('.pero-ui-markdown-text');
  assert.equal(root.querySelector('script,img,a,iframe,svg'), null);
  assert.ok(root.textContent.includes('<script>globalThis.executed=true</script>'));
  assert.ok(root.textContent.includes('[run](javascript:alert(1))'));
  assert.ok(root.textContent.includes('![image](https://example.invalid/image)'));
  assert.equal(root.querySelector('pre code').textContent, 'flowchart LR\nA-->B');
});

test('MarkdownText preserves literal unmatched fences and replaces previous content', async t => {
  const env = await createUiRuntime(t, 'markdown-text'); if (!env) return;
  const { React, ui, render } = env;
  await render(React.createElement(ui.MarkdownText, { text: '```\n# not a heading\n  indented\n' }));
  assert.equal(document.querySelector('pre code').textContent, '# not a heading\n  indented\n');
  assert.equal(document.querySelector('h2'), null);
  await render(React.createElement(ui.MarkdownText, { text: '###### Replacement' }));
  assert.equal(document.querySelector('pre'), null);
  assert.equal(document.querySelector('h6').textContent, 'Replacement');
  assert.equal(document.querySelectorAll('#pero-app-ui-styles').length, 1);
});

test('MarkdownText presentation slots preserve existing consumer class contracts', async t => {
  const env = await createUiRuntime(t, 'markdown-text'); if (!env) return;
  const { React, ui, render } = env;
  await render(React.createElement(ui.MarkdownText, { text: '| A | B |\n| --- | --- |\n| 1 | 2 |', className: 'extra', classNames: { root: 'existing-document', table: 'existing-table' } }));
  const root = document.querySelector('.existing-document');
  assert.equal(root.className, 'existing-document extra');
  assert.equal(root.querySelector('div').className, 'existing-table');
  assert.equal(root.querySelector('div').tabIndex, 0);
  assert.equal(root.querySelector('table').textContent, 'AB12');
});
