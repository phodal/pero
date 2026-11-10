import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

const graph = () => ({ atoms: [{ id: 'c', element: 'C', x: 100, y: 100, charge: 0 }], bonds: [] });
const reaction = () => ({ name: 'Saved reaction', notes: '', molecules: [{ id: 'left', name: 'Reactant graph', role: 'reactant', graph: graph() }, { id: 'right', name: 'Product graph', role: 'product', graph: graph() }] });

test('scientific blocks draw graphs, submit local records, retain pinned derivation and reject stale outcomes', async t => {
  let editor: any, dispose = async () => {};
  t.after(() => dispose());
  const runtime = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    import { useEditor, EditorContent } from '@tiptap/react';
    import { notebookExtensions } from './editor-extensions';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
    export { isClipboardWidget } from './clipboard-block';
    export function Fixture({ content, capture, readonly }) {
      const editor = useEditor({extensions:notebookExtensions,content,editable:!readonly}); capture(editor);
      return <EditorContent editor={editor} />;
    }
  ` });
  const { React, ui, render, click, dom } = runtime;
  dispose = () => React.act(async () => editor?.destroy());
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  let delayed = false, resolveSave: (() => void) | null = null, conflict = false, writes = 0;
  const record = { id: 'a'.repeat(32), revision: 1, savedAt: '2026-11-09T12:00:00+00:00', definition: reaction() };
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async (input: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      writes++;
      const body = JSON.parse(String(init.body));
      if (delayed) await new Promise<void>(resolve => { resolveSave = resolve; });
      if (conflict) return new Response(JSON.stringify({ detail: 'A newer local record exists. Reload first.' }), { status: 409 });
      record.definition = body.definition; record.revision = body.expectedRevision ? body.expectedRevision + 1 : 1;
    }
    return new Response(JSON.stringify(record), { status: 200 });
  } });
  let mountId = 0;
  const mount = (content: any, readonly = false) => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, { key: ++mountId, content, readonly, capture: (value: any) => { editor = value; } })));
  const button = (text: string, scope: ParentNode = document) => {
    const node = [...scope.querySelectorAll('button')].find(node => node.textContent === text); assert.ok(node, `Missing button ${text}`); return node;
  };
  const control = (label: string, scope: ParentNode = document) => {
    const caption = [...scope.querySelectorAll('label')].find(node => node.textContent === label);
    const node = caption ? document.getElementById(caption.htmlFor) : scope.querySelector(`[aria-label="${label}"]`); assert.ok(node, `Missing control ${label}`); return node;
  };
  const fill = async (label: string, value: string, scope: ParentNode = document) => React.act(async () => {
    const node = control(label, scope), klass = node.tagName === 'SELECT' ? dom.window.HTMLSelectElement : node.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement : dom.window.HTMLInputElement;
    Object.getOwnPropertyDescriptor(klass.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new dom.window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  const data = () => editor.getJSON().content.find((node: any) => node.type === 'reactionScheme').attrs;
  await mount({ type: 'doc', content: [{ type: 'reactionScheme', attrs: { blockId: 'reaction-block', reaction: reaction(), record: null } }] });
  await fill('Element', 'O'); await fill('X', '180'); await click(button('Add atom'));
  assert.equal(data().reaction.molecules[0].graph.atoms.length, 2);
  await fill('Bond to atom', 'c'); await fill('Bond order', '2'); await click(button('Set bond'));
  assert.equal(data().reaction.molecules[0].graph.bonds[0].order, 2);
  await click(button('Save local reaction record'));
  assert.equal(data().record.revision, 1); assert.equal(writes, 1);
  assert.equal((button('Save next local revision') as HTMLButtonElement).disabled, true);
  await click(button('Embed saved molecule'));
  const chemical = () => editor.getJSON().content.find((node: any) => node.type === 'chemical').attrs.chemical;
  assert.equal(chemical().source.id, record.id); assert.equal(chemical().source.revision, 1);
  const chemicalScope = document.querySelector('[data-kind=chemical]')!;
  await fill('Selected atom', 'c', chemicalScope); await fill('Element', 'N', chemicalScope); await click(button('Update atom', chemicalScope));
  assert.equal(chemical().graph.atoms[0].element, 'N'); assert.equal(chemical().source.original.atoms[0].element, 'C');
  assert.match(chemicalScope.textContent!, /Modified from recorded/);
  const html = editor.getHTML();
  assert.match(html, /data-notebook-block="reactionScheme"/); assert.match(html, /data-notebook-block="chemical"/);
  await React.act(async () => editor.commands.setContent(html));
  assert.equal(data().record.id, record.id); assert.equal(chemical().source.original.atoms[0].element, 'C');
  assert.equal(ui.isClipboardWidget('reactionScheme', { reaction: reaction(), record: null }), true);
  const malformed = reaction(); malformed.molecules[0].graph.atoms[0].element = 'unsupported';
  assert.equal(ui.isClipboardWidget('reactionScheme', { reaction: malformed, record: null }), false);
  assert.equal(ui.isClipboardWidget('chemical', { chemical: { name: 'Invalid', graph: { atoms: [], bonds: [{ id: 'b', from: 'none', to: 'none', order: 1 }] }, source: null } }), false);

  conflict = true;
  await fill('Name', 'Changed draft', document.querySelector('[data-kind=reactionScheme]')!); await click(button('Save next local revision'));
  assert.match(document.body.textContent!, /newer local record/); assert.equal(data().reaction.name, 'Changed draft'); assert.equal(data().record.revision, 1);
  await click(button('Load latest local record')); await click(button('Cancel'));
  assert.equal(data().reaction.name, 'Changed draft');
  conflict = false; delayed = true;
  await click(button('Save next local revision')); await click(button('Saving…'));
  assert.equal(writes, 3, 'disabled repeated click must not submit a second request');
  await React.act(async () => editor.commands.command(({ tr }: any) => { const node = tr.doc.nodeAt(0); tr.setNodeMarkup(0, undefined, { ...node.attrs, reaction: { ...node.attrs.reaction, notes: 'Newer notebook edit' } }); return true; }));
  assert.ok(resolveSave); await React.act(async () => resolveSave!());
  assert.equal(data().reaction.notes, 'Newer notebook edit'); assert.equal(data().record.revision, 1);
  assert.match(document.body.textContent!, /Draft differs/);
  const snapshot = editor.getJSON(); await mount(snapshot, true);
  assert.equal(document.querySelector('button')?.textContent === 'Save local reaction record', false);
  const readScope = document.querySelector('[data-kind=reactionScheme]')!;
  assert.equal((control('Molecule', readScope) as HTMLSelectElement).disabled, false);
  await fill('Molecule', 'right', readScope);
  assert.equal((control('Molecule Name', readScope) as HTMLInputElement).value, 'Product graph');
});

test('plate design library saves metadata and loads a reusable layout only after confirmation', async t => {
  const runtime = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    import { useState } from 'react'; import { PlatePanel } from './science-tools-plate';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
    export function Fixture({ snapshot }) { return <PlatePanel onSnapshot={snapshot} getContent={() => ''} />; }
  ` });
  const { React, ui, render, click, dom } = runtime;
  const records: any[] = [], requests: any[] = [];
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async (input: string, init?: RequestInit) => {
    const path = String(input);
    let body: any;
    if (init?.method === 'POST') {
      const request = JSON.parse(String(init.body)); requests.push(request);
      body = { id: 'b'.repeat(32), revision: request.expectedRevision ? request.expectedRevision + 1 : 1, savedAt: '2026-11-09T12:00:00+00:00', definition: request.definition };
      records[0] = body;
    } else body = path.endsWith('/plates') ? { records } : records[0];
    return new Response(JSON.stringify(body));
  } });
  let snapshot: any;
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, { snapshot: (_: string, value: any) => { snapshot = value; return true; } })));
  const button = (label: string) => { const found = [...document.querySelectorAll('button')].find(node => node.textContent === label); assert.ok(found, `Missing ${label}`); return found; };
  const fill = async (label: string, value: string) => React.act(async () => {
    const caption = [...document.querySelectorAll('label')].find(node => node.textContent === label)!;
    const node = document.getElementById(caption.htmlFor)!;
    const klass = node.tagName === 'SELECT' ? dom.window.HTMLSelectElement : node.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement : dom.window.HTMLInputElement;
    Object.getOwnPropertyDescriptor(klass.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new dom.window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  await fill('Plate design name', 'Assay layout'); await fill('Plate barcode', 'PLATE-7'); await fill('Well capacity (µL, optional)', '20');
  await fill('Group name', 'Control'); await click(button('Assign selected wells'));
  await click(button('Save as new reusable design')); assert.equal(requests.length, 1);
  assert.equal(records[0].definition.metadata.barcode, 'PLATE-7'); assert.deepEqual(records[0].definition.layout.groups.A1, ['Control']);
  await fill('Plate barcode', 'Unsaved'); await click(button('Clear selected wells'));
  await click(button('Load selected design')); await click(button('Cancel')); await click(button('Insert snapshot'));
  assert.equal(snapshot.metadata.barcode, 'Unsaved'); assert.deepEqual(snapshot.wells[0].groups, []);
  await click(button('Load selected design')); await click(button('Replace working layout')); await click(button('Insert snapshot'));
  assert.equal(snapshot.metadata.barcode, 'PLATE-7'); assert.deepEqual(snapshot.wells[0].groups, ['Control']); assert.equal(snapshot.designOrigin.revision, 1);
  await fill('Plate barcode', 'PLATE-8'); await click(button('Save next design revision'));
  assert.equal(requests[1].expectedRevision, 1); assert.equal(records[0].revision, 2); assert.deepEqual(records[0].definition.origin, { id: records[0].id, revision: 1 });
});

test('chemical imports retain supplied pins without claiming extraction before a matching local owner read', async t => {
  let editor: any, dispose = async () => {};
  t.after(() => dispose());
  const runtime = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `
    import { useEditor, EditorContent } from '@tiptap/react'; import { notebookExtensions } from './editor-extensions';
    export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
    export function Fixture({ content, capture }) { const editor=useEditor({extensions:notebookExtensions,content}); capture(editor); return <EditorContent editor={editor}/>; }
  ` });
  const { React, ui, render, dom } = runtime;
  dispose = () => React.act(async () => editor?.destroy());
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const record = { id: 'a'.repeat(32), revision: 1, savedAt: '2026-11-09T12:00:00+00:00', definition: reaction() };
  const requests: string[] = [];
  let finish: (() => void) | undefined, delay = true;
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async (input: string) => {
    const path = String(input); requests.push(path);
    if (delay) await new Promise<void>(resolve => { finish = resolve; });
    if (path !== `/api/scientific/reactions/${record.id}?revision=1`) return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 });
    return new Response(JSON.stringify(record));
  } });
  const chemical = { name: 'Portable graph', graph: graph(), source: { id: record.id, revision: 1, moleculeId: 'left', original: graph() } };
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.Fixture, {
    content: { type: 'doc', content: [{ type: 'chemical', attrs: { blockId: 'chemical', chemical } }] }, capture: (value: any) => { editor = value; },
  })));
  const status = () => document.querySelector('[data-kind=chemical] [role=status]')!.textContent!;
  const saved = () => editor.getJSON().content.find((node: any) => node.type === 'chemical').attrs.chemical;
  const settle = async (condition: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!condition() && Date.now() < deadline) await React.act(async () => new Promise<void>(resolve => setImmediate(resolve)));
    assert.ok(condition(), status());
  };
  const importFile = async (value: any) => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Chemical JSON file"]')!;
    const text = JSON.stringify({ format: 'pero-chemical/1', chemical: value });
    await React.act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [{ size: text.length, text: async () => text }] });
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
  };
  await settle(() => !!finish);
  assert.match(status(), /Unverified supplied/);
  delay = false; await React.act(async () => finish!());
  await settle(() => status().includes('Extracted from recorded'));
  assert.equal(requests[0], `/api/scientific/reactions/${record.id}?revision=1`);

  const contradicted = structuredClone(chemical);
  contradicted.graph.atoms[0].element = 'N'; contradicted.source.original.atoms[0].element = 'N';
  await importFile(contradicted);
  await settle(() => requests.length === 2);
  assert.match(status(), /Unverified supplied/); assert.equal(saved().source.original.atoms[0].element, 'N');

  // A delayed prior owner response must not verify a newly imported unrelated pin.
  delay = true; finish = undefined; await importFile(chemical); await settle(() => !!finish);
  const oldResponse = finish!;
  const missing = structuredClone(chemical); missing.source.id = 'b'.repeat(32); missing.source.revision = 999; missing.source.moleculeId = 'missing';
  delay = false; await importFile(missing); await React.act(async () => oldResponse());
  assert.match(status(), /Unverified supplied/); assert.deepEqual(saved().source, missing.source);
  assert.ok(requests.includes(`/api/scientific/reactions/${missing.source.id}?revision=999`));
});
