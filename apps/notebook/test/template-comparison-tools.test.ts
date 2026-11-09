import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

test('template comparison reads exact immutable revisions, preserves definitions and ignores late dismissed responses', async t => {
  const { React, ui, render, click } = await createUiRuntime(t, { resolveDir: fileURLToPath(new URL('../ui-src', import.meta.url)), contents: `export { TemplateRevisionComparison } from './template-comparison'; export { AppSdkProvider, createAppHost } from '@pero/app-sdk';` });
  const first = { id: 'template', revision: 1, kind: 'fragment', name: 'Reusable step', description: '', collections: [], archived: false, publishedAt: '', parameters: [], document: { schemaVersion: 1, title: 'Step', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'step' }, content: [{ type: 'text', text: 'Old instruction' }] }] } } };
  const second = structuredClone(first); second.revision = 2; second.document.content.content[0].content[0].text = 'New instruction';
  const calls: string[] = []; let delayed: (() => void) | undefined, pause = false;
  const host = ui.createAppHost({ name: 'notebook', allowedApiPaths: ['/api'], fetch: async (path: string) => {
    calls.push(path); if (pause && path.endsWith('=2')) await new Promise<void>(resolve => { delayed = resolve; });
    return Response.json(path.endsWith('=1') ? first : second);
  } });
  const mount = () => render(React.createElement(ui.AppSdkProvider, { host }, React.createElement(ui.TemplateRevisionComparison, { template: second, latestRevision: 2 })));
  const button = () => { const result = [...document.querySelectorAll('button')].find(item => item.textContent === 'Compare published revisions'); assert.ok(result); return result; };
  await mount(); await click(button());
  assert.match(document.body.textContent!, /1 changes/); assert.match(document.body.textContent!, /Old instruction/); assert.match(document.body.textContent!, /New instruction/);
  assert.deepEqual(calls, ['/api/templates/template?revision=1', '/api/templates/template?revision=2']);
  pause = true; await click(button()); assert.ok(delayed); await render(null); await React.act(async () => delayed!());
  assert.equal(document.body.textContent, ''); assert.equal(first.document.content.content[0].content[0].text, 'Old instruction');
});
