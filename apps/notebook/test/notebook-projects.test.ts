import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';
const entryId = 'a'.repeat(32), otherId = 'b'.repeat(32);
const initial = { projects: [{ id: 'host-project', title: 'Actual Host project', entries: [{ id: otherId, revision: '1' }] }],
  entries: [{ id: entryId, title: 'Current notebook', revision: '2' }, { id: otherId, title: 'Other saved notebook', revision: '3' }] };

test('project chooser uses real Host records, retains stale state, and separates explicit association from labels', async t => {
  const env = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: "export * from './notebook-projects'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';" });
  const { React, ui, render, click, dom } = env, calls: any[] = [], opened: string[] = [];
  let catalog = structuredClone(initial), fail = false, finish: any;
  t.mock.method(globalThis, 'fetch', async (path: string, init: any) => {
    assert.equal(path, '/host/notebook-projects'); const input = JSON.parse(init.body); calls.push(input);
    if (input.operation === 'list') return fail ? new Response('Host unavailable', { status: 503 }) : Response.json(catalog);
    if (input.operation === 'set') return new Promise(resolve => { finish = (accepted: boolean) => {
      if (accepted) { catalog = { ...catalog, projects: [{ ...catalog.projects[0], entries: input.change.linked ? [...catalog.projects[0].entries.filter(item => item.id !== entryId), { id: entryId, revision: '2' }] : catalog.projects[0].entries.filter(item => item.id !== entryId) }] }; resolve(Response.json({ state: 'completed', ...catalog })); }
      else resolve(Response.json({ state: 'cancelled' }));
    }; });
    if (input.operation === 'cancel') finish?.(false);
    return Response.json({ state: 'cancel-requested' });
  });
  const mount = (props: any = {}) => render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) },
    React.createElement(ui.NotebookProjectAssociations, { entryId, revision: 2, readonly: false, dirty: false, onOpenEntry: (id: string) => opened.push(id), ...props })));
  const button = (text: string) => [...document.querySelectorAll('button')].find(item => item.textContent === text)!;
  await mount();
  await React.act(async () => { const select = document.querySelector('select')!; select.value = 'host-project'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  assert.match(document.body.textContent!, /Other saved notebook/); assert.match(document.body.textContent!, /Current v3/);
  await click(button('Other saved notebook')); assert.deepEqual(opened, [otherId]);
  await click(button('Link saved entry / 关联已保存条目')); await click(button('Link saved entry / 关联已保存条目'));
  assert.equal(calls.filter(call => call.operation === 'set').length, 1);
  assert.deepEqual(calls.find(call => call.operation === 'set').change, { projectId: 'host-project', entryId, revision: 2, expectedRevision: null, linked: true, readOnly: false });
  await click(button('Cancel pending project change / 取消待确认项目变更'));
  assert.match(document.body.textContent!, /Project change cancelled/);
  await click(button('Link saved entry / 关联已保存条目')); await React.act(async () => finish(true));
  assert.match(document.body.textContent!, /Host project reference saved/); assert.ok(button('Unlink entry / 解除条目关联'));
  fail = true; await click(button('Reload Host projects / 重新载入 Host 项目'));
  assert.match(document.body.textContent!, /Previous project list/); assert.match(document.body.textContent!, /Actual Host project/);
  assert.equal(button('Unlink entry / 解除条目关联').disabled, true);
  fail = false; await click(button('Reload Host projects / 重新载入 Host 项目'));
  await mount({ readonly: true }); assert.equal(button('Unlink entry / 解除条目关联'), undefined);
  await mount({ dirty: true }); assert.equal(button('Unlink entry / 解除条目关联').disabled, true);
  await mount({ revision: 1 }); assert.match(document.body.textContent!, /Load the current saved Notebook revision/);
  assert.equal(button('Unlink entry / 解除条目关联').disabled, true);
});
