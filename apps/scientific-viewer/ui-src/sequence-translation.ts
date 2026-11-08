import type { BaseSpan, SequenceFeature } from './sequence-record';

export type AnnotatedResidue = Readonly<{
  amino: string;
  index: number;
  anchor: number;
  spans: readonly BaseSpan[];
}>;

/** Project the deposited protein onto its CDS in biological order. */
export function annotatedResidues(feature: SequenceFeature): AnnotatedResidue[] {
  const translation = feature.translation;
  if (!translation) return [];
  const reverse = feature.strand === -1;
  const spans = reverse ? [...feature.spans].reverse() : feature.spans;
  let spanIndex = 0;
  let offset = translation.offset;
  return Array.from(translation.residues, (amino, index) => {
    const positions: number[] = [];
    for (let base = 0; base < 3; base++) {
      while (offset >= spans[spanIndex].end - spans[spanIndex].start) {
        offset -= spans[spanIndex].end - spans[spanIndex].start;
        spanIndex++;
      }
      const span = spans[spanIndex];
      positions.push(reverse ? span.end - offset - 1 : span.start + offset);
      offset++;
    }
    const pieces: { start: number; end: number }[] = [];
    for (const position of [...positions].sort((a, b) => a - b)) {
      const previous = pieces.at(-1);
      if (previous?.end === position) previous.end++;
      else pieces.push({ start: position, end: position + 1 });
    }
    return { amino, index: index + 1, anchor: positions[1], spans: pieces };
  });
}
