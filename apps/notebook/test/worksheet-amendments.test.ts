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

test('amendment UI previews exact edits, retries lost responses against a single SQLite audit and protects unsaved drafts', { timeout: 25_000 }, async t => {
  const app = fileURLToPath(new URL('..', import.meta.url)), directory = await mkdtemp(resolve(tmpdir(), 'notebook-amendments-ui-'));
  const backend = spawn('python3', [resolve(app, 'backend/server.py')], { env: { ...process.env, PERO_APP_DATA: directory, PERO_APP_TOKEN: 'amendment-ui', PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => { if (backend.exitCode === null) { const ended = once(backend, 'exit'); backend.kill(); await ended; } await rm(directory, { recursive: true, force: true }); });
  const lines = createInterface({ input: backend.stdout });
  const [ready] = await once(lines, 'line', { signal: AbortSignal.timeout(8000) }); lines.close();
  const origin = `http://127.0.0.1:${JSON.parse(ready).port}`;
  const request = (path: string, init: RequestInit = {}) => { const headers = new Headers(init.headers); headers.set('X-Pero-App-Token', 'amendment-ui'); headers.set('Content-Type', 'application/json'); return fetch(origin + path, { ...init, headers }); };
  const content = { schemaVersion: 1, title: 'Amended input', content: { type: 'doc', content: [{ type: 'spreadsheet', attrs: { blockId: 'sheet', label: 'Data', sheet: { rows: 2, columns: 2, cells: { A1: '2', B1: '=A1*3' } }, annotations: {} } }] } };
  const created = await request('/api/entries', { method: 'POST', body: JSON.stringify({ document: content }) }).then(response => response.json());
  const runtime = await createUiRuntime(t, { resolveDir: resolve(app, 'ui-src'), contents: "export * from './worksheet-amendments'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';" });
  const { React, ui, render, click, dom } = runtime;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  let loseResponse = false; const committed: any[] = [];
  const host = ui.createAppHost({ name: 'notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async (path: string, init: RequestInit) => {
    const response = await request(path, init);
    if (init.method === 'POST' && loseResponse) { loseResponse = false; return new Response('Lost response after commit', { status: 503 }); }
    return response;
  } });
  const mount = (entry = created, dirty = false) => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.WorksheetAmendments, { entry, dirty, onCommitted: (next: any) => committed.push(next) })));
  const button = (label: string) => { const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label); assert.ok(node, label); return node; };
  const field = (label: string) => { const node = [...document.querySelectorAll('label')].find(item => item.textContent === label); assert.ok(node, label); return document.getElementById(node.htmlFor) as HTMLInputElement; };
  const fill = async (label: string, value: string) => React.act(async () => { const node = field(label), type = node.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement : dom.window.HTMLInputElement; Object.getOwnPropertyDescriptor(type.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  const settled = async (condition: () => boolean) => { const end = Date.now() + 5000; while (!condition() && Date.now() < end) await React.act(async () => new Promise<void>(done => setImmediate(done))); assert.ok(condition(), document.body.textContent!.slice(-1500)); };
  await mount(); await click(button('Worksheet amendments'));
  await settled(() => !(document.querySelector('fieldset') as HTMLFieldSetElement).disabled);
  await fill('New raw input / 新原始输入', '3'); await fill('Local author attribution / 本地署名', 'Researcher'); await fill('Reason for amendment / 更正原因', 'Corrected transcription');
  await click(button('Review amendment / 复核更正')); assert.match(document.body.textContent!, /"before": "2"/); assert.match(document.body.textContent!, /"after": "3"/);
  await click(button('Cancel amendment / 取消更正'));
  assert.equal((await request(`/api/entries/${created.id}/revisions`).then(response => response.json())).revisions.length, 1);
  await click(button('Review amendment / 复核更正')); loseResponse = true; await click(button('Create audited revision / 创建有审计的新版本'));
  await settled(() => document.body.textContent!.includes('Lost response after commit')); assert.equal(field('Reason for amendment / 更正原因').value, 'Corrected transcription');
  await click(button('Create audited revision / 创建有审计的新版本')); await settled(() => committed.length === 1);
  assert.equal(committed[0].revision, 2); assert.equal(committed[0].document.content.content[0].attrs.sheet.cells.A1, '3');
  const audit = await request(`/api/entries/${created.id}/amendments`).then(response => response.json()); assert.equal(audit.amendments.length, 1);
  assert.equal((await request(`/api/entries/${created.id}/revisions/1`).then(response => response.json())).document.content.content[0].attrs.sheet.cells.A1, '2');
  await mount(committed[0], true); assert.equal((document.querySelector('fieldset') as HTMLFieldSetElement).disabled, true); assert.match(document.body.textContent!, /Save or discard the current draft/);
});
