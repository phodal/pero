import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readPaperEvidence } from '../../../packages/notebook/src/paper-evidence.ts';
import { readControlEvidence } from '../../../packages/notebook/src/control-evidence.ts';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('saved evidence selection attaches fixed revision snapshots and excludes unpinned sources', async t => {
  const paperBytes = await readFile(new URL('../../../packages/notebook/test/fixtures/paper-report.json', import.meta.url));
  const paper = (await readPaperEvidence(Uint8Array.from(paperBytes).buffer)).citations[0];
  const controlBytes = await readFile(new URL('../../../packages/notebook/test/fixtures/control-export.json', import.meta.url));
  const control = (await readControlEvidence(new Blob([controlBytes])))[0];
  const cases = [
    { kind: 'evidence', label: paper.label, reference: paper.reference, snapshot: { ...paper.evidence, kind: 'paper-report' } },
    { kind: 'experiment', label: control.title, reference: control.reference, snapshot: control.snapshot },
  ];
  const { React, ui, render, click, dom } = await createUiRuntime(t, {
    resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)),
    contents: `export { SavedReferencePicker } from './saved-reference-picker'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';`,
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  for (const value of cases) {
    let attached: unknown;
    const host = ui.createAppHost({ name: 'notebook', locale: 'en', allowedApiPaths: ['/api'], fetch: async (path: string) => {
      if (path === '/api/entries') return Response.json({ entries: [{ id: 'saved', title: 'Saved study', revision: 3, updatedAt: '2026-11-11' }] });
      assert.equal(path, '/api/entries/saved/revisions/3', 'Picker must read the fixed revision, never the mutable latest entry');
      return Response.json({ document: { schemaVersion: 1, title: 'Saved study', content: { type: 'doc', content: [
        { type: value.kind, attrs: { label: 'Unpinned', source: { ...value.reference, version: '' }, snapshot: value.snapshot } },
        { type: value.kind, attrs: { label: value.label, source: value.reference, snapshot: value.snapshot } },
      ] } } });
    } });
    await render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.SavedReferencePicker, {
      kind: value.kind, replacing: false, onAttach: (result: unknown) => { attached = result; },
    })));
    const combo = document.querySelector<HTMLButtonElement>('button[aria-label="Saved notebook"]')!;
    combo.getBoundingClientRect = () => ({ x: 10, y: 10, top: 10, left: 10, right: 210, bottom: 40, width: 200, height: 30, toJSON() {} });
    await click(combo);
    await click(document.querySelector<HTMLElement>('[role="option"]')!);
    const attach = [...document.querySelectorAll('button')].find(button => button.textContent === 'Attach snapshot');
    assert.ok(attach, 'The only pinned matching source is selected');
    await click(attach);
    assert.deepEqual(attached, { label: value.label, reference: value.reference, snapshot: value.snapshot });
    await render(null);
  }
});
