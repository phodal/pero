import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mcpAppHeight, mcpAppSizePolicy} from './size.ts';

test('container height policy bounds View content without forcing Inspector dimensions', () => {
  for (const {policy, requested, height} of [
    {policy: {initialHeight: 180, minHeight: 80, maxHeight: 320}, requested: 40, height: 80},
    {policy: {initialHeight: 180, minHeight: 80, maxHeight: 320}, requested: 200, height: 200},
    {policy: {initialHeight: 180, minHeight: 80, maxHeight: 320}, requested: 900, height: 320},
    {policy: {initialHeight: 640, minHeight: 320, maxHeight: 1200}, requested: 900, height: 900},
  ]) assert.equal(mcpAppHeight(mcpAppSizePolicy(policy), requested), height);
  for (const policy of [
    {initialHeight: 180, minHeight: 320, maxHeight: 80},
    {initialHeight: 400, minHeight: 80, maxHeight: 320},
    {initialHeight: 180, minHeight: -1, maxHeight: 320},
    {initialHeight: Infinity, minHeight: 80, maxHeight: 320},
  ]) assert.throws(() => mcpAppSizePolicy(policy));
});
