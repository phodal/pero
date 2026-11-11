import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('App Canvas binds actual declarations and keeps availability, navigation and document permission separate', async t => {
  let editor: any;
  let dispose = async () => {};
  t.after(() => dispose());
  const runtime = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `
      import { Node } from '@tiptap/core';
      import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react';
      import StarterKit from '@tiptap/starter-kit';
      import { AppCanvasView } from './app-canvas';
      import { NotebookIdentity } from './block-identity';
      export { AppSdkProvider, createAppHost } from '@pero/app-sdk';
      const Canvas = Node.create({ name:'appCanvas', group:'block', atom:true,
        addAttributes() { return { label:{default:''}, binding:{default:null} }; },
        renderHTML() { return ['div',{'data-notebook-block':'appCanvas'}]; },
        addNodeView() { return ReactNodeViewRenderer(AppCanvasView); },
      });
      export function Fixture({ content, readonly, capture }) {
        const editor = useEditor({ extensions:[StarterKit.configure({trailingNode:false}), Canvas,
          NotebookIdentity.configure({attributeName:'blockId',types:['paragraph','appCanvas']})], content, editable:!readonly });
        capture(editor); return <EditorContent editor={editor} />;
      }
    `,
  });
  const { React, ui, dom, render, click } = runtime;
  dispose = () => React.act(async () => editor?.destroy());
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const declaration = { app: 'control-lab', title: 'Control Lab', version: '1', revision: 'a'.repeat(64), enabled: true,
    panels: [{ id: 'main', title: 'Experiments' }, { id: 'comparison', title: 'Comparison' }],
    actions: [{ name: 'read', description: 'Read an experiment' }] };
  let catalog: any = [declaration], delay = false, finish: ((value: Response) => void) | undefined, signal: AbortSignal | undefined;
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
    assert.equal(path, '/host/sdk'); assert.equal(init.cache, 'no-store'); reads++;
    signal = init.signal!;
    if (delay) return new Promise<Response>(resolve => { finish = resolve; });
    return Response.json(catalog === null ? {} : { appViews: catalog });
  });
  const navigation: any[] = [];
  let acknowledge: (() => void) | undefined;
  t.mock.method(window.parent, 'postMessage', (message: any) => {
    if (message.type !== 'pero:app:sdk') return;
    navigation.push(message);
    acknowledge = () => window.dispatchEvent(new dom.window.MessageEvent('message', {
      source: window.parent, data: { type: 'pero:app:sdk-result', id: message.id, ok: true },
    }));
  });
  const binding = { id: 'binding-original', app: 'control-lab', panel: 'main' };
  const content = { type: 'doc', content: [{ type: 'appCanvas', attrs: { blockId: 'canvas', label: 'Run view', binding } }] };
  let generation = 0;
  const mount = async (readonly = false, document = content) => {
    if (editor) await React.act(async () => editor.destroy());
    await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) },
      React.createElement(ui.Fixture, { key: ++generation, content: document, readonly, capture: (value: any) => { editor = value; } })));
  };
  const button = (label: string) => {
    const found = [...document.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label);
    assert.ok(found, `Missing button ${label}: ${document.body.textContent}`); return found;
  };
  const snapshot = () => JSON.stringify(editor.getJSON());
  const before = () => editor.getJSON().content[0].attrs.binding;
  await mount();
  assert.equal(button('Open App view').disabled, false);
  assert.match(document.body.textContent!, /Read an experiment/);
  assert.equal(document.querySelector('iframe'), null, 'Discovery is not disguised as an embedded view');
  assert.deepEqual(before(), binding);
  const original = snapshot();

  await t.test('repeated navigation is single-flight and never becomes an execution receipt', async () => {
    await click(button('Open App view'));
    assert.equal(navigation.length, 1);
    assert.deepEqual(navigation[0].input, { path: '/apps/control-lab/main' });
    await click(button('Open App view'));
    assert.equal(navigation.length, 1);
    await React.act(async () => acknowledge!());
    assert.match(document.body.textContent!, /Open request acknowledged/);
    assert.equal(snapshot(), original);
  });

  await t.test('a removed App is caught by a fresh lookup before navigation and never deletes its binding', async () => {
    catalog = [];
    await click(button('Open App view'));
    assert.equal(navigation.length, 1);
    assert.match(document.body.textContent!, /no longer installed/);
    assert.deepEqual(before(), binding);
    catalog = [{ ...declaration, enabled: false }];
    await click(button('Configure App view'));
    await click(button('Refresh installed Apps'));
    assert.match(document.body.textContent!, /installed but disabled/);
    assert.equal(button('Save binding').disabled, true);
    catalog = [{ ...declaration, panels: [{ id: 'comparison', title: 'Comparison' }] }];
    await click(button('Refresh installed Apps'));
    assert.match(document.body.textContent!, /no longer declares the saved view/);
    assert.deepEqual(before(), binding);
  });

  await t.test('cancellation ignores late catalog data and an older Host is unknown rather than missing', async () => {
    delay = true;
    const prior = reads;
    await click(button('Refresh installed Apps'));
    await click(button('Refresh installed Apps'));
    assert.equal(reads, prior + 1);
    await click(button('Cancel catalog request'));
    assert.equal(signal?.aborted, true);
    await React.act(async () => finish!(Response.json({ appViews: [declaration] })));
    assert.match(document.body.textContent!, /Availability is unverified/);
    assert.equal(button('Save binding').disabled, true);
    delay = false; catalog = null;
    await click(button('Refresh installed Apps'));
    assert.match(document.body.textContent!, /Host does not expose/);
    assert.match(document.body.textContent!, /Availability is unverified/);
    assert.deepEqual(before(), binding);
  });

  await t.test('declared selection preserves binding identity and read-only rendering never edits or runs', async () => {
    catalog = [declaration];
    await click(button('Refresh installed Apps'));
    const trigger = document.querySelector('button[aria-label="Declared view"]')!;
    trigger.getBoundingClientRect = () => ({ x: 20, y: 20, left: 20, top: 20, right: 220, bottom: 52, width: 200, height: 32, toJSON() {} });
    await click(trigger);
    const choice = [...document.querySelectorAll('[role="option"]')].find(item => item.textContent?.startsWith('Comparison'));
    assert.ok(choice); await click(choice);
    await click(button('Save binding'));
    assert.deepEqual(before(), { ...binding, panel: 'comparison' });
    const stored = editor.getJSON();
    await mount(true, stored);
    assert.equal(document.querySelector('button[aria-label="Installed App"]'), null);
    assert.equal(document.querySelector('input'), null);
    assert.equal([...document.querySelectorAll('button')].some(item => item.textContent === 'Save binding'), false);
    const frozen = snapshot();
    await click(button('Refresh installed Apps'));
    assert.equal(snapshot(), frozen);
    assert.equal(navigation.length, 1);
  });

  await t.test('unknown manual bindings survive reload without guessing a replacement', async () => {
    const manual = { id: 'legacy', app: 'old-app', panel: 'old-panel' };
    await mount(false, { ...content, content: [{ ...content.content[0], attrs: { ...content.content[0].attrs, binding: manual } }] });
    assert.deepEqual(before(), manual);
    assert.match(document.body.textContent!, /no longer installed/);
    await click(button('Configure App view'));
    assert.equal(button('Save binding').disabled, true);
    await click(button('Remove binding'));
    assert.equal(before(), null);
    assert.equal(navigation.length, 1);
  });
});
