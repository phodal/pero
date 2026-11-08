import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTable, spectrum, defaultNumericColumns, numericSeries, inspect, assetFrom, MAX_FILE, structureText, moleculeRecords } from '../ui-src/files.ts';
import { parseNotebook } from '../ui-src/notebook.ts';
import { examples } from '../ui-src/examples.ts';

test('quoted CSV, missing values and spectrum gaps retain original rows', () => {
  const table = parseTable('x,y,note\n0,1,"a,b"\n1,,"two ""quotes"""\n2,3,end');
  assert.equal(table.rows[0][2], 'a,b'); assert.equal(table.rows[1][2], 'two "quotes"');
  assert.equal(table.missing, 1); assert.deepEqual(spectrum(table), [{ x: 0, y: 1, row: 2 }, null, { x: 2, y: 3, row: 4 }]);
  assert.throws(() => parseTable('a,b\n1'), /columns/); assert.throws(() => parseTable('a\n"unclosed'), /Unterminated/);
});
test('numeric column selection preserves gaps, finite values and original row order', () => {
  const cases = [
    { text: 'label,time[s],voltage[V]\na,2,4.2\nb,1, \nc,0,3.9', columns: [1, 2], expected: [{ x: 2, y: 4.2, row: 2 }, null, { x: 0, y: 3.9, row: 4 }] },
    { text: 'x,y\n0,NaN\n1,Infinity\n2,-Infinity\n3,text\n4,0', columns: [0, 1], expected: [null, null, null, null, { x: 4, y: 0, row: 6 }] },
    { text: 'x,y\n1e308,-1e308\n-1e308,1e308', columns: [0, 1], expected: [{ x: 1e308, y: -1e308, row: 2 }, { x: -1e308, y: 1e308, row: 3 }] },
    { text: 'x,y\n1,2\n1,3', columns: [0, 1], expected: [{ x: 1, y: 2, row: 2 }, { x: 1, y: 3, row: 3 }] },
    { text: 'sample,x,y\na,1,2', columns: [2, 1], expected: [{ x: 2, y: 1, row: 2 }] },
  ];
  for (const { text, columns, expected } of cases) assert.deepEqual(numericSeries(parseTable(text), ...columns), expected);
  const defaults = [
    ['label,time,voltage\na,0,4.2\nb,1,4.1', [1, 2]],
    ['x,y,z\n1,,3\n,2,4', [0, 2]],
    ['x,y\n1,\n,2', null],
    ['label,value\na,1\nb,2', null],
    ['x,y\nNaN,Infinity', null],
    ['x,y', null],
  ];
  for (const [text, expected] of defaults) assert.deepEqual(defaultNumericColumns(parseTable(text)), expected);
  assert.throws(() => numericSeries(parseTable('x,y\n1,2'), 0, 2), /Choose two columns/);
});
test('bounded opaque imports are hashed, not parsed or executed', async () => {
  const asset = await assetFrom(new File(['<script>throw new Error("never execute")</script>'], 'weights.pkl'));
  assert.equal(inspect(asset.name), 'opaque'); assert.match(asset.sha256, /^[a-f0-9]{64}$/); assert.equal(asset.license, 'Unknown');
  await assert.rejects(assetFrom(new File([], 'empty')), /nonempty/);
  await assert.rejects(assetFrom(new File([new Uint8Array(MAX_FILE + 1)], 'large')), /10 MiB/);
  assert.equal(inspect('unsafe.html'), 'html');
  const mesh = await assetFrom(new File(['GLB bytes are validated by the mesh preview'], 'optics-table-66db15.glb', { type: 'model/gltf-binary' }));
  assert.equal(inspect(mesh.name, mesh.mediaType), 'mesh');
  assert.equal(inspect('extensionless', mesh.mediaType), 'mesh');
  assert.equal(mesh.license, 'Unknown'); assert.equal(mesh.provenance, undefined);
});
test('thirteen independent synthetic examples include invalid and real engine inputs', () => {
  assert.equal(examples.length, 13); assert.equal(new Set(examples.map(x => x.name)).size, 13);
  for (const example of examples.filter(x => x.name.endsWith('.csv'))) assert.ok(parseTable(example.text).rows.length);
  assert.match(examples.find(x => x.name.endsWith('.pdf')).text, /^%PDF-1.4/);
  assert.ok(spectrum(parseTable(examples.find(x => x.name === 'invalid-spectrum.csv').text)).includes(null));
  const notebook = parseNotebook(new TextEncoder().encode(examples.find(x => x.name === 'demo.ipynb').text));
  assert.equal(inspect('demo.ipynb'), 'notebook');
  assert.equal(notebook.nbformat, 4);
  assert.equal(notebook.cells.length, 3);
  assert.equal(notebook.cells[1].outputs?.length, 1);
});
test('notebook preview rejects non-nbformat payloads without executing cells', () => {
  const bytes = text => new TextEncoder().encode(text);
  assert.throws(() => parseNotebook(bytes('{')), /valid JSON/);
  assert.throws(() => parseNotebook(bytes('[]')), /nbformat object/);
  assert.throws(() => parseNotebook(bytes('{"nbformat":3,"cells":[]}')), /nbformat 4/);
  assert.throws(() => parseNotebook(bytes('{"nbformat":4}')), /cells array/);
  assert.throws(() => parseNotebook(bytes('{"nbformat":4,"cells":[null]}')), /objects/);
  assert.throws(() => parseNotebook(bytes('{"nbformat":4,"cells":[{}]}')), /cell_type/);
  assert.throws(() => parseNotebook(bytes(JSON.stringify({ nbformat: 4, cells: Array.from({ length: 501 }, () => ({ cell_type: 'markdown', source: [] })) }))), /500 cells/);
});
test('structure metadata cannot reach any Mol* HTML label sink', () => {
  const bytes = text => new TextEncoder().encode(text);
  const benign = "data_water\n_entry.id water\n_struct.title 'Synthetic water'\n";
  assert.equal(structureText(bytes(benign)), benign);
  const pdb = examples.find(item => item.name === 'water.pdb').text;
  assert.equal(structureText(bytes(pdb)), pdb);
  for (const payload of ["'<img src=x onerror=alert(1)>'", "'<svg/onload=alert(1)>'", "'&lt;img src=x&gt;'", "'&#60;script&#62;'"]) {
    for (const field of ['_atom_site.auth_atom_id', '_atom_site.auth_asym_id', '_struct.title'])
      assert.throws(() => structureText(bytes(`data_attack\n${field} ${payload}\n`)), /preview blocked/);
  }
  assert.throws(() => structureText(new Uint8Array([0xc0, 0xaf])), /encoded data/);
});
test('empty or excessive molecule records fail before loading an engine', () => {
  const bytes = text => new TextEncoder().encode(text);
  for (const [name, text] of [['empty.smi', ' \n\t\n'], ['empty.sdf', '$$$$\n']]) assert.throws(() => moleculeRecords(name, bytes(text)), /No molecule records/);
  assert.throws(() => moleculeRecords('large.smi', bytes('O\n'.repeat(201))), /200 records/);
  assert.deepEqual(moleculeRecords('small.smi', bytes('O\nCCO\n')), ['O', 'CCO']);
});

test('SDF separator consumes its own newline without stripping blank molecule titles', () => {
  for (const eol of ['\n', '\r\n']) {
    const named = ['Water', 'program', '', 'counts', 'M  END', '> <note>', 'embedded$$$$value', ''].join(eol);
    const untitled = ['', 'program', '', 'counts', 'M  END', ''].join(eol);
    const records = moleculeRecords('two.sdf', new TextEncoder().encode(`${named}$$$$${eol}${untitled}$$$$${eol}`));
    assert.deepEqual(records, [named, untitled]);
    assert.deepEqual(moleculeRecords('two.sdf', new TextEncoder().encode(`${untitled}$$$$${eol}${named}$$$$`)), [untitled, named]);
    assert.deepEqual(moleculeRecords('one.mol', new TextEncoder().encode(untitled)), [untitled]);
  }
});
