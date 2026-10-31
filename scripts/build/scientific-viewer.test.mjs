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
    for (const name of ['index.html', 'index.js', 'molstar.js', 'RDKit_minimal.wasm', 'pdf.worker.mjs', 'licenses/RDKit.txt']) assert.ok((await stat(resolve(outdir, name))).size > 0);
    assert.deepEqual(JSON.parse(await readFile(resolve(outdir, 'public-engines.json'))).map(item => item.name), ['molstar', '@rdkit/rdkit', 'pdfjs-dist', 'fflate']);
  } finally { await rm(outdir, { recursive: true, force: true }); }
});
