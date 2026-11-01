import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { examples } from '../ui-src/examples.ts';
import { blockStructureDrops } from '../ui-src/files.ts';
const require = createRequire(import.meta.url);
// Real RDKit parser/drawing acceptance lives in backend tests (official Python wheel).
test('pinned PDF.js actually extracts synthetic PDF text without browser mocks', async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new TextEncoder().encode(examples.find(x => x.name === 'sample.pdf').text), useSystemFonts: true });
  try { const document = await task.promise, page = await document.getPage(1), content = await page.getTextContent(); assert.equal(document.numPages, 1); assert.ok(content.items.some(item => item.str === 'Synthetic scientific evidence.')); }
  finally { await task.destroy(); }
});
test('pinned Mol* parses the independently authored PDB structure', async () => {
  const { parsePDB } = require('molstar/lib/commonjs/mol-io/reader/pdb/parser.js');
  const result = await parsePDB(examples.find(x => x.name === 'water.pdb').text).run();
  assert.equal(result.isError, false); assert.ok(result.result.lines.count >= 4);
});
test('Mol* stock drop manager consumes files before its unvalidated default loader', async () => {
  const { DragAndDropManager } = require('molstar/lib/commonjs/mol-plugin-state/manager/drag-and-drop.js');
  // Default loading requires plugin.runTask/state; their absence makes bypass fail.
  const manager = new DragAndDropManager({}), messages = [];
  blockStructureDrops(manager, message => messages.push(message));
  await manager.handle([new File(["data_bad\n_struct.title '<img data-marker>'"], 'unsafe.cif')]);
  assert.equal(messages.length, 1); assert.match(messages[0], /direct structure drops are disabled/);
  manager.dispose();
});
