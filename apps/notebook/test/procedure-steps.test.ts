import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('procedure table editor inserts the real editable spreadsheet and reports persisted content', async t => {
  let dispose = async () => {}; t.after(() => dispose());
  const runtime = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `export { ProcedureStepEditor, ProcedureTimerView } from './procedure-step-editor';
      export { AppSdkProvider, createAppHost } from '@pero/app-sdk';`,
  });
  const { React, ui, render, click, dom } = runtime;
  let patch: any;
  const step = { id: 'table', kind: 'table', text: 'Measurements', level: 'step', critical: false, pause: false, minutes: null, completed: false };
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) },
    React.createElement(ui.ProcedureStepEditor, { step, readonly: false, onChange: (value: any) => { patch = value; } })));
  dispose = () => React.act(async () => (document.querySelector('.tiptap') as any)?.editor?.destroy());
  await click([...document.querySelectorAll('summary')].find(item => item.textContent === 'Insert image or table')!);
  const insert = [...document.querySelectorAll('button')].find(item => item.textContent === 'Insert editable table');
  assert.ok(insert);
  await click(insert);
  assert.ok(patch.content.content.some((node: any) => node.type === 'spreadsheet'));
  const table = patch.content.content.find((node: any) => node.type === 'spreadsheet');
  assert.equal(table.attrs.sheet.rows, 3);
  assert.ok(table.attrs.blockId);
  const cell = document.querySelector('input[data-cell="A1"]');
  assert.ok(cell, 'same spreadsheet widget renders inside procedure');
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(cell, '=2+3');
    cell.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  assert.equal(patch.content.content.find((node: any) => node.type === 'spreadsheet').attrs.sheet.cells.A1, '=2+3');
  const label = [...document.querySelectorAll('label')].find(item => item.textContent === 'Well grid size')!;
  const size = document.getElementById(label.htmlFor)!;
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!.call(size, '4x6');
    size.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  const wellGrid = [...document.querySelectorAll('button')].find(item => item.textContent === 'Insert well grid')!;
  await click(wellGrid); await click(wellGrid);
  const plates = patch.content.content.filter((node: any) => node.type === 'spreadsheet').slice(1);
  assert.equal(plates.length, 2);
  assert.deepEqual(plates.map((node: any) => [node.attrs.sheet.rows, node.attrs.sheet.columns]), [[4, 6], [4, 6]]);
  assert.notEqual(plates[0].attrs.label, plates[1].attrs.label);
  assert.notEqual(plates[0].attrs.blockId, plates[1].attrs.blockId);
});

test('procedure timer controls dispatch explicit clock actions and readonly cannot operate it', async t => {
  const runtime = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `export { ProcedureTimerView } from './procedure-step-editor';
      export { AppSdkProvider, createAppHost } from '@pero/app-sdk';`,
  });
  const { React, ui, render, click } = runtime;
  const calls: any[] = [];
  const step = { id: 'timer', kind: 'timer', text: '', level: 'step', critical: false, pause: false, minutes: 10, completed: false,
    timer: { elapsedMs: 1250, startedAt: null } };
  const draw = (readonly: boolean) => render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) },
    React.createElement(ui.ProcedureTimerView, { step, readonly, onAction: (...args: any[]) => calls.push(args) })));
  await draw(false);
  assert.match(document.body.textContent!, /Actual elapsed: 1.3 seconds/);
  await click([...document.querySelectorAll('button')].find(item => item.textContent === 'Start timer')!);
  assert.equal(calls[0][0], 'start'); assert.ok(Number.isSafeInteger(calls[0][1]));
  await draw(true);
  assert.equal(document.querySelectorAll('button').length, 0);
});

test('procedure image picker embeds actual bytes and digest using the attachment owner', async t => {
  let dispose = async () => {}; t.after(() => dispose());
  const runtime = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `export { ProcedureStepEditor } from './procedure-step-editor';
      export { AppSdkProvider, createAppHost } from '@pero/app-sdk';`,
  });
  const { React, ui, render, dom } = runtime;
  let resolveContent: (patch: any) => void;
  const updated = new Promise<any>(resolve => { resolveContent = resolve; });
  const step = { id: 'image', kind: 'image', text: '', level: 'step', critical: false, pause: false, minutes: null, completed: false };
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) },
    React.createElement(ui.ProcedureStepEditor, { step, readonly: false, onChange: (patch: any) => {
      if (patch.content?.content.some((node: any) => node.type === 'attachment')) resolveContent(patch);
    } })));
  dispose = () => React.act(async () => (document.querySelector('.tiptap') as any)?.editor?.destroy());
  const input = document.querySelector('input[type="file"]');
  assert.ok(input);
  const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN4sAAAAASUVORK5CYII=', 'base64'));
  const file = new dom.window.File([bytes], 'sample.png', { type: 'image/png' });
  file.arrayBuffer = async () => bytes.buffer;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  let patch: any;
  await React.act(async () => {
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    patch = await updated;
  });
  const attachment = patch.content.content.find((node: any) => node.type === 'attachment').attrs;
  assert.equal(attachment.filename, 'sample.png');
  assert.equal(attachment.data, Buffer.from(bytes).toString('base64'));
  assert.match(attachment.sha256, /^[a-f0-9]{64}$/);
  for (let attempt = 0; attempt < 100 && !document.querySelector('img'); attempt++) {
    await React.act(async () => { await new Promise(resolve => setImmediate(resolve)); });
  }
  assert.ok(document.querySelector('img'), 'verified image is displayed');
});

test('procedure history synchronization preserves cursor and widget selection without emitting edits', async t => {
  let dispose = async () => {}; t.after(() => dispose());
  const { React, ui, render } = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `export { ProcedureStepEditor } from './procedure-step-editor';
      export { AppSdkProvider, createAppHost } from '@pero/app-sdk';`,
  });
  const host = ui.createAppHost({ name: 'Notebook', locale: 'en' });
  let edits = 0;
  const draw = (text: string) => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.ProcedureStepEditor, {
    step: { id: 'step', kind: 'step', text: '', level: 'step', critical: false, pause: false, minutes: null, completed: false,
      content: { type: 'doc', content: [
        { type: 'paragraph', attrs: { blockId: 'text' }, content: [{ type: 'text', text }] },
        { type: 'horizontalRule', attrs: { blockId: 'rule' } },
      ] } }, readonly: false, onChange: () => { edits++; },
  })));
  await draw('abcdefghij');
  edits = 0;
  const editor = (document.querySelector('.tiptap') as any).editor;
  dispose = () => React.act(async () => editor.destroy());
  await React.act(async () => editor.commands.setTextSelection(5));
  await draw('abcdefghi');
  assert.equal(editor.state.selection.from, 5);
  await React.act(async () => editor.commands.setTextSelection({ from: 7, to: 3 }));
  await draw('abcdefgh');
  assert.equal(editor.state.selection.anchor, 7);
  assert.equal(editor.state.selection.head, 3);
  await React.act(async () => editor.commands.setNodeSelection(10));
  await draw('ABCDEFGH');
  assert.equal(editor.state.selection.node?.type.name, 'horizontalRule');
  assert.equal(edits, 0);
});
