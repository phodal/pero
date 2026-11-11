import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import { createUiRuntime } from '../../../packages/app-sdk/test/ui-test-runtime.mjs';

// The full composition must survive the real persistence boundary, not only each owner's validator.
test('every mounted Notebook widget and inline mention survives editor serialization and Python persistence', async t => {
  const runtime = await createUiRuntime(t, { resolveDir: resolve(import.meta.dirname, '../ui-src'), contents: `
    export { Editor } from '@tiptap/core'; export { notebookExtensions, widgets } from './editor-extensions';
    export { instantiateTemplate } from '@pero/notebook/templates';
  ` });
  const { ui } = runtime;
  const contents = ui.widgets.map((widget: { name: string; defaults: object }, index: number) => ({
    type: widget.name, attrs: { ...structuredClone(widget.defaults), blockId: `widget-${index}`,
      ...(widget.name === 'namedReference' ? { name: 'Preparation', notes: 'Record settings before measuring.' } : {}),
      ...(widget.name === 'savedSearch' ? { queryId: 'query' } : {}),
      ...(widget.name === 'attachment' ? { filename: 'empty.txt', mime: 'text/plain', data: '', caption: '', sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' } : {}),
    },
  }));
  contents.unshift({ type: 'paragraph', attrs: { blockId: 'text' }, content: [{ type: 'referenceMention', attrs: {
    label: 'Sample evidence', source: { app: 'paper-agent', kind: 'local-reference', id: 'source', version: '1', locator: '' },
  } }] } as never);
  const editor = new ui.Editor({ extensions: ui.notebookExtensions, content: { type: 'doc', content: contents } });
  const document = { schemaVersion: 1, title: 'All components', content: editor.getJSON() };
  const check = (value: unknown) => {
    const result = spawnSync('python3', ['-c', `import json,sys; import scientific_block; from document import NotebookDocument; value=json.load(sys.stdin); print(NotebookDocument.parse(value).serialized())`], {
      cwd: resolve(import.meta.dirname, '../backend'), input: JSON.stringify(value), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  assert.deepEqual(check(document), JSON.parse(JSON.stringify(document)));
  let sequence = 0;
  const instance = ui.instantiateTemplate({ id: 'template', revision: 1, name: 'Every widget', description: '', kind: 'entry', collections: [], archived: false, publishedAt: '2026-11-09T00:00:00Z', document, parameters: [] }, {}, () => `fresh-${++sequence}`);
  assert.deepEqual(check(instance.document), JSON.parse(JSON.stringify(instance.document)));
  editor.destroy();
});
