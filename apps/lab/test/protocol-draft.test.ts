import assert from 'node:assert/strict';
import test from 'node:test';
import { describeStep, editProtocolStep, readStepEditor } from '../ui-src/protocol-draft.ts';

test('step editing preserves protocol metadata, unknown fields and untouched operations', () => {
  const source = {
    version: 1, initial_revision: 7, metadata: { source: 'imported' },
    steps: [
      { op: 'aspirate', resource: 'A1', volume_ul: 50, extension: { keep: true } },
      { op: 'future_operation', resource: 'B1', future_parameter: 3 },
    ],
  };
  const parsed = readStepEditor(JSON.stringify(source));
  assert.equal(parsed.kind, 'steps');
  if (parsed.kind !== 'steps') return;
  const edited = JSON.parse(editProtocolStep(parsed.document, 0, 'volume_ul', '40'));
  assert.deepEqual(edited, { ...source, steps: [{ ...source.steps[0], volume_ul: 40 }, source.steps[1]] });
  assert.equal(describeStep(edited.steps[0]), 'Aspirate 40 µL from A1');
  assert.equal(describeStep(edited.steps[1]), 'future_operation B1');
});

test('unrepresentable JSON stays in JSON editing instead of becoming a different protocol', () => {
  for (const source of ['{ invalid', 'null', '[]', '{"steps":{}}', '{"steps":[null]}', '{"steps":[{"op":"aspirate","resource":"A1","volume_ul":"50"}]}']) {
    assert.equal(readStepEditor(source).kind, 'json', source);
  }
  // Domain version, resource and quantity rules are checked by the backend.
  assert.equal(readStepEditor('{"version":99,"steps":[{"op":"aspirate","resource":"unknown","volume_ul":-5}]}').kind, 'steps');
});

test('changing an operation only replaces its editable parameters and never coerces invalid numbers to null', () => {
  const document = { version: 1, steps: [{ op: 'aspirate', resource: 'A1', volume_ul: 40, note: 'retained' }] };
  assert.deepEqual(JSON.parse(editProtocolStep(document, 0, 'op', 'pickup_tip')).steps[0], { op: 'pickup_tip', resource: 'A1', note: 'retained' });
  assert.deepEqual(JSON.parse(editProtocolStep(document, 0, 'volume_ul', '')).steps[0], { op: 'aspirate', resource: 'A1', note: 'retained' });
  assert.throws(() => editProtocolStep(document, 0, 'volume_ul', 'not a number'), /Volume must be a number/);
});
