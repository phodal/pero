import assert from 'node:assert/strict';
import test from 'node:test';
import { exampleProtocol, stateDelta, bytesToBase64 } from '../ui-src/presentation.ts';
import type { LabState } from '../ui-src/types.ts';

test('example and linked revision keep final volume and distinct tips', () => {
  for (const volume of [50, 40]) {
    const protocol = exampleProtocol(volume, 0);
    assert.equal(protocol.steps.filter(step => step.op === 'dispense').reduce((sum, step) => sum + (step.volume_ul ?? 0), 0), 100);
    assert.deepEqual(protocol.steps.filter(step => step.op === 'pickup_tip').map(step => step.resource), ['T1', 'T2']);
  }
});
test('saved timeline describes changes and absent after-state without inventing progress', () => {
  const before: LabState = { wells: [{ id: 'B1', volume_ul: 0, red_fraction: 0, capacity_ul: 300 }], pipette: { tip_id: 'T1', volume_ul: 50, red_fraction: 1, capacity_ul: 300 }, available_tips: [], consumed_tips: ['T1'], revision: 0 };
  const after = { ...before, wells: [{ ...before.wells[0], volume_ul: 50 }], pipette: { ...before.pipette, volume_ul: 0 }, revision: 1 };
  assert.equal(stateDelta(before, after), 'B1: 0 → 50 µL; Pipette: 50 → 0 µL');
  assert.equal(stateDelta(before, null), 'No committed after-state');
});
test('import transport preserves every original byte including BOM and CRLF', () => {
  const bytes = new Uint8Array([239, 187, 191, 66, 49, 44, 48, 46, 53, 13, 10]);
  assert.deepEqual(new Uint8Array(Buffer.from(bytesToBase64(bytes), 'base64')), bytes);
});
