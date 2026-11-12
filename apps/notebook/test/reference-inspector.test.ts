import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('reference details open on demand, preserve edits, return focus and follow the current block', async t => {
  const { React, ui, dom, render, click } = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `import React, { useState } from 'react';
      import { NotebookEditor } from './editor';
      export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
      export function Fixture({ initial }) {
        const [document, setDocument] = useState(initial);
        return <NotebookEditor entryId="entry" revision={1} document={document} content={document.content}
          onChange={content => setDocument(previous => ({ ...previous, content }))} />;
      }`,
  });
  const host = ui.createAppHost({ name: 'notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async () => Response.json({ proposals: [] }) });
  const source = { app: 'paper-agent', kind: 'report-citation', id: 'a'.repeat(64), version: 'a'.repeat(64), locator: '' };
  const initial = { schemaVersion: 1, title: 'Methods', content: { type: 'doc', content: [
    { type: 'paragraph', attrs: { blockId: 'text' }, content: [{ type: 'text', text: 'A continuous document.' }] },
    ...['first', 'second'].map(id => ({ type: 'evidence', attrs: { blockId: id, label: id, source } })),
  ] } };
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, { initial })));
  const editor = (document.querySelector('.tiptap') as HTMLElement & { editor: any }).editor;
  const trigger = (id: string) => document.querySelector<HTMLButtonElement>(`[data-notebook-block-id="${id}"] .notebook-reference-trigger`)!;
  const label = () => document.querySelector<HTMLInputElement>('#notebook-inspector input[aria-label="Label"]')!;
  assert.equal(label(), null, 'No source form is mounted in the initial writing surface');
  await click(trigger('first'));
  assert.equal(label().value, 'first');
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(label(), 'Updated first');
    label().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  assert.match(trigger('first').textContent!, /Updated first/);
  await React.act(async () => {
    label().focus();
    label().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  assert.equal(label(), null);
  assert.equal(document.activeElement, trigger('first'), 'Escape from the portal returns to its reference');
  await click(trigger('first'));
  assert.equal(label().value, 'Updated first');
  await click(trigger('second'));
  assert.equal(label().value, 'second');
  assert.equal(trigger('first').getAttribute('aria-expanded'), 'false');
  await React.act(async () => {
    let position = 0;
    editor.state.doc.descendants((node: any, pos: number) => { if (node.attrs.blockId === 'second') position = pos; });
    editor.commands.deleteRange({ from: position, to: position + editor.state.doc.nodeAt(position).nodeSize });
  });
  assert.equal(label(), null, 'Removing the inspected block closes its details');
  const saved = editor.getJSON();
  assert.equal(saved.content.find((node: any) => node.attrs.blockId === 'first').attrs.label, 'Updated first');
  await render(null);
  await React.act(async () => editor.destroy());
});
