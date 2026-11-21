import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('Fisher receipt previews imported evidence and attaches only after the researcher chooses', async t => {
  const { React, ui, dom, render, click } = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: "export {ReferenceImport} from './reference-import'; export {AppSdkProvider, createAppHost} from '@pero/app-sdk';",
  });
  const receipt = JSON.parse(await readFile(new URL('../../../packages/notebook/test/fixtures/fisher-evidence-receipt.json', import.meta.url), 'utf8'));
  const attached: unknown[] = [];
  const host = ui.createAppHost({ name: 'notebook', locale: 'en', fetch: async () => assert.fail('Receipt import must not contact the owner App') });
  await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.ReferenceImport, {
    kind: 'evidence', replacing: false, onAttach: (value: unknown) => attached.push(value),
  })));
  const choose = async (text: string, size = text.length) => {
    let read = false;
    await React.act(async () => {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Import Fisher evidence JSON"]')!;
      Object.defineProperty(input, 'files', { configurable: true, value: [{
        name: 'fisher-receipt.json', size, arrayBuffer: async () => { read = true; return new TextEncoder().encode(text).buffer; },
      }] });
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    return read;
  };
  const settle = async (expected: RegExp) => {
    const until = Date.now() + 4000;
    while (!expected.test(document.body.textContent!) && Date.now() < until) {
      await React.act(async () => new Promise<void>(resolve => setImmediate(resolve)));
    }
    assert.match(document.body.textContent!, expected);
  };
  assert.equal(await choose('', 4097), false);
  assert.match(document.body.textContent!, /4 KiB/);
  assert.equal(await choose(JSON.stringify({ ...receipt, snapshot: { ...receipt.snapshot, exactNumerator: 7 } })), true);
  await settle(/does not match its receipt digest/);
  assert.deepEqual(attached, []);
  assert.equal(await choose(JSON.stringify(receipt)), true);
  await settle(/exact sum of squares = 333\/10000 cm²/);
  assert.match(document.body.textContent!, /not proof of provenance or scientific review/);
  assert.deepEqual(attached, []);
  const attach = [...document.querySelectorAll('button')].find(button => button.textContent === 'Attach snapshot')!;
  await click(attach);
  assert.deepEqual(attached, [{
    label: 'Fisher numeric attempt', snapshot: receipt.snapshot,
    reference: { app: 'paper-agent', kind: 'fisher-attempt', id: receipt.snapshot.itemId, version: receipt.id,
      locator: `pero-app-location://paper-agent/main/fisher/${receipt.snapshot.itemId}/attempt/${receipt.snapshot.attemptId}/receipt/${receipt.id}` },
  }]);
});
