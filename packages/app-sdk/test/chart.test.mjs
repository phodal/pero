import test from 'node:test';
import assert from 'node:assert/strict';
import { alignLane, countRuns } from '../src/chart/lanes.mjs';
import { dashArray, seriesStyle } from '../src/chart/palette.mjs';

test('lane breaks stay gaps, retain sample identity and sort observations', () => {
  for (const points of [ [[20, 2, 2], null, [40, 4, 4]], [[20, 2, 2], null, null, [40, 4, 4]] ]) {
    const lane = alignLane(points);
    assert.deepEqual(lane, { xs: [20, 30, 40], ys: [2, null, 4], ids: [2, null, 4] });
    assert.equal(countRuns(lane.ys), 2);
  }
  assert.deepEqual(alignLane([[20, null], [10, 1, 1]]), { xs: [10, 20], ys: [1, null], ids: [1, null] });
});

test('series cycle in both directions with distinct line patterns', () => {
  for (const dark of [false, true]) {
    assert.deepEqual(seriesStyle(-1, dark), seriesStyle(5, dark));
    assert.deepEqual(seriesStyle(6, dark), seriesStyle(0, dark));
    assert.equal(new Set(Array.from({ length: 6 }, (_, i) => seriesStyle(i, dark).dash)).size, 6);
  }
  assert.equal(dashArray('0'), undefined);
  assert.deepEqual(dashArray('11 4 2 4'), [11, 4, 2, 4]);
});
