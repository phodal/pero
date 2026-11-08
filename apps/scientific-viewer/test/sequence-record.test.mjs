import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { complement, parseGenBank } from '../ui-src/sequence-record.ts';

test('GenBank records keep circular topology, source version, bases and stranded features', async () => {
  for (const [name, accession, length, count] of [
    ['pBR322', 'J01749.1', 4361, 48],
    ['pUC19', 'M77789.2', 2686, 7],
    ['pACYC184', 'X06403.1', 4245, 7],
  ]) {
    const source = await readFile(new URL(`../assets/sequences/${name}.gb`, import.meta.url), 'utf8');
    const record = parseGenBank(source);
    assert.equal(record.accession, accession);
    assert.equal(record.circular, true);
    assert.equal(record.bases.length, length);
    assert.equal(record.features.length, count);
    assert.equal(record.skipped, 0);
    if (name === 'pBR322') {
      const bla = record.features.find(feature => feature.kind === 'CDS' && feature.label === 'bla');
      assert.equal(bla.strand, -1);
      assert.deepEqual(bla.spans, [{ start: 3292, end: 4153 }]);
    }
  }
});

test('GenBank location boundaries stay exact across the origin and unsupported ranges remain explicit', () => {
  const input = [
    'LOCUS       test 8 bp DNA circular',
    'FEATURES             Location/Qualifiers',
    '     CDS             complement(join(7..8,',
    '                     1..2))',
    '                     /label="Origin-spanning reverse CDS"',
    '     gene            <1..4',
    '     misc_feature    0..2',
    '     misc_feature    9',
    'ORIGIN',
    '        1 acgtrysw',
    '//',
  ].join('\r\n');
  const record = parseGenBank(input);
  assert.deepEqual(record.features, [{
    id: 0, label: 'Origin-spanning reverse CDS', kind: 'CDS', strand: -1,
    spans: [{ start: 6, end: 8 }, { start: 0, end: 2 }],
  }]);
  assert.equal(record.skipped, 3);
  assert.equal(complement(record.bases), 'TGCAYRSW');
  assert.throws(() => parseGenBank(input.replace('8 bp', '9 bp')), /LOCUS length/);
  assert.throws(() => parseGenBank(input + '\n' + input), /one complete/);
});
