import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseGenBank } from '../ui-src/sequence-record.ts';
import { annotatedResidues } from '../ui-src/sequence-translation.ts';

test('pBR322 deposited CDS letters and coordinates match the reference tracks', async () => {
  const text = await readFile(new URL('../assets/sequences/pBR322.gb', import.meta.url), 'utf8');
  const record = parseGenBank(text);
  const proteins = Object.fromEntries(record.features.filter(feature => feature.translation)
    .map(feature => [feature.label, annotatedResidues(feature)]));
  const benchling = 'MKSNNALIVILGTVTLDAVGIGLVMPVLPGLLRD';
  assert.equal(proteins.tet.slice(0, benchling.length).map(residue => residue.amino).join(''), benchling);
  for (const [name, length, start, end] of [['tet', 396, 85, 88], ['ROP protein', 63, 1914, 1917], ['bla', 286, 4150, 4153]]) {
    assert.equal(proteins[name].length, length);
    assert.deepEqual(proteins[name][0].spans, [{ start, end }]);
    assert.equal(proteins[name][0].amino, 'M');
  }
});

test('CDS translation follows codon_start through a reverse join across the origin', () => {
  const record = parseGenBank([
    'LOCUS       test 10 bp DNA circular',
    'FEATURES             Location/Qualifiers',
    '     CDS             complement(join(7..10,1..4))',
    '                     /codon_start=3',
    '                     /translation="MK"',
    'ORIGIN',
    '        1 acgtacgtac',
    '//',
  ].join('\n'));
  assert.deepEqual(annotatedResidues(record.features[0]), [
    { amino: 'M', index: 1, anchor: 0, spans: [{ start: 0, end: 2 }, { start: 9, end: 10 }] },
    { amino: 'K', index: 2, anchor: 7, spans: [{ start: 6, end: 9 }] },
  ]);
});
