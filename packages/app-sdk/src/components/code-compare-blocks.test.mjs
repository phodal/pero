import test from 'node:test';
import assert from 'node:assert/strict';
import {mappedCompareLine, mappedCompareBlock} from './code-compare-blocks.mjs';

test('source correspondence stays within explicit blocks and preserves unmapped gaps', () => {
  const outer = {left: {startLine: 10, endLine: 20}, right: {startLine: 100, endLine: 120}};
  const inner = {left: {startLine: 12, endLine: 14}, right: {startLine: 105, endLine: 107}};
  for (const {blocks, side, line, expected, block} of [
    {blocks: [outer], side: 'left', line: 10, expected: 100, block: outer},
    {blocks: [outer], side: 'left', line: 15, expected: 110, block: outer},
    {blocks: [outer], side: 'right', line: 120, expected: 20, block: outer},
    {blocks: [outer, inner], side: 'left', line: 13, expected: 106, block: inner},
    {blocks: [outer], side: 'left', line: 21, expected: null, block: null},
    {blocks: [], side: 'left', line: 10, expected: null, block: null},
  ]) {
    assert.equal(mappedCompareLine(blocks, side, line), expected);
    assert.equal(mappedCompareBlock(blocks, side, line), block);
  }
});
