// Upstream attribution and license: packages/app-sdk/NOTICE.md.
/** Absolute inclusive line ranges. Never infer a correspondence through an unmapped gap. */
export function mappedCompareBlock(blocks, side, line) {
  return blocks.filter(block => line >= block[side].startLine && line <= block[side].endLine)
    .sort((a,b) => (a[side].endLine-a[side].startLine)-(b[side].endLine-b[side].startLine))[0] ?? null;
}

export function mappedCompareLine(blocks, side, line) {
  const target = side === 'left' ? 'right' : 'left';
  const block = mappedCompareBlock(blocks, side, line);
  if (!block) return null;
  const from=block[side],to=block[target];
  const fraction=(line-from.startLine)/Math.max(1,from.endLine-from.startLine);
  return to.startLine+Math.round(fraction*(to.endLine-to.startLine));
}
