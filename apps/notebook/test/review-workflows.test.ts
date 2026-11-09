import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

// Only transport failures are injected. Every record and outcome comes from the real owner.
test('workflow UI configures stages, pins plans, retains rejected input, reassigns labels and reports bulk conflicts', { timeout: 25_000 }, async t => {
  const app = fileURLToPath(new URL('..', import.meta.url));
  const directory = await mkdtemp(resolve(tmpdir(), 'notebook-workflow-ui-'));
  const backend = spawn('python3', [resolve(app, 'backend/server.py')], { env: { ...process.env, PERO_APP_DATA: directory, PERO_APP_TOKEN: 'workflow-ui', PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => { if (backend.exitCode === null) { const ended = once(backend, 'exit'); backend.kill(); await ended; } await rm(directory, { recursive: true, force: true }); });
  const lines = createInterface({ input: backend.stdout });
  const [ready] = await once(lines, 'line', { signal: AbortSignal.timeout(8000) }); lines.close();
  const origin = `http://127.0.0.1:${JSON.parse(ready).port}`;
  const request = (path: string, init: RequestInit = {}) => { const headers = new Headers(init.headers); headers.set('X-Pero-App-Token', 'workflow-ui'); headers.set('Content-Type', 'application/json'); return fetch(origin + path, { ...init, headers }); };
  const content = { schemaVersion: 1, title: 'Workflow source', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'notes' }, content: [{ type: 'text', text: 'Original source' }] }] } };
  const created = await request('/api/entries', { method: 'POST', body: JSON.stringify({ document: content }) }).then(value => value.json());
  const endpoint = `/api/entries/${created.id}/review-workspace`;
  const post = (payload: object) => request(endpoint, { method: 'POST', body: JSON.stringify({ actorDisplay: 'Local notebook user', requestId: crypto.randomUUID(), expectedVersion: 0, ...payload }) }).then(value => value.json());
  const state = () => request(endpoint).then(value => value.json());
  let rejectNext = false, posts = 0, interruptAfterApply = false;
  const runtime = await createUiRuntime(t, { resolveDir: resolve(app, 'ui-src'), contents: `export { ReviewerPanel } from './review-panel'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';` });
  const { React, ui, render, click, dom } = runtime;
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.open = false; };
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.open = true; };
  const host = ui.createAppHost({ name: 'notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async (path: string, init: RequestInit) => {
    if (init.method === 'POST') {
      posts++;
      if (rejectNext) { rejectNext = false; return new Response(JSON.stringify({ detail: 'Interrupted; your input is retained.' }), { status: 503 }); }
      if (interruptAfterApply) { interruptAfterApply = false; await request(path, init); return new Response(JSON.stringify({ detail: 'Response interrupted after saving. Retry the same input.' }), { status: 503 }); }
    }
    return request(path, init);
  } });
  const mount = (revision = 1, document = content, readonly = false) => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.ReviewerPanel, { entryId: created.id, revision, document, readonly })));
  const button = (text: string, root: ParentNode = document) => {
    const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text || node.getAttribute('aria-label') === text);
    assert.ok(found, `Missing button ${text}`); return found;
  };
  const tab = (label: string) => { const found = [...document.querySelectorAll<HTMLElement>('[role=tab]')].find(node => node.textContent === label); assert.ok(found); return found; };
  const dialog = () => { const found = document.querySelector<HTMLElement>('dialog'); assert.ok(found); return found; };
  const field = (label: string) => { const found = [...document.querySelectorAll<HTMLLabelElement>('label')].find(node => node.textContent === label); assert.ok(found, `Missing label ${label}`); return document.getElementById(found.htmlFor) as HTMLInputElement | HTMLTextAreaElement; };
  const fill = async (node: HTMLInputElement | HTMLTextAreaElement, value: string) => React.act(async () => {
    const prototype = node.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const settled = async (condition: () => boolean) => {
    const end = Date.now() + 5000;
    while (!condition() && Date.now() < end) await React.act(async () => new Promise<void>(done => setImmediate(done)));
    assert.ok(condition(), `UI did not settle: ${document.body.textContent?.slice(-5000)}`);
  };
  await mount(); await click(tab('Human review')); await settled(() => [...document.querySelectorAll<HTMLButtonElement>('button')].some(node => node.textContent === 'Configure workflow' && !node.disabled));
  await click(button('Configure workflow')); await fill(field('Workflow name'), 'Assay peer plan');
  await fill(field('Stage name 1'), 'Methods'); await fill(field('Participant labels (one per line) 1'), 'Local notebook user\nPeer label');
  await click(button('Add stage')); await fill(field('Stage name 2'), 'Release');
  rejectNext = true; await click(button('Save workflow version'));
  await settled(() => dialog().textContent?.includes('Interrupted; your input is retained.') === true);
  assert.equal(field('Workflow name').value, 'Assay peer plan');
  await React.act(async () => { button('Save workflow version').click(); button('Save workflow version').click(); });
  await settled(() => !document.querySelector('dialog'));
  assert.equal(posts, 2);
  await click(button('Request workflow review · r1')); await settled(() => !button('Request workflow review', dialog()).disabled);
  interruptAfterApply = true; await click(button('Request workflow review', dialog()));
  await settled(() => dialog().textContent?.includes('Response interrupted') === true);
  await click(button('Request workflow review', dialog())); await settled(() => !document.querySelector('dialog'));
  assert.equal((await state()).workflowRuns.length, 1);
  assert.match(document.body.textContent!, /Waiting for earlier stage/);
  await click(button('Approve my assignment'));
  await fill(field('Action reason'), 'Checked original source');
  assert.equal(button('Record local workflow action').disabled, true);
  const check = dialog().querySelector<HTMLElement>('[role=checkbox],input[type=checkbox]'); assert.ok(check); await click(check);
  await settled(() => !button('Record local workflow action').disabled);
  await click(button('Record local workflow action')); await settled(() => !document.querySelector('dialog'));
  assert.equal(document.querySelectorAll('[data-review-run] button').length > 0, true);
  // Only peer labels remain in this stage, so no one can approve them as the current operator.
  assert.equal([...document.querySelectorAll('button')].some(node => node.textContent === 'Approve my assignment'), false);
  await click(button('Reassign pending review')); await fill(field('New participant label'), 'Replacement label'); await fill(field('Action reason'), 'Coverage change');
  await click(button('Record local workflow action')); await settled(() => !document.querySelector('dialog'));
  assert.equal((await state()).workflowRuns[0].assignments[1].participantDisplay, 'Replacement label');
  await click(button('Edit workflow')); await fill(field('Workflow name'), 'Next assay plan');
  const priorPlan = (await state()).workflowConfigs[0];
  await post({ action: 'save-workflow', id: priorPlan.id, expectedVersion: priorPlan.version, name: 'Intervening plan', stages: priorPlan.stages });
  await click(button('Save workflow version')); await settled(() => dialog().textContent?.includes('This local record changed') === true);
  assert.equal(field('Workflow name').value, 'Next assay plan');
  await click(button('Reload records and use current versions', dialog()));
  await settled(() => [...dialog().querySelectorAll<HTMLButtonElement>('button')].some(node => node.textContent === 'Save workflow version' && !node.disabled));
  await click(button('Save workflow version')); await settled(() => !document.querySelector('dialog'));
  const changedPlan = await state(); assert.equal(changedPlan.workflowConfigs[0].version, 3); assert.equal(changedPlan.workflowRuns[0].workflow.name, 'Assay peer plan');
  await click(button('Withdraw workflow review')); await fill(field('Action reason'), 'A corrected source is needed');
  await React.act(async () => dialog().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(document.querySelector('dialog'), null); assert.equal((await state()).workflowRuns[0].status, 'requested');
  const revised = structuredClone(content); revised.title = 'Changed source';
  await request(`/api/entries/${created.id}`, { method: 'POST', body: JSON.stringify({ baseRevision: 1, document: revised }) });
  await mount(2, revised); await settled(() => document.body.textContent?.includes('Older revision; this workflow does not approve the latest saved content.') === true);
  await click(button('Request fresh workflow review · r2')); await settled(() => !button('Request workflow review', dialog()).disabled);
  await click(button('Request workflow review', dialog())); await settled(() => !document.querySelector('dialog'));
  const fresh = await state(); assert.equal(fresh.workflowRuns.length, 2); assert.equal(fresh.workflowRuns[0].revision, 2); assert.equal(fresh.workflowRuns[0].workflow.version, 1);
  // Batch selection freezes versions so an intervening edit is reported, never silently replaced.
  const first = (await post({ action: 'create-task', revision: 2, title: 'First task', ownerDisplay: 'Local notebook user' })).tasks[0];
  const second = (await post({ action: 'create-task', revision: 2, title: 'Second task', ownerDisplay: 'Local notebook user' })).tasks[0];
  await click(button('Refresh records')); await click(tab('Local tasks')); await settled(() => document.body.textContent?.includes('Second task') === true);
  const taskPanel = [...document.querySelectorAll<HTMLElement>('[role=tabpanel]')].find(node => node.textContent?.includes('Notebook to-dos are manual local records')); assert.ok(taskPanel);
  await click(button('Bulk actions', taskPanel));
  for (const checkbox of dialog().querySelectorAll<HTMLElement>('[role=checkbox],input[type=checkbox]')) await click(checkbox);
  await post({ action: 'set-task-status', id: second.id, expectedVersion: 1, status: 'in_progress' });
  await click(button('Apply to selected records')); await settled(() => dialog().textContent?.includes('1 succeeded; 1 failed') === true);
  assert.equal([...dialog().querySelectorAll('[role=checkbox]')].filter(node => node.getAttribute('aria-checked') === 'true').length, 1);
  await click(button('Reload records and use current versions', dialog()));
  await settled(() => [...dialog().querySelectorAll<HTMLButtonElement>('button')].some(node => node.textContent === 'Apply to selected records' && !node.disabled));
  await click(button('Apply to selected records')); await settled(() => dialog().textContent?.includes('1 succeeded; 0 failed') === true);
  assert.deepEqual((await state()).tasks.map((item: { status: string }) => item.status), ['done', 'done']);
  assert.equal((await state()).tasks.find((item: { id: string }) => item.id === first.id).version, 2);
  await click(button('Cancel', dialog()));
  await mount(2, revised, true); await click(tab('Human review'));
  assert.equal([...document.querySelectorAll('button')].some(node => node.textContent === 'Configure workflow'), false);
  assert.equal([...document.querySelectorAll('button')].some(node => node.textContent === 'Reassign pending review'), false);
});
