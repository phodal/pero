type Side = 'left' | 'right';
type Block = {left: {startLine: number; endLine: number}; right: {startLine: number; endLine: number}};
export function mappedCompareBlock(blocks: Block[], side: Side, line: number): Block | null;
export function mappedCompareLine(blocks: Block[], side: Side, line: number): number | null;
