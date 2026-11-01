import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalTarget, approvalAction, approvalEvidence } from './paper-native-approval.mjs';

const target = { runtime_id: 'fixture-runtime', target_id: 'fixture-target' };
const nonce = 'authored-test-nonce';
function observation() {
  return { id: 'observed', target, truncated: false, elements: [
    { id: 'dialog', depth: 0, role: 'dialog', label: 'Paper reproduction', actions: [] },
    { id: 'summary', depth: 1, role: 'label', label: `Synthetic only ${nonce}`, actions: [] },
    { id: 'allow', depth: 1, role: 'push button', label: 'Run once', actions: ['click'], state: { enabled: true, secure: false } },
  ] };
}

test('native target selection rejects absence and duplicate titled windows', () => {
  const window = { kind: 'window', title: 'Paper reproduction', reference: target };
  assert.deepEqual(approvalTarget([window]), target);
  for (const targets of [[], [window, window], [{ ...window, kind: 'desktop' }], [{ ...window, title: 'Other app' }]])
    assert.throws(() => approvalTarget(targets), /Expected one native/);
});

test('only an observed enabled invoking button in the authored native dialog yields an element action', () => {
  for (const role of ['dialog', 'alert']) {
    const value = observation(); value.elements[0].role = role;
    assert.deepEqual(approvalAction(value, target, nonce), { request_id: 'paper-native-allow', target,
      observation_id: 'observed', delivery: 'background', input: { kind: 'click',
        anchor: { kind: 'element', element_id: 'allow' }, button: 'left', count: 1 } });
  }
  const changes = [
    value => { value.target = { ...target, target_id: 'other' }; },
    value => { value.truncated = true; },
    value => { value.elements[0].role = 'frame'; },
    value => { value.elements[0].label = 'Unrelated'; },
    value => { value.elements[0].depth = 1; },
    value => { value.elements[1].label = 'Other fixture'; },
    value => { value.elements[2].role = 'label'; },
    value => { value.elements[2].label = 'Cancel'; },
    value => { value.elements[2].state.enabled = false; },
    value => { value.elements[2].state.secure = true; },
    value => { delete value.elements[2].state; },
    value => { value.elements[2].actions = []; },
    value => { value.elements.push({ ...value.elements[2], id: 'duplicate' }); },
  ];
  for (const change of changes) {
    const value = observation(); change(value);
    assert.throws(() => approvalAction(value, target, nonce));
  }
  assert.throws(() => approvalAction(observation(), target, ''));
});

test('evidence projection omits native values and arbitrary payloads', () => {
  const value = observation();
  value.private = 'must-not-export'; value.elements[2].value = 'must-not-export';
  value.elements[2].unexpected = 'must-not-export';
  assert.ok(!JSON.stringify(approvalEvidence(value)).includes('must-not-export'));
  assert.equal(approvalEvidence(value).elements[2].label, 'Run once');
});
