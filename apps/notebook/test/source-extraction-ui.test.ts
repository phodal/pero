import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('local parser controls require explicit action, surface failures, and discard closed requests', async t => {
  // Exercise the real PDF parser to supply the transport seam; no invented extraction.
  const fixture = spawnSync(process.env.PERO_SOURCE_TEST_PYTHON || 'python3', ['-c', `import json,sys; sys.path.insert(0, 'apps/notebook/test'); from test_source_extraction import request,pdf_bytes,extract; value=request(pdf_bytes(),'application/pdf','source.pdf'); print(json.dumps({'request':value,'result':extract(value)}))`], { cwd: fileURLToPath(new URL('../../..', import.meta.url)), encoding: 'utf8' });
  assert.equal(fixture.status, 0, fixture.stderr);
  const { request, result } = JSON.parse(fixture.stdout);
  const { React, ui, render, click, dom } = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `export { SourceExtractionPicker } from './source-extraction'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';` });
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle), descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'digest');
  const hashes: Promise<ArrayBuffer>[] = [];
  Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: (...args: Parameters<SubtleCrypto['digest']>) => { const value = originalDigest(...args); hashes.push(value); return value; } });
  t.after(() => { if (descriptor) Object.defineProperty(crypto.subtle, 'digest', descriptor); else delete (crypto.subtle as any).digest; });
  const settle = async () => { while (hashes.length) await React.act(async () => { await Promise.all(hashes.splice(0)); }); };
  let calls = 0, received: any = null, release: ((value: Response) => void) | null = null;
  const host = ui.createAppHost({ name: 'notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async (path: string, init: RequestInit) => {
    assert.equal(path, '/api/source-extraction'); assert.deepEqual(JSON.parse(String(init.body)), request); calls++;
    return new Promise<Response>(resolve => { release = resolve; });
  } });
  let mounted = true, resets = 0;
  const draw = () => render(React.createElement(ui.AppSdkProvider, { host }, mounted ? React.createElement(ui.SourceExtractionPicker, { file: { ...request.file, caption: '' }, onReset: () => resets++, onExtract: (value: any) => { received = value; } }) : null));
  const button = () => [...document.querySelectorAll('button')].find(item => item.textContent?.startsWith('Extract source locally'))!;
  await draw(); assert.equal(calls, 0); assert.equal(received, null);
  await click(button()); await settle(); assert.equal(calls, 1);
  assert.equal(document.querySelector('button')!.disabled, true);
  await React.act(async () => release!(new Response(JSON.stringify(result), { status: 200 }))); await settle();
  assert.deepEqual(received, result); assert.equal(button().disabled, false);
  received = null; await click(button()); await settle(); assert.equal(calls, 2);
  mounted = false; await draw();
  await React.act(async () => release!(new Response(JSON.stringify(result), { status: 200 }))); await settle();
  assert.equal(received, null);
  mounted = true; await draw(); await click(button()); await settle();
  await React.act(async () => release!(new Response(JSON.stringify({ error: 'Parser unavailable. Repair Notebook dependencies in Host.' }), { status: 503 })));
  assert.match(document.body.textContent!, /Parser unavailable/); assert.equal(received, null); assert.equal(button().disabled, false);
  const page = document.querySelector('input')!;
  await React.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(page, '0'); page.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  assert.equal(button().disabled, true); assert.equal(resets, 1);
});
