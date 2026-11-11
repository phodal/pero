import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIpynb, editIpynbCell, clearIpynbOutputs, appendIpynbCell, ipynbExportFormats } from '../src/ipynb.ts';
import { parseIpynbMathml } from '../src/ipynb-mathml.ts';
import { ipynbCellVisibility } from '../src/ipynb-visibility.ts';
const source = readFileSync(new URL('./fixtures/ipynb-contract.json', import.meta.url), 'utf8');
test('source is exact; edits preserve unknown fields, source shape, metadata, outputs and IDs', () => {
  const doc = parseIpynb(source); assert.equal(ipynbExportFormats[0].serialize(doc), source);
  const edited = editIpynbCell(doc, 1, 'print("新")\r\n');
  assert.equal(edited.cells[1].stale, true); assert.deepEqual(edited.cells[1].outputs, doc.cells[1].outputs);
  assert.equal(edited.cells[1].raw.execution_count, 7); assert.deepEqual(edited.cells[0].raw, doc.cells[0].raw); assert.deepEqual(edited.raw.unknown, doc.raw.unknown);
  assert.deepEqual(editIpynbCell(doc, 0, '界\r\nnext').cells[0].raw.source, ['界\r\n', 'next']);
  const cleared = clearIpynbOutputs(edited, 1); assert.deepEqual(cleared.cells[1].outputs, []); assert.equal(cleared.cells[1].stale, false);
  assert.equal(appendIpynbCell(doc, 'code', 'new').cells.length, 4); assert.equal(doc.source, source);
});
test('portable JSON boundary rejects loss and invalid schema', () => {
  for (const invalid of [source.replace('"nbformat":4', '"nbformat":4,"nbformat":4'), source.replace('"unknown":42', '"unknown":9007199254740992'), source.replace('"unknown":42', '"unknown":1e999'), source.replace('"unknown":42', '"unknown":"\\ud800"'), source.replace('"id":"raw"', '"id":"code"'), source.replace('"nbformat":4', '"nbformat":5'), source.replace('"unknown":42', '"unknown":' + '['.repeat(66) + '0' + ']'.repeat(66)), ' '.repeat(1024 * 1024) + source]) assert.throws(() => parseIpynb(invalid));
});
test('presentation-only MathML and static tags never authorize execution', () => {
  assert.ok(parseIpynbMathml('<math><mfrac><mi>x</mi><mn>2</mn></mfrac></math>'));
  for (const bad of ['<math onclick="x"><mi>x</mi></math>', '<math><script>x</script></math>', '<!DOCTYPE x><math/>', '<math><mi href="https://evil">x</mi></math>']) assert.equal(parseIpynbMathml(bad), undefined);
  const raw = JSON.parse(source); raw.cells[1].metadata.tags = ['hide-input', 'remove-stderr', 'skip-execution'];
  const visibility = ipynbCellVisibility(parseIpynb(JSON.stringify(raw)).cells[1]); assert.equal(visibility.input, false); assert.equal(visibility.output, true); assert.equal(visibility.stderr, false);
});
