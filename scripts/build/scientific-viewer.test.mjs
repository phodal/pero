import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildScientificViewer } from './scientific-viewer.mjs';
test('production viewer replaces stale outputs and ships its pinned local engines', async () => {
  const outdir = await mkdtemp(resolve(tmpdir(), 'pero-viewer-build-'));
  try {
    await writeFile(resolve(outdir, 'obsolete-private-backend.js'), 'stale');
    await buildScientificViewer({ outdir });
    await assert.rejects(stat(resolve(outdir, 'obsolete-private-backend.js')), { code: 'ENOENT' });
    await assert.rejects(stat(resolve(outdir, 'RDKit_minimal.js')), { code: 'ENOENT' });
    await assert.rejects(stat(resolve(outdir, 'RDKit_minimal.wasm')), { code: 'ENOENT' });
    for (const name of ['index.html', 'index.js', 'molstar.css', 'pdf.worker.mjs', 'licenses/RDKit.txt']) assert.ok((await stat(resolve(outdir, name))).size > 0);
    assert.deepEqual(JSON.parse(await readFile(resolve(outdir, 'public-engines.json'))).map(item => item.name), ['molstar', 'pdfjs-dist', 'fflate', 'three', 'jupyter-react', 'rdkit']);
    assert.ok((await stat(resolve(outdir, 'licenses/jupyter-react.txt'))).size > 0);
  } finally { await rm(outdir, { recursive: true, force: true }); }
});

test('the actual public structure engine bundle initializes without string code generation', async () => {
  const { build } = await import('esbuild');
  const { runInNewContext } = await import('node:vm');
  const modules = resolve('apps/scientific-viewer/node_modules');
  const bundled = await build({ entryPoints: [resolve('apps/scientific-viewer/ui-src/structure-engine.ts')],
    bundle: true, platform: 'browser', format: 'iife', globalName: 'engine', write: false,
    alias: { react: resolve(modules, 'react'), 'react-dom': resolve(modules, 'react-dom') }, nodePaths: [modules] });
  // Browser-global seam only, not a renderer/WebGL mock. This tests module
  // initialization: the former full Viewer bundle throws EvalError here.
  const element = { style: {}, appendChild() {}, setAttribute() {}, getAttribute() { return null; } };
  const browser = { console, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder,
    URL, Blob, performance, atob, btoa, navigator: { userAgent: 'Mozilla/5.0' },
    document: { createElement: () => ({ ...element }), getElementsByTagName: () => [], head: element, documentElement: element } };
  browser.window = browser; browser.self = browser;
  runInNewContext(bundled.outputFiles[0].text, browser,
    { timeout: 10_000, contextCodeGeneration: { strings: false, wasm: true } });
  assert.equal(typeof browser.engine.createStructureEngine, 'function');
});
