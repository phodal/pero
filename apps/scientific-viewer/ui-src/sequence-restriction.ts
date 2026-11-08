import { complement, type BaseSpan, type SequenceRecord } from './sequence-record.ts';

type RestrictionEnzyme = readonly [name: string, motif: string, top: number, bottom: number];
export type RestrictionSite = Readonly<{
  name: string;
  top: number;
  bottom: number;
  strand: 1 | -1;
  spans: readonly BaseSpan[];
}>;

// Offsets count bonds from the first base of the recognition sequence as written.
// Source: NEB Recognition Specificities and pBR322 restriction map.
const enzymes: readonly RestrictionEnzyme[] = [
  ['AatII', 'GACGTC', 5, 1],
  ['AccI', 'GTMKAC', 2, 4],
  ['AseI', 'ATTAAT', 2, 4],
  ['BamHI', 'GGATCC', 1, 5],
  ['BanII', 'GRGCYC', 5, 1],
  ['BmtI', 'GCTAGC', 5, 1],
  ['BsaBI', 'GATNNNNATC', 5, 5],
  ['BsaI', 'GGTCTC', 7, 11],
  ['BsmBI', 'CGTCTC', 7, 11],
  ['BspDI', 'ATCGAT', 2, 4],
  ['BtgI', 'CCRYGG', 1, 5],
  ['ClaI', 'ATCGAT', 2, 4],
  ['EagI', 'CGGCCG', 1, 5],
  ['EcoNI', 'CCTNNNNNAGG', 5, 6],
  ['EcoRI', 'GAATTC', 1, 5],
  ['EcoRV', 'GATATC', 3, 3],
  ['FspAI', 'RTGCGCAY', 4, 4],
  ['HindIII', 'AAGCTT', 1, 5],
  ['NheI', 'GCTAGC', 1, 5],
  ['NruI', 'TCGCGA', 3, 3],
  ['PciI', 'ACATGT', 1, 5],
  ['PstI', 'CTGCAG', 5, 1],
  ['PvuI', 'CGATCG', 4, 2],
  ['PvuII', 'CAGCTG', 3, 3],
  ['SalI', 'GTCGAC', 1, 5],
  ['ScaI', 'AGTACT', 3, 3],
  ['SgrAI', 'CRCCGGYG', 2, 6],
  ['SphI', 'GCATGC', 5, 1],
  ['SspI', 'AATATT', 3, 3],
  ['XmnI', 'GAANNNNTTC', 5, 5],
];

const ambiguity: Record<string, string> = { R: '[AG]', Y: '[CT]', M: '[AC]', K: '[GT]', N: '[ACGT]' };
const patterns = enzymes.flatMap(([name, motif, top, bottom]) => {
  const reverse = [...complement(motif)].reverse().join('');
  const size = motif.length;
  const pattern = (value: string) => new RegExp(`(?=${[...value].map(base => ambiguity[base] ?? base).join('')})`, 'g');
  const forward = { name, size, pattern: pattern(motif), top, bottom, strand: 1 as const };
  return motif === reverse ? [forward] : [
    forward, { name, size, pattern: pattern(reverse), top: size - bottom, bottom: size - top, strand: -1 as const },
  ];
});

/** Predict sites from concrete bases and keep both strand cuts as inter-base coordinates. */
export function restrictionSites({ bases, circular }: Pick<SequenceRecord, 'bases' | 'circular'>): RestrictionSite[] {
  const length = bases.length;
  const sequence = circular ? bases + bases.slice(0, Math.max(...patterns.map(entry => entry.size)) - 1) : bases;
  const normalize = (position: number) => ((position % length) + length) % length;
  const sites: RestrictionSite[] = [];
  for (const entry of patterns) {
    if (entry.size > length) continue;
    for (const match of sequence.matchAll(entry.pattern)) {
      const start = match.index;
      if (start >= length) break;
      const end = start + entry.size;
      const top = start + entry.top;
      const bottom = start + entry.bottom;
      if (!circular && (top <= 0 || top >= length || bottom <= 0 || bottom >= length)) continue;
      sites.push({
        name: entry.name, strand: entry.strand,
        top: circular ? normalize(top) : top, bottom: circular ? normalize(bottom) : bottom,
        spans: end <= length ? [{ start, end }] : [{ start, end: length }, { start: 0, end: end - length }],
      });
    }
  }
  return sites.sort((a, b) => a.top - b.top || a.name.localeCompare(b.name));
}

export function cutBoundary(cut: number, length: number): string {
  return cut === 0 ? `${length}|1` : `${cut}|${cut + 1}`;
}
