import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSequence, complementSequence, findSequenceOrfs, geneticCodes, sanitizeSequence, translateSequence, type SequenceOptions } from '../src/science-sequence.ts';
import { estimateMeltingTemperature, type MeltingConditions } from '../src/science-thermodynamics.ts';

const options: SequenceOptions = { alphabet: 'DNA', frame: 0, reverse: false, circular: false, code: 1 };
test('sequence sanitation records unsupported symbols without hiding uncertainty', () => {
  const cleaned = sanitizeSequence('a c\ngT12?U', 'DNA');
  assert.equal(cleaned.bases, 'ACGT'); assert.equal(cleaned.formattingRemoved, 4);
  assert.deepEqual(cleaned.removed.map(item => item.character), ['?', 'U']);
  assert.equal(complementSequence(sanitizeSequence('ACGTRYSWKMBDHVN', 'DNA')), 'TGCAYRSWMKVHDBN');
  assert.equal(complementSequence(sanitizeSequence('AUGC', 'RNA'), true), 'GCAU');
  for (const [raw, pattern] of [['', /at least/], ['!!!', /at least/], ['A'.repeat(20_001), /20,000/]] as const) assert.throws(() => sanitizeSequence(raw, 'DNA'), pattern);
  const ambiguous = analyzeSequence('N', options);
  assert.equal(ambiguous.gcPercent, 50); assert.deepEqual(ambiguous.gcRangePercent, [0, 100]);
  assert.equal(ambiguous.molecularWeight, null); assert.equal(ambiguous.extinctionCoefficient, null);
  assert.equal(analyzeSequence('A', options).extinctionCoefficient, 15400);
  assert.equal(analyzeSequence('AA', options).extinctionCoefficient, 27400);
  assert.equal(analyzeSequence('ACG', { ...options, alphabet: 'RNA' }).molecularWeight, null);
});

test('translation respects frame, strand, IUPAC ambiguity and public genetic-code variants', () => {
  for (const [raw, code, expected] of [['ATGGCTTAA', 1, 'MA*'], ['GCN', 1, 'A'], ['NNN', 1, 'X'], ['ATATGAAGA', 1, 'I*R'], ['ATATGAAGA', 2, 'MW*']] as const) {
    assert.equal(translateSequence(sanitizeSequence(raw, 'DNA'), { ...options, code }), expected);
  }
  assert.equal(translateSequence(sanitizeSequence('AATGG', 'DNA'), { ...options, frame: 1 }), 'M');
  assert.equal(translateSequence(sanitizeSequence('TTATTTCAT', 'DNA'), { ...options, reverse: true }), 'MK*');
  assert.equal(translateSequence(sanitizeSequence('AUGGCUUAA', 'RNA'), { ...options, alphabet: 'RNA' }), 'MA*');
  assert.equal(geneticCodes.length, 27);
  for (const code of geneticCodes) assert.equal(code.aminoAcids.length, 64);
  assert.throws(() => translateSequence(sanitizeSequence('ATG', 'DNA'), { ...options, code: 999 }), /Unsupported/);
});

test('ORFs use both strands, 0-based half-open coordinates and one circular revolution', () => {
  assert.deepEqual(findSequenceOrfs(sanitizeSequence('ATGAAATAA', 'DNA'), false), [{ strand: '+', start: 0, end: 9, length: 9, wraps: false, frame: 0 }]);
  assert.deepEqual(findSequenceOrfs(sanitizeSequence('TTATTTCAT', 'DNA'), false), [{ strand: '-', start: 0, end: 9, length: 9, wraps: false, frame: 0 }]);
  const wrap = sanitizeSequence('TAACCCATG', 'DNA');
  assert.deepEqual(findSequenceOrfs(wrap, false), []);
  assert.deepEqual(findSequenceOrfs(wrap, true), [{ strand: '+', start: 6, end: 3, length: 6, wraps: true, frame: 0 }]);
  assert.equal(findSequenceOrfs(sanitizeSequence('ATGATGTAA', 'DNA'), false).length, 2);
  assert.deepEqual(findSequenceOrfs(sanitizeSequence('ATGAAA', 'DNA'), true), []);
});

const conditions: MeltingConditions = { method: 'santalucia', oligoNm: 50, sodiumMm: 50, magnesiumMm: 0, dntpMm: 0 };
test('melting estimates have explicit method and concentration bounds', () => {
  const dna = sanitizeSequence('CGTTCCAAAGATGTGGGCATGAGCTTAC', 'DNA');
  const estimate = estimateMeltingTemperature(dna, conditions);
  // SantaLucia 1998 perfect-duplex example, equal 25 nM strands and 50 mM Na.
  assert.ok(Math.abs(estimate.celsius - 60.32) < 0.02);
  for (const changed of [{ oligoNm: 0 }, { sodiumMm: NaN }, { dntpMm: -1 }]) assert.throws(() => estimateMeltingTemperature(dna, { ...conditions, ...changed }), /concentrations/);
  assert.throws(() => estimateMeltingTemperature(sanitizeSequence('ATGN', 'DNA'), conditions), /unambiguous/);
  assert.throws(() => estimateMeltingTemperature(sanitizeSequence('AUGC', 'RNA'), conditions), /Xia/);
  assert.throws(() => estimateMeltingTemperature(sanitizeSequence('AUGC', 'RNA'), { ...conditions, method: 'xia', magnesiumMm: 1 }), /sodium only/);
  assert.ok(Number.isFinite(estimateMeltingTemperature(sanitizeSequence('AUGCAUGCAUGC', 'RNA'), { ...conditions, method: 'xia' }).celsius));
  assert.ok(Number.isFinite(estimateMeltingTemperature(dna, { ...conditions, method: 'breslauer' }).celsius));
  const long = estimateMeltingTemperature(sanitizeSequence('ACGT'.repeat(30), 'DNA'), conditions);
  assert.equal(long.method, 'pero-long-dna/1');
  assert.ok(Math.abs(long.celsius - (81.5 + 16.6 * Math.log10(0.05) + 20.5 - 5)) < 1e-9);
});
