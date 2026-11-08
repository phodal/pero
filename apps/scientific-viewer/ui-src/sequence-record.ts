/** GenBank coordinates are normalized once to zero-based, half-open spans. */
export type BaseSpan = Readonly<{ start: number; end: number }>;
export type SequenceFeature = Readonly<{
  id: number;
  label: string;
  kind: string;
  strand: 1 | -1;
  spans: readonly BaseSpan[];
}>;
export type SequenceRecord = Readonly<{
  name: string;
  accession: string;
  bases: string;
  circular: boolean;
  features: readonly SequenceFeature[];
  skipped: number;
}>;

const complements: Record<string, string> = {
  A: 'T', C: 'G', G: 'C', T: 'A', R: 'Y', Y: 'R', S: 'S', W: 'W',
  K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N',
};
export function complement(bases: string): string {
  return Array.from(bases, base => complements[base]).join('');
}

function featureLocation(raw: string, length: number) {
  const location = raw.replace(/\s/g, '');
  const reverse = /^complement\((.*)\)$/.exec(location);
  const forward = reverse?.[1] ?? location;
  const joined = /^join\((.*)\)$/.exec(forward);
  const spans: BaseSpan[] = [];
  for (const part of joined ? joined[1].split(',') : [forward]) {
    const range = /^(\d+)(?:\.\.(\d+))?$/.exec(part);
    if (!range) return null;
    const start = Number(range[1]) - 1;
    const end = Number(range[2] ?? range[1]);
    if (start < 0 || end <= start || end > length) return null;
    spans.push({ start, end });
  }
  return { spans, strand: reverse ? -1 as const : 1 as const };
}

export function parseGenBank(text: string): SequenceRecord {
  const lines = text.trimEnd().split(/\r?\n/);
  const locus = /^LOCUS\s+(\S+)\s+(\d+)\s+bp\b(.*)$/i.exec(lines[0]);
  const origin = lines.findIndex(line => /^ORIGIN\s*$/.test(line));
  const end = lines.findIndex(line => line.trim() === '//');
  if (!locus || !/\bDNA\b/i.test(locus[3]) || origin < 0 || end <= origin || end !== lines.length - 1) {
    throw new Error('Expected one complete GenBank DNA record.');
  }
  const bases = lines.slice(origin + 1, end).join('').replace(/[0-9\s]/g, '').toUpperCase();
  if (!bases || bases.length !== Number(locus[2]) || !/^[ACGTRYSWKMBDHVN]+$/.test(bases)) {
    throw new Error('GenBank sequence contains invalid bases or does not match the LOCUS length.');
  }

  const features: SequenceFeature[] = [];
  let skipped = 0;
  const table = lines.findIndex(line => /^FEATURES\s+Location\/Qualifiers/.test(line));
  if (table >= 0 && table < origin) {
    const entries = lines.slice(table + 1, origin).join('\n').split(/\n(?= {5}\S)/);
    for (const entry of entries) {
      const feature = /^ {5}(\S+)\s+([^/]*)([\s\S]*)$/.exec(entry);
      if (!feature || feature[1] === 'source') continue;
      const [, kind, rawLocation, rawQualifiers] = feature;
      const location = featureLocation(rawLocation, bases.length);
      if (!location) { skipped++; continue; }
      const qualifiers = new Map<string, string>();
      for (const match of rawQualifiers.matchAll(/\/(label|gene|product|regulatory_class|note)=(?:"([^"]+)"|([^\r\n]+))/g)) {
        const value = (match[2] ?? match[3]).replace(/\s+/g, ' ').trim();
        if (value && !qualifiers.has(match[1])) qualifiers.set(match[1], value);
      }
      const label = qualifiers.get('label') ?? qualifiers.get('gene') ?? qualifiers.get('product')
        ?? qualifiers.get('regulatory_class') ?? qualifiers.get('note') ?? kind;
      features.push({ id: features.length, label, kind, ...location });
    }
  }
  return {
    name: locus[1], accession: /^VERSION\s+(\S+)/m.exec(text)?.[1] ?? '',
    circular: /\bcircular\b/i.test(locus[3]), bases, features, skipped,
  };
}
