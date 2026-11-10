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

// Real component + HTTP/SQLite recovery. Only the configured Host-agent transport is a seam fake.
// This does not claim that a real configured model, OCR or browser interaction was exercised.
test('AI UI recovers unknown Host outcome, persists cell decisions, applies once and waits for confirmed cancellation', { timeout: 20_000 }, async t => {
  const app = fileURLToPath(new URL('..', import.meta.url));
  const directory = await mkdtemp(resolve(tmpdir(), 'notebook-ai-ui-'));
  const backend = spawn('python3', [resolve(app, 'backend/server.py')], { env: { ...process.env, PERO_APP_DATA: directory, PERO_APP_TOKEN: 'ai-test', PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => { if (backend.exitCode === null) { const ended = once(backend, 'exit'); backend.kill(); await ended; } await rm(directory, { recursive: true, force: true }); });
  const lines = createInterface({ input: backend.stdout });
  const [ready] = await once(lines, 'line', { signal: AbortSignal.timeout(8000) }); lines.close();
  const origin = `http://127.0.0.1:${JSON.parse(ready).port}`, nativeFetch = globalThis.fetch;
  const actualFetch = (path: string, init: RequestInit = {}) => { const headers = new Headers(init.headers); headers.set('X-Pero-App-Token', 'ai-test'); headers.set('Content-Type', 'application/json'); return nativeFetch(origin + path, { ...init, headers }); };
  const table = { id: 'table', name: 'Measurements', schema: { id: 'schema', revision: 1, columns: [{ id: 'mass', name: 'Mass', type: 'quantity', required: true, options: [], units: ['mg'] }] }, rows: [{ id: 'row', cells: {} }] };
  let content = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'source' }, content: [{ type: 'text', text: 'Sample mass: 2.5 mg.' }] }, { type: 'inputTable', attrs: { blockId: 'table-block', table, receipts: [] } }] });
  const entry = await actualFetch('/api/entries', { method: 'POST', body: JSON.stringify({ document: { schemaVersion: 1, title: 'AI observations', content: JSON.parse(content) } }) }).then(response => response.json());
  assert.ok(entry.id);
  const requests: any[] = [], sessions = new Map<string, string>(); let loseStart = true, hostStatus = 'completed', cancellations = 0, applications = 0, proposedMass = '2.5 mg';
  globalThis.fetch = async (url, init) => {
    if (url !== '/host/agent') return nativeFetch(url, init);
    const request = JSON.parse(init?.body as string);
    if (request.operation === 'info') return Response.json({ available: true, agents: [{ id: 'configured', name: 'Configured test seam', available: true }], workspace: 'local' });
    if (request.operation === 'start') {
      requests.push(request); if (!sessions.has(request.requestId)) sessions.set(request.requestId, `host-session-${sessions.size + 1}`);
      if (loseStart) { loseStart = false; throw new Error('Interrupted start response'); }
      return Response.json({ sessionId: sessions.get(request.requestId) });
    }
    if (request.operation === 'events') return Response.json({ status: hostStatus, cursor: 1, events: [], text: hostStatus === 'completed' ? JSON.stringify({ cells: [{ blockId: 'table-block', rowId: 'row', columnId: 'mass', value: proposedMass, sourceIds: ['source'], reason: 'Source records the sample mass.' }] }) : '' });
    if (request.operation === 'cancel') { cancellations++; return Response.json({}); }
    throw new Error(`Unexpected Host operation: ${request.operation}`);
  };
  t.after(() => { globalThis.fetch = nativeFetch; });
  let editor: any; t.after(() => editor?.destroy());
  const { React, ui, render, click, dom } = await createUiRuntime(t, { resolveDir: resolve(app, 'ui-src'), contents: `export { NotebookAITools } from './ai-tools'; export { NotebookScienceTools } from './science-tools'; export { Editor, Node } from '@tiptap/core'; export { default as StarterKit } from '@tiptap/starter-kit'; export { scienceSnapshotNodes } from './science-tools-shared'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';` });
  const host = ui.createAppHost({ name: 'notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: actualFetch });
  const mount = () => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.NotebookAITools, { getTarget: () => ({ entryId: entry.id, revision: 1 }), getContent: () => content, onSnapshot: () => false, onApply: (application: any) => {
    assert.equal(application.baseContent, content); applications++;
    const doc = JSON.parse(application.content); doc.content.push(...ui.scienceSnapshotNodes('AI review', application.evidence)); content = JSON.stringify(doc); return true;
  } })));
  const button = (label: string) => { const result = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label); assert.ok(result, `Missing ${label}`); return result; };
  const fill = async (label: string, value: string) => React.act(async () => {
    const caption = [...document.querySelectorAll<HTMLLabelElement>('label')].find(node => node.textContent === label); assert.ok(caption, `Missing ${label}`);
    const node = document.getElementById(caption.htmlFor)!; assert.ok(node);
    const prototype = node.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new dom.window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  const settled = async (condition: () => boolean) => { const deadline = Date.now() + 4000; while (!condition() && Date.now() < deadline) await React.act(async () => new Promise<void>(done => setImmediate(done))); assert.ok(condition(), document.body.textContent!.slice(-2000)); };
  await mount(); await settled(() => !button('Reload saved recovery').disabled);
  await fill('Proposal goal', 'Extract the recorded sample mass');
  await fill('Select a local notebook source', 'source');
  await settled(() => !button('Generate candidates').disabled);
  assert.equal(requests.length, 0); // Selecting readable source bytes never starts a model request.
  await React.act(async () => { button('Generate candidates').click(); button('Generate candidates').click(); });
  await settled(() => document.body.textContent!.includes('Request outcome unknown'));
  assert.equal(sessions.size, 1); assert.equal(requests.length, 1);
  await render(null); await mount();
  await settled(() => !![...document.querySelectorAll('button')].find(node => node.textContent === 'Reconcile original request'));
  await click(button('Reconcile original request'));
  await settled(() => document.body.textContent!.includes('host-session-1') && !button('Refresh session status').disabled);
  assert.equal(sessions.size, 1); assert.equal(requests[0].requestId, requests[1].requestId); assert.equal(requests[0].prompt, requests[1].prompt);
  await click(button('Refresh session status'));
  await settled(() => !![...document.querySelectorAll('button')].find(node => node.textContent === 'Accept'));
  await click(button('Accept')); await settled(() => !button('Reject').disabled);
  await render(null); await mount(); await settled(() => !![...document.querySelectorAll('button')].find(node => node.textContent === 'Accept') && button('Accept').disabled);
  const acknowledgment = [...document.querySelectorAll('label')].find(node => node.textContent!.includes('I reviewed all changes'))!.querySelector<HTMLElement>('[role=checkbox]')!;
  await click(acknowledgment); await click(button('Apply accepted cells'));
  await settled(() => document.body.textContent!.includes('Applied to the draft with provenance') && !button('Reload saved recovery').disabled);
  assert.equal(applications, 1); assert.equal(JSON.parse(content).content[1].attrs.table.rows[0].cells.mass, '2.5 mg');
  await render(null); await mount(); await settled(() => document.body.textContent!.includes('Applied to the draft with provenance') && !button('Reload saved recovery').disabled);
  assert.equal(applications, 1);
  hostStatus = 'running';
  await fill('Proposal goal', 'A second request'); await fill('Select a local notebook source', 'source');
  await settled(() => !button('Generate candidates').disabled); await click(button('Generate candidates'));
  await settled(() => document.body.textContent!.includes('host-session-2') && !button('Cancel session').disabled);
  await click(button('Cancel session')); await settled(() => document.body.textContent!.includes('cancelling') && !button('Refresh session status').disabled);
  assert.equal(cancellations, 1); assert.ok(button('Generate candidates').disabled);
  hostStatus = 'cancelled'; await click(button('Refresh session status')); await settled(() => document.body.textContent!.includes('cancelled') && !button('Reload saved recovery').disabled);
  assert.equal(applications, 1);
  await click(button('Dismiss this review'));
  await settled(() => !button('Reload saved recovery').disabled);
  await render(null);
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const element = document.createElement('div'); document.body.append(element);
  editor = new ui.Editor({ element, extensions: [ui.StarterKit.configure({ trailingNode: false }), ui.Node.create({
    name: 'inputTable', group: 'block', atom: true, addAttributes() { return { blockId: { default: '' }, table: { default: {} }, receipts: { default: [] } }; }, renderHTML() { return ['div']; },
  })], content: JSON.parse(content) });
  // StarterKit does not persist paragraph block IDs by itself; use the table block as the target and retain a source paragraph via a global attribute.
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.NotebookScienceTools, { editor, getTarget: () => ({ entryId: entry.id, revision: 1 }), onInsert: () => assert.fail('Typed application must use the atomic replacement callback') })));
  await click(button('Scientific tools')); await fill('Scientific tools', 'ai');
  await settled(() => !button('Reload saved recovery').disabled);
  hostStatus = 'completed'; proposedMass = '3.5 mg';
  await fill('Proposal goal', 'Review a changed measurement from the selected source');
  // Supply a real readable local file through the file picker because this minimal editor does not install paragraph IDs.
  const fileInput = document.querySelector<HTMLInputElement>('input[type=file]')!; assert.ok(fileInput);
  const localFile = { name: 'source.txt', type: 'text/plain', size: 19, arrayBuffer: async () => new TextEncoder().encode('Sample mass: 3.5 mg.').buffer };
  await React.act(async () => { Object.defineProperty(fileInput, 'files', { configurable: true, value: [localFile] }); fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  const emptyCheck = [...document.querySelectorAll('label')].find(node => node.textContent!.includes('Fill empty cells only'))!.querySelector<HTMLElement>('[role=checkbox]')!;
  await settled(() => emptyCheck.getAttribute('aria-disabled') !== 'true' && !emptyCheck.hasAttribute('disabled'));
  await click(emptyCheck); assert.equal(emptyCheck.getAttribute('aria-checked'), 'false'); await settled(() => !button('Generate candidates').disabled); await click(button('Generate candidates'));
  await settled(() => document.body.textContent!.includes('host-session-3') && !button('Refresh session status').disabled);
  // Use the source ID captured in the actual frozen request, not a fixture-only alias.
  const saved = await actualFetch(`/api/entries/${entry.id}/ai-workspace`).then(response => response.json());
  const sourceId = saved.record.frozen.sources[0].id;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const result = await priorFetch(url, init);
    if (url === '/host/agent' && JSON.parse(init?.body as string).operation === 'events') {
      const payload = await result.json(); const output = JSON.parse(payload.text); output.cells[0].sourceIds = [sourceId]; return Response.json({ ...payload, text: JSON.stringify(output) });
    }
    return result;
  };
  await click(button('Refresh session status'));
  await settled(() => !![...document.querySelectorAll('button')].find(node => node.textContent === 'Accept'));
  await click(button('Accept')); await settled(() => !button('Reject').disabled);
  const finalAck = [...document.querySelectorAll('label')].find(node => node.textContent!.includes('I reviewed all changes'))!.querySelector<HTMLElement>('[role=checkbox]')!;
  const beforeApply = JSON.stringify(editor.getJSON());
  await click(finalAck); await click(button('Apply accepted cells'));
  await settled(() => document.body.textContent!.includes('Applied to the draft with provenance') && !button('Reload saved recovery').disabled);
  assert.equal(editor.getJSON().content.find((node: any) => node.type === 'inputTable').attrs.table.rows[0].cells.mass, '3.5 mg');
  await React.act(async () => { assert.ok(editor.commands.undo()); });
  assert.equal(JSON.stringify(editor.getJSON()), beforeApply, 'Typed replacement and provenance must undo together');
});
