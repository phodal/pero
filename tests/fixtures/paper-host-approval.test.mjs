import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalAction, approvalTarget, approvalTitle } from './paper-host-approval.mjs';
const target = { runtime_id: 'runtime', target_id: 'owned-window' };
const fixture = () => ({ id: 'observation', target, truncated: false, elements: [
  { id: 'frame', role: 'frame', label: approvalTitle, depth: 0 },
  { id: 'document', role: 'document web', label: approvalTitle, depth: 1 },
  { id: 'dialog', role: 'dialog', label: approvalTitle, depth: 2 },
  { id: 'summary', role: 'static', label: 'authored-nonce', depth: 3 },
  { id: 'cancel', role: 'button', label: 'Cancel', depth: 3, actions: ['click'] },
  { id: 'allow', role: 'button', label: 'Run once', depth: 3, actions: ['click'] },
] });
test('new Host window requires exact unique native target', () => {
  const entry = { kind: 'window', title: approvalTitle, reference: target };
  assert.deepEqual(approvalTarget([entry]), target);
  assert.throws(() => approvalTarget([]));
  assert.throws(() => approvalTarget([entry, entry]));
});
test('canonical Linux button without optional state still requires complete tree and exact native click capability', () => {
  for (const label of ['Cancel', 'Run once']) {
    const action = approvalAction(fixture(), target, 'authored-nonce', label, `request-${label}`);
    assert.equal(action.delivery, 'background');
    assert.equal(action.input.anchor.kind, 'element');
    assert.equal(action.observation_id, 'observation');
  }
  for (const change of [
    o => { o.truncated = true; },
    o => { o.target = { ...target, target_id: 'foreign' }; },
    o => { o.elements[0].role = 'dialog'; },
    o => { o.elements[2].label = 'foreign dialog'; },
    o => { o.elements[3].label = 'wrong nonce'; },
    o => { o.elements[3].depth = 2; },
    o => { o.elements[5].role = 'push button'; },
    o => { o.elements[5].role = 'link'; },
    o => { o.elements[5].depth = 2; },
    o => { o.elements[5].state = { enabled: false, secure: false }; },
    o => { o.elements[5].state = { enabled: true, secure: true }; },
    o => { o.elements[5].actions = []; },
    o => { o.elements.push({ ...o.elements[5], id: 'duplicate' }); },
  ]) {
    const observation = fixture(); change(observation);
    assert.throws(() => approvalAction(observation, target, 'authored-nonce', 'Run once', 'request'));
  }
});
