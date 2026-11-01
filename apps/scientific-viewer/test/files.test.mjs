import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTable, spectrum, inspect, assetFrom, MAX_FILE, structureText, moleculeRecords } from '../ui-src/files.ts';
import { examples } from '../ui-src/examples.ts';
test('quoted CSV, missing values and spectrum gaps retain original rows', () => {
  const table = parseTable('x,y,note\n0,1,"a,b"\n1,,"two ""quotes"""\n2,3,end');
  assert.equal(table.rows[0][2], 'a,b'); assert.equal(table.rows[1][2], 'two "quotes"');
  assert.equal(table.missing, 1); assert.deepEqual(spectrum(table), [{ x: 0, y: 1, row: 2 }, null, { x: 2, y: 3, row: 4 }]);
  assert.throws(() => parseTable('a,b\n1'), /columns/); assert.throws(() => parseTable('a\n"unclosed'), /Unterminated/);
});
test('bounded opaque imports are hashed, not parsed or executed', async () => {
  const asset = await assetFrom(new File(['<script>throw new Error("never execute")</script>'], 'weights.pkl'));
  assert.equal(inspect(asset.name), 'opaque'); assert.match(asset.sha256, /^[a-f0-9]{64}$/); assert.equal(asset.license, 'Unknown');
  await assert.rejects(assetFrom(new File([], 'empty')), /nonempty/);
  await assert.rejects(assetFrom(new File([new Uint8Array(MAX_FILE + 1)], 'large')), /10 MiB/);
  assert.equal(inspect('unsafe.html'), 'opaque');
});
test('twelve independent synthetic examples include invalid and real engine inputs', () => {
  assert.equal(examples.length, 12); assert.equal(new Set(examples.map(x => x.name)).size, 12);
  for (const example of examples.filter(x => x.name.endsWith('.csv'))) assert.ok(parseTable(example.text).rows.length);
  assert.match(examples.find(x => x.name.endsWith('.pdf')).text, /^%PDF-1.4/);
  assert.ok(spectrum(parseTable(examples.find(x => x.name === 'invalid-spectrum.csv').text)).includes(null));
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
