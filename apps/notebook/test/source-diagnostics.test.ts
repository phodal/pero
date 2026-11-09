import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';
import { notebookSourceEvidence } from '../../../scripts/build/notebook-diagnostics.mjs';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const resolveDir = fileURLToPath(new URL('../ui-src', import.meta.url));

test('packaged registry has exact source digests, bounded text and installed dependency provenance', async () => {
  const evidence = await notebookSourceEvidence(root);
  const { sha256, ...payload } = evidence;
  assert.equal(sha256, createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
  for (const item of evidence.sources) {
    assert.ok(!item.path.includes('node_modules'));
    if (item.state !== 'ready') continue;
    assert.equal(item.text, await readFile(`${root}/${item.path}`, 'utf8'));
    assert.ok(Buffer.byteLength(item.text) <= 65536);
    assert.equal(item.sha256, createHash('sha256').update(item.text).digest('hex'));
  }
  assert.equal(evidence.dependencies.find(item => item.name === 'react').installed, '19.2.8');
});

test('viewer loads inert selected source, supports missing/unavailable states, retry and bounded validation', async t => {
  const runtime = await createUiRuntime(t, { resolveDir, contents: "export * from './source-diagnostics'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';" });
  const { React, ui, render, click } = runtime;
  const oldFetch = globalThis.fetch; t.after(() => { globalThis.fetch = oldFetch; });
  const evidence = await notebookSourceEvidence(root);
  const selected = evidence.sources[0];
  // Source text containing markup must remain text, never DOM or executable code.
  selected.text = '<script>window.executed = true</script>'; selected.bytes = Buffer.byteLength(selected.text);
  let respond: (value: Response) => void = () => {};
  globalThis.fetch = async () => new Promise<Response>(resolve => { respond = resolve; });
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.NotebookSourceDiagnostics)));
  assert.match(document.body.textContent!, /Loading installed source evidence/);
  await React.act(async () => respond(new Response(JSON.stringify(evidence))));
  assert.equal(document.querySelector('pre')?.textContent, selected.text);
  assert.equal(document.querySelector('script'), null);
  assert.match(document.body.textContent!, /Evidence build SHA-256/);
  assert.match(document.body.textContent!, /19.2.8/);
  const select = document.querySelector('select')!;
  await React.act(async () => { select.value = evidence.sources[1].path; select.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(document.querySelector('pre')?.textContent, evidence.sources[1].text);
  // Loader outcomes are distinct from an empty successful source.
  globalThis.fetch = async () => new Response('', { status: 404 });
  assert.equal((await ui.loadSourceEvidence()).status, 'missing');
  globalThis.fetch = async () => new Response('', { status: 503 });
  await assert.rejects(ui.loadSourceEvidence(), /unavailable/);
  globalThis.fetch = async () => new Response(JSON.stringify({ ...evidence, sha256: 'not-a-digest' }));
  await assert.rejects(ui.loadSourceEvidence(), /Invalid packaged/);
  selected.text = 'x'.repeat(65537); selected.bytes = 65537;
  globalThis.fetch = async () => new Response(JSON.stringify(evidence));
  await assert.rejects(ui.loadSourceEvidence(), /Invalid packaged/);
  selected.state = 'missing'; delete selected.text;
  globalThis.fetch = async () => new Response(JSON.stringify(evidence));
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.NotebookSourceDiagnostics, { key: 'missing' })));
  assert.match(document.body.textContent!, /Selected source is missing/);
  selected.state = 'unavailable'; selected.reason = 'Source exceeds 64 KiB display limit';
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.NotebookSourceDiagnostics, { key: 'unavailable' })));
  assert.match(document.body.textContent!, /Selected source is unavailable/);
  globalThis.fetch = async () => { throw new Error('offline'); };
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', locale: 'en' }) }, React.createElement(ui.NotebookSourceDiagnostics, { key: 'offline' })));
  assert.match(document.body.textContent!, /could not be loaded/);
  globalThis.fetch = async () => new Response(JSON.stringify(evidence));
  await click(document.querySelector('button')!);
  assert.match(document.body.textContent!, /Evidence build SHA-256/);
});

test('legacy probe replaces history with local diagnostics and keeps non-script fallback', async () => {
  const html = await readFile(`${root}/apps/notebook/public/editor-probe.html`, 'utf8');
  assert.match(html, /href="\.\/diagnostics.html"/); assert.match(html, /<noscript>/);
  const destinations: string[] = [];
  runInNewContext(await readFile(`${root}/apps/notebook/public/editor-probe.js`, 'utf8'), { window: { location: { search: '?next=https://untrusted.invalid', hash: '#private-path', replace: (path: string) => destinations.push(path) } } });
  assert.deepEqual(destinations, ['./diagnostics.html']);
});
