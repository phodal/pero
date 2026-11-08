import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createUiRuntime } from './ui-test-runtime.mjs';

const require = createRequire(import.meta.url);

test('UI runtime external React imports use file URLs and share the host React instance', async t => {
  const { React, ui, temporary } = await createUiRuntime(t, {
    resolveDir: import.meta.dirname,
    contents: `
      export { default as React } from 'react';
      export { jsx } from 'react/jsx-runtime';
      export { createPortal } from 'react-dom';
      export { createRoot } from 'react-dom/client';
      export const requiredReact = require('react');
      export const requiredDom = require('react-dom');
    `,
  });
  assert.equal(ui.React, React);
  assert.equal(ui.requiredReact, React);
  assert.equal(ui.requiredDom, require('react-dom'));
  assert.equal(ui.jsx, require('react/jsx-runtime').jsx);
  assert.equal(ui.createPortal, require('react-dom').createPortal);
  assert.equal(ui.createRoot, require('react-dom/client').createRoot);

  // Inspect imports in the emitted ESM, not the runtime's implementation source.
  // On Windows these must be file:///D:/... URLs, never bare D:\\... paths.
  const { build } = require('esbuild');
  const { metafile } = await build({
    entryPoints: [resolve(temporary, 'ui.mjs')],
    write: false, metafile: true, platform: 'node', format: 'esm',
  });
  const imports = Object.values(metafile.outputs).flatMap(output => output.imports);
  for (const name of ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']) {
    const expected = pathToFileURL(require.resolve(name)).href;
    assert.ok(imports.some(item => item.kind === 'import-statement' && item.path === expected), `missing file URL import for ${name}: ${JSON.stringify(imports)}`);
  }
});
