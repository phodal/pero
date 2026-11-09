import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('template and query dialogs use persisted results and retain provenance through editor JSON and HTML', async t => {
  let editor: any;
  t.after(() => editor?.destroy());
  const runtime = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `
      export * from './template-tools'; export * from './template-origin'; export * from './saved-search';
      export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
      export { Editor } from '@tiptap/core'; export { default as StarterKit } from '@tiptap/starter-kit';
    `,
  });
  const { React, ui, dom, render, click } = runtime;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const origin = { templateId: 'template', revision: 1, instanceId: 'instance', parameterValues: { count: 0, flag: false }, idMap: { original: 'copy' } };
  const element = document.createElement('div'); document.body.append(element);
  editor = new ui.Editor({ element, extensions: [ui.StarterKit.configure({ trailingNode: false }), ui.NotebookTemplateOrigin.configure({ types: ['paragraph'] })],
    content: { type: 'doc', content: [{ type: 'paragraph', attrs: { templateOrigin: origin }, content: [{ type: 'text', text: 'Original entry' }] }] } });
  assert.deepEqual(JSON.parse(JSON.stringify(editor.getJSON().content[0].attrs.templateOrigin)), origin);
  const html = editor.getHTML();
  editor.commands.setContent(html);
  assert.deepEqual(JSON.parse(JSON.stringify(editor.getJSON().content[0].attrs.templateOrigin)), origin);
  editor.commands.setContent('<p data-notebook-template-origin="{&quot;templateId&quot;:&quot;forged&quot;}">Untrusted shape</p>');
  assert.equal(editor.getJSON().content[0].attrs.templateOrigin, null);
  editor.commands.setContent('<p>Original entry</p>');
  const source = { schemaVersion: 1, title: 'Published source', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'text' }, content: [{ type: 'text', text: 'Published text' }] }] } };
  const published = { id: 'abc', revision: 1, name: 'Assay protocol', description: 'Versioned local template', kind: 'entry', collections: ['Protocols'], archived: false, publishedAt: '2026-01-01T00:00:00Z', document: source, parameters: [] };
  const saved = { id: 'query', revision: 1, name: 'DNA assays', query: { scope: 'entries', title: 'assay', text: '', tags: ['DNA'], sort: 'updated-desc' }, updatedAt: '2026-01-01T00:00:00Z' };
  const projection = { queryId: 'query', queryRevision: 1, refreshedAt: '2026-01-02T00:00:00Z', results: [{ entryId: 'real-entry', revision: 4, title: 'Actual assay', summary: 'Saved observations', tags: ['DNA'], updatedAt: '2026-01-01T00:00:00Z' }] };
  const calls: string[] = [];
  let delayDetail = false, resolveDetail: (() => void) | undefined;
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async (input: string, init?: RequestInit) => {
    const path = String(input); calls.push(path);
    if (delayDetail && path.includes('/api/templates/')) await new Promise<void>(resolve => { resolveDetail = resolve; });
    if (path.endsWith('/revisions')) return new Response(JSON.stringify({ detail: 'The query changed. Reload its current revision.' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    const body = path.includes('/api/templates/') ? published : path.endsWith('/api/templates') ? { templates: [published] }
      : path.endsWith('/api/saved-searches') ? { searches: [saved] } : path.endsWith('/run') ? projection : null;
    return new Response(JSON.stringify(body), { status: body ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
  } });
  const mount = (child: any) => render(React.createElement(ui.AppSdkProvider, { host }, child));
  const button = (label: string) => {
    const found = [...document.querySelectorAll('button')].find(item => item.textContent === label);
    assert.ok(found, `Missing button ${label}: ${document.body.textContent}; calls=${JSON.stringify(calls)}`); return found;
  };

  let created: any;
  await mount(React.createElement(ui.NotebookTemplateTools, { editor, document: { ...source, title: 'Current entry' }, onCreateEntry: async (value: unknown) => { created = value; } }));
  await click(button('Templates'));
  await click(button('Assay protocol · v1'));
  await click(button('Create new entry'));
  assert.equal(created.title, 'Published source');
  assert.equal(created.templateOrigin.templateId, 'abc');
  assert.notEqual(created.content.content[0].attrs.blockId, 'text');
  assert.equal(editor.getText(), 'Original entry');
  assert.equal(document.querySelector('dialog'), null);
  assert.ok(calls.includes('/api/templates/abc?revision=1'));

  delayDetail = true;
  await click(button('Templates'));
  await click(button('Assay protocol · v1'));
  assert.ok(resolveDetail);
  await click(document.querySelector('dialog button[aria-label="Close"]')!);
  await React.act(async () => resolveDetail!());
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(editor.getText(), 'Original entry');
  delayDetail = false;

  let chosen: any, navigation: any;
  window.addEventListener(ui.NOTEBOOK_SEARCH_OPEN_EVENT, (event: any) => { navigation = event.detail; }, { once: true });
  await mount(React.createElement(ui.SavedSearchDialog, { initialId: 'query', onClose() {}, onUse(value: unknown) { chosen = value; } }));
  await click(button('Run saved query'));
  const result = document.querySelector('a[href*="real-entry"]'); assert.ok(result);
  await click(result);
  assert.deepEqual(navigation, { entryId: 'real-entry', revision: 4 });
  assert.match(document.body.textContent!, /1 results/);
  assert.match(document.body.textContent!, /Saved observations/);
  await click(button('Use this query revision'));
  assert.equal(chosen.id, 'query'); assert.equal(chosen.revision, 1);
  const caption = [...document.querySelectorAll('label')].find(item => item.textContent === 'Query name')!;
  const name = document.getElementById(caption.htmlFor) as HTMLInputElement;
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(name, 'My revised query');
    name.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  assert.equal(document.querySelector('a[href*="real-entry"]'), null);
  await click(button('Save new query revision'));
  assert.match(document.body.textContent!, /The query changed/);
  assert.equal(name.value, 'My revised query');
  assert.equal(button('Use this query revision').disabled, true);
});
