import { geneticCodes } from './science-genetic-codes.ts';
export { geneticCodes } from './science-genetic-codes.ts';

export type SequenceAlphabet = 'DNA' | 'RNA';
export interface SanitizedSequence { bases: string; alphabet: SequenceAlphabet; removed: { character: string; position: number }[]; formattingRemoved: number }
export interface SequenceOptions { alphabet: SequenceAlphabet; frame: 0 | 1 | 2; reverse: boolean; circular: boolean; code: number }
export interface OpenReadingFrame { strand: '+' | '-'; start: number; end: number; length: number; wraps: boolean; frame: number }
const ambiguity: Record<string, string> = { A: 'A', C: 'C', G: 'G', T: 'T', U: 'T', R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC', B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT' };
const complements: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', U: 'A', R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K', B: 'V', D: 'H', H: 'D', V: 'B', N: 'N' };

/** Spaces, line breaks and digits are formatting. Other removals require explicit review. */
export function sanitizeSequence(raw: string, alphabet: SequenceAlphabet): SanitizedSequence {
  if (raw.length > 40_000) throw new Error('Sequence input exceeds 40,000 characters.');
  const result: SanitizedSequence = { bases: '', alphabet, removed: [], formattingRemoved: 0 };
  [...raw].forEach((character, index) => {
    const base = character.toUpperCase();
    if (/[\s\d]/u.test(character)) result.formattingRemoved++;
    else if (ambiguity[base] && base !== (alphabet === 'DNA' ? 'U' : 'T')) result.bases += base;
    else result.removed.push({ character, position: index + 1 });
  });
  if (!result.bases.length) throw new Error('Enter at least one IUPAC nucleotide.');
  if (result.bases.length > 20_000) throw new Error('Sequence exceeds 20,000 nucleotides.');
  return result;
}

export function complementSequence(sequence: SanitizedSequence, reverse = false): string {
  const chars = [...sequence.bases].map(base => complements[base]);
  return (reverse ? chars.reverse() : chars).join('').replaceAll('T', sequence.alphabet === 'RNA' ? 'U' : 'T');
}

export function translateSequence(sequence: SanitizedSequence, options: SequenceOptions): string {
  const code = geneticCodes.find(table => table.id === options.code);
  if (!code || ![0, 1, 2].includes(options.frame)) throw new Error('Unsupported genetic code or reading frame.');
  const bases = (options.reverse ? complementSequence(sequence, true) : sequence.bases).replaceAll('U', 'T');
  let protein = '';
  for (let i = options.frame; i + 2 < bases.length; i += 3) {
    const possible = new Set<string>();
    for (const a of ambiguity[bases[i]]) for (const b of ambiguity[bases[i + 1]]) for (const c of ambiguity[bases[i + 2]]) {
      possible.add(code.aminoAcids['TCAG'.indexOf(a) * 16 + 'TCAG'.indexOf(b) * 4 + 'TCAG'.indexOf(c)]);
    }
    protein += possible.size === 1 ? [...possible][0] : 'X';
  }
  return protein;
}

/** Standard ATG→first TAA/TAG/TGA, both strands, at most one revolution.
 * Original-strand coordinates are 0-based, half-open; reverse ORFs start at the low boundary.
 * Incomplete ORFs and ambiguous start/stop codons are omitted. Nested starts are retained.
 */
export function findSequenceOrfs(sequence: SanitizedSequence, circular: boolean): OpenReadingFrame[] {
  const length = sequence.bases.length, results: OpenReadingFrame[] = [];
  for (const strand of ['+', '-'] as const) {
    const source = (strand === '+' ? sequence.bases : complementSequence(sequence, true)).replaceAll('U', 'T');
    const scan = circular ? source + source : source;
    for (let frame = 0; frame < 3; frame++) {
      let stop: number | null = null;
      for (let i = scan.length - 3 - ((scan.length - 3 - frame) % 3 + 3) % 3; i >= frame; i -= 3) {
        const codon = scan.slice(i, i + 3);
        if (['TAA', 'TAG', 'TGA'].includes(codon)) stop = i;
        if (codon !== 'ATG' || i >= length || stop === null || stop + 3 - i > length) continue;
        const end = stop + 3, start = strand === '+' ? i : (length - end % length) % length;
        results.push({ strand, start, end: strand === '+' ? (end > length ? end % length : end) : length - i,
          length: end - i, wraps: end > length, frame });
      }
    }
  }
  return results.sort((a, b) => a.start - b.start || a.strand.localeCompare(b.strand) || a.length - b.length);
}

export function analyzeSequence(raw: string, options: SequenceOptions) {
  const sequence = sanitizeSequence(raw, options.alphabet);
  let expectedGc = 0, certainGc = 0, possibleGc = 0;
  for (const base of sequence.bases) {
    const choices = ambiguity[base], count = [...choices].filter(b => b === 'G' || b === 'C').length;
    expectedGc += count / choices.length; certainGc += Number(count === choices.length); possibleGc += Number(count > 0);
  }
  const concrete = sequence.alphabet === 'DNA' && /^[ACGT]+$/.test(sequence.bases);
  const mass: Record<string, number> = { A: 313.21, C: 289.18, G: 329.21, T: 304.2 };
  const single: Record<string, number> = { A: 15400, C: 7400, G: 11500, T: 8700 };
  const pairs: Record<string, number> = { AA: 27400, AC: 21200, AG: 25000, AT: 22800, CA: 21200, CC: 14600, CG: 18000, CT: 15200, GA: 25200, GC: 17600, GG: 21600, GT: 20000, TA: 23400, TC: 16200, TG: 19000, TT: 16800 };
  let extinction = sequence.bases.length === 1 ? single[sequence.bases] : 0;
  if (concrete) for (let i = 0; i < sequence.bases.length - 1; i++) {
    extinction += pairs[sequence.bases.slice(i, i + 2)];
    if (i > 0) extinction -= single[sequence.bases[i]];
  }
  return { method: 'pero-sequence/1', input: raw, options, sequence,
    length: sequence.bases.length, complement: complementSequence(sequence), reverseComplement: complementSequence(sequence, true),
    translation: translateSequence(sequence, options), orfs: findSequenceOrfs(sequence, options.circular),
    gcPercent: 100 * expectedGc / sequence.bases.length,
    gcRangePercent: [100 * certainGc / sequence.bases.length, 100 * possibleGc / sequence.bases.length],
    molecularWeight: concrete ? [...sequence.bases].reduce((sum, b) => sum + mass[b], -61.96) : null,
    extinctionCoefficient: concrete ? extinction : null,
    limits: 'GC assumes equal probability for each ambiguous base. Translation resolves unanimous ambiguous codons; X otherwise, * stop. Partial codons are omitted. Code tables 27/28/31 have context-dependent stops, translated as amino acids. ORFs use standard ATG/TAA/TAG/TGA independently of translation code. DNA mass: unmodified ssDNA, 5′/3′ OH, average residue mass minus 61.96 g/mol; A260: nearest-neighbor estimate. Neither is available for RNA/ambiguous input. Calculations are not measured or owner-verified results.' };
}
