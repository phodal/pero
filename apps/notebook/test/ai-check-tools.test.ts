import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('check-generation UI persists Host input, feedback and one reviewed snapshot across reload', { timeout: 20_000 }, async t => {
  const app = fileURLToPath(new URL('..', import.meta.url)), directory = await mkdtemp(resolve(tmpdir(), 'notebook-check-ui-'));
  const backend = spawn('python3', [resolve(app, 'backend/server.py')], { env: { ...process.env, PERO_APP_DATA: directory, PERO_APP_TOKEN: 'check-test', PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => { if (backend.exitCode === null) { const ended = once(backend, 'exit'); backend.kill(); await ended; } await rm(directory, { recursive: true, force: true }); });
  const lines = createInterface({ input: backend.stdout }); const [ready] = await once(lines, 'line', { signal: AbortSignal.timeout(8000) }); lines.close();
  const origin = `http://127.0.0.1:${JSON.parse(ready).port}`, nativeFetch = globalThis.fetch;
  let releaseRecovery!: () => void, holdInitialRecovery = true;
  const initialRecovery = new Promise<void>(resolve => { releaseRecovery = resolve; });
  const actualFetch = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers); headers.set('X-Pero-App-Token', 'check-test'); headers.set('Content-Type', 'application/json');
    const response = await nativeFetch(origin + path, { ...init, headers });
    if (holdInitialRecovery && path.endsWith('/ai-workspace') && (init.method ?? 'GET') === 'GET') { holdInitialRecovery = false; await initialRecovery; }
    return response;
  };
  let content = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'source' }, content: [{ type: 'text', text: 'Signal value without units.' }] }] });
  const entry = await actualFetch('/api/entries', { method: 'POST', body: JSON.stringify({ document: { schemaVersion: 1, title: 'Check source', content: JSON.parse(content) } }) }).then(result => result.json());
  const starts: any[] = []; let inserts = 0;
  globalThis.fetch = async (path, init) => {
    if (path !== '/host/agent') return nativeFetch(path, init);
    const body = JSON.parse(init?.body as string);
    if (body.operation === 'info') return Response.json({ available: true, agents: [{ id: 'configured', name: 'Configured seam', available: true }], workspace: 'local' });
    if (body.operation === 'start') { starts.push(body); return Response.json({ sessionId: 'check-host-session' }); }
    if (body.operation === 'events') return Response.json({ status: 'completed', cursor: 1, events: [], text: JSON.stringify({ checks: [{ text: 'Record the signal units.', severity: 'warning', blockIds: ['source'] }] }) });
    throw new Error(`Unexpected operation ${body.operation}`);
  };
  t.after(() => { globalThis.fetch = nativeFetch; });
  const { React, ui, dom, render, click } = await createUiRuntime(t, { resolveDir: resolve(app, 'ui-src'), contents: `export { NotebookAITools } from './ai-tools'; export { scienceSnapshotNodes } from './science-tools-shared'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';` });
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const host = ui.createAppHost({ name: 'notebook', allowedApiPaths: ['/api'], fetch: actualFetch });
  const mount = () => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.NotebookAITools, { getTarget: () => ({ entryId: entry.id, revision: 1 }), getContent: () => content,
    onSnapshot: (title: string, snapshot: any) => { inserts++; const doc = JSON.parse(content); doc.content.push(...ui.scienceSnapshotNodes(title, snapshot)); content = JSON.stringify(doc); return true; } })));
  const button = (text: string) => { const result = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text); assert.ok(result, `Missing ${text}`); return result; };
  const settle = async (condition: () => boolean) => { const until = Date.now() + 4000; while (!condition() && Date.now() < until) await React.act(async () => new Promise<void>(done => setImmediate(done))); assert.ok(condition(), document.body.textContent); };
  const field = (text: string) => {
    const label = [...document.querySelectorAll<HTMLLabelElement>('label')].find(node => node.textContent === text); assert.ok(label, text);
    const element = document.getElementById(label.htmlFor) as HTMLSelectElement | HTMLTextAreaElement; assert.ok(element, text); return element;
  };
  const fill = async (text: string, value: string) => React.act(async () => {
    const element = field(text); assert.equal(element.disabled, false, `${text} must be ready before input`);
    const prototype = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  await mount();
  // The reload button stays available while loading. Wait on the actual editing and
  // generation guards, including a deterministically delayed real SQLite response.
  await settle(() => !holdInitialRecovery);
  assert.equal(field('Proposal mode / 建议模式').disabled, true);
  assert.equal(button('Generate candidates').disabled, true);
  assert.equal(starts.length, 0);
  await React.act(async () => releaseRecovery());
  await settle(() => !field('Proposal mode / 建议模式').disabled);
  await fill('Proposal mode / 建议模式', 'checks'); await fill('Proposal goal / 建议目标', 'Review missing units');
  await settle(() => !button('Generate candidates').disabled);
  await click(button('Generate candidates')); await settle(() => !button('Reload saved recovery / 重新载入恢复记录').disabled && document.body.textContent!.includes('check-host-session'));
  assert.equal(starts.length, 1); assert.match(starts[0].prompt, /missing units/);
  const pending = await actualFetch(`/api/entries/${entry.id}/ai-workspace`).then(result => result.json());
  assert.equal(pending.record.frozen.mode, 'checks'); assert.equal(pending.record.frozen.content, content);
  await click(button('Refresh session status / 刷新会话状态')); await settle(() => document.body.textContent!.includes('Record the signal units.') && !button('Reload saved recovery / 重新载入恢复记录').disabled);
  const usefulness = document.querySelector<HTMLButtonElement>('[aria-label="Usefulness / 实用性 · check-1"]');
  assert.ok(usefulness); usefulness.getBoundingClientRect = () => ({ left: 20, top: 20, right: 220, bottom: 50, width: 200, height: 30, x: 20, y: 20, toJSON() {} }); await click(usefulness); const option = [...document.querySelectorAll('[role=option]')].find(node => node.textContent?.includes('Useful / 有用')); assert.ok(option, document.body.innerHTML.slice(-10000)); await click(option);
  await settle(() => !button('Reload saved recovery / 重新载入恢复记录').disabled);
  await render(null); await mount(); await settle(() => document.body.textContent!.includes('Useful / 有用') && !button('Reload saved recovery / 重新载入恢复记录').disabled);
  assert.equal(starts.length, 1); assert.equal(inserts, 0);
  const ack = [...document.querySelectorAll('label')].find(node => node.textContent!.includes('I reviewed these suggestions'))!.querySelector('[role=checkbox]')!;
  await click(ack); await click(button('Insert reviewed check suggestions / 插入已复核检查建议'));
  await settle(() => document.body.textContent!.includes('Review snapshot is in the draft') && !button('Reload saved recovery / 重新载入恢复记录').disabled);
  assert.equal(inserts, 1); assert.match(content, /pero-host-check-suggestions\/1/);
  await render(null); await mount(); await settle(() => document.body.textContent!.includes('Review snapshot is in the draft'));
  assert.equal(inserts, 1); assert.equal(starts.length, 1);
});
