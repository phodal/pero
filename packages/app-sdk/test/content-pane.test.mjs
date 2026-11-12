import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('content panes own slots, scroll, and metadata layout', async t => {
  const runtime = await createUiRuntime(t, {
    resolveDir: resolve(import.meta.dirname, '../../pero-design/src'),
    cssText: true,
    contents: `
      import css from './components.css';
      export { ContentPane, InspectorHeader, ContentSection, MetadataList, contentLayout } from './content';
      export { css };
    `,
  });
  const { React, ui, render, click, dom } = runtime;
  const document = dom.window.document;
  const style = document.createElement('style');
  style.textContent = ui.css;
  document.head.append(style);
  const view = document.defaultView;

  let dismissed = 0;
  await render(React.createElement(ui.ContentPane, {
    id: 'pane',
    label: 'Datasets',
    as: 'div',
    surface: 'list',
    inset: 'compact',
    scroll: 'pane',
    busy: true,
    header: React.createElement(ui.InspectorHeader, {
      title: 'batch-7-very-long-name',
      identity: 'Dataset',
      subtitle: 'CSV',
      status: 'Indexed',
      actions: React.createElement('button', { type: 'button' }, 'Open'),
      dismiss: { label: 'Close details', onDismiss() { dismissed += 1; } },
    }),
    toolbar: React.createElement('div', null, 'filters'),
    feedback: React.createElement('p', null, 'kept'),
    footer: React.createElement('div', null, 'footer'),
  }, React.createElement(ui.ContentSection, {
    id: 'props',
    title: 'Properties',
    actions: React.createElement('button', { type: 'button' }, 'Assign'),
  }, React.createElement(ui.MetadataList, {
    items: [
      { id: 'format', label: 'Format', value: 'CSV' },
      { id: 'sha', label: 'SHA-256', value: 'abc123', format: 'code', action: React.createElement('button', { type: 'button' }, 'Copy SHA-256') },
    ],
  }))));

  const pane = document.getElementById('pane');
  assert.equal(pane.tagName, 'DIV');
  assert.equal(pane.getAttribute('role'), null);
  assert.equal(pane.getAttribute('aria-label'), 'Datasets');
  assert.equal(pane.getAttribute('data-surface'), 'list');
  assert.equal(pane.getAttribute('data-inset'), 'compact');
  assert.equal(pane.getAttribute('data-scroll'), 'pane');
  assert.equal(pane.getAttribute('aria-busy'), 'true');
  assert.deepEqual([...pane.children].map(node => node.getAttribute('data-slot')), ['header', 'toolbar', 'feedback', 'body', 'footer']);
  assert.equal(view.getComputedStyle(pane.querySelector('[data-slot="body"]')).overflowY, 'auto');
  assert.equal(document.querySelector('h1'), null);
  const title = document.querySelector('h2.pero-inspector-title');
  assert.equal(title.textContent, 'batch-7-very-long-name');
  const titleRule = ui.css.match(/\.pero-inspector-title\s*\{[^}]*\}/)[0];
  assert.match(titleRule, /var\(--pero-font-heading\)/);
  assert.doesNotMatch(titleRule, /20px|36px/);
  const section = document.getElementById('props');
  assert.equal(section.getAttribute('aria-labelledby'), 'props-title');
  assert.equal(document.getElementById('props-title').tagName, 'H3');
  assert.equal(document.getElementById('props-title').textContent, 'Properties');
  const list = document.querySelector('dl.pero-metadata');
  assert.equal(list.getAttribute('data-layout'), 'auto');
  assert.equal(list.querySelector('code').textContent, 'abc123');
  const copy = [...document.querySelectorAll('button')].find(node => node.textContent === 'Copy SHA-256');
  assert.equal(copy.closest('dd'), null);
  assert.equal(copy.parentElement.classList.contains('pero-metadata-action'), true);
  assert.equal(copy.closest('.pero-metadata-item').tagName, 'DIV');
  const dismiss = document.querySelector('.pero-inspector-dismiss');
  assert.equal(dismiss.getAttribute('aria-label'), 'Close details');
  await click(dismiss);
  assert.equal(dismissed, 1);
  assert.equal(ui.contentLayout.inspectorWidth, 360);
  assert.equal(ui.contentLayout.inspectorMin, 320);
  assert.equal(ui.contentLayout.mainMin, 360);

  await render(React.createElement(ui.ContentPane, {
    id: 'editor',
    label: 'Notes',
    scroll: 'content',
    inset: 'none',
    surface: 'workspace',
  }, React.createElement('div', { className: 'editor' }, 'body')));
  const editor = document.getElementById('editor');
  assert.equal(editor.tagName, 'SECTION');
  assert.equal(editor.getAttribute('aria-busy'), null);
  assert.equal(editor.querySelector('[data-slot="header"]'), null);
  assert.equal(editor.querySelector('[data-slot="toolbar"]'), null);
  assert.equal(editor.querySelector('[data-slot="feedback"]'), null);
  assert.equal(editor.querySelector('[data-slot="footer"]'), null);
  assert.deepEqual([...editor.children].map(node => node.getAttribute('data-slot')), ['body']);
  assert.equal(view.getComputedStyle(editor.querySelector('[data-slot="body"]')).overflowY, 'hidden');
  assert.equal(view.getComputedStyle(editor.querySelector('.editor')).overflowY, 'auto');

  await render(React.createElement(ui.MetadataList, {
    layout: 'stacked',
    items: [{ id: 'path', label: 'Path', value: 'data/batch-7.csv' }],
  }));
  assert.equal(document.querySelector('dl.pero-metadata').getAttribute('data-layout'), 'stacked');
  assert.equal(document.querySelector('dl.pero-metadata dt').textContent, 'Path');
  assert.equal(document.querySelector('dl.pero-metadata dd').textContent, 'data/batch-7.csv');
});
