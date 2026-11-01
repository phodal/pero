import assert from 'node:assert/strict';

export const approvalTitle = 'Paper reproduction';

// The native driver owns PID/window/geometry binding. No coordinates, key guesses,
// or synthetic dialog answers are permitted when accessibility is unavailable.
export function approvalTarget(targets) {
  const matches = targets.filter(target => target.kind === 'window' && target.title === approvalTitle);
  assert.equal(matches.length, 1, 'Expected one native Paper reproduction dialog');
  return matches[0].reference;
}

export function approvalAction(observation, target, nonce) {
  assert.deepEqual(observation.target, target, 'Observation must belong to selected native target');
  assert.equal(observation.truncated, false, 'Native dialog tree must be complete');
  const roots = observation.elements.filter(element => element.depth === 0 &&
    ['dialog', 'alert'].includes(element.role) && element.label === approvalTitle);
  assert.equal(roots.length, 1, 'Expected actual named native dialog/alert role');
  assert.ok(typeof nonce === 'string' && nonce.length > 0 &&
    observation.elements.some(element => element.label.includes(nonce)), 'Expected authored fixture nonce in native dialog');
  const buttons = observation.elements.filter(element => element.role === 'push button' && element.label === 'Run once');
  assert.equal(buttons.length, 1, 'Expected one observed Run once button');
  const button = buttons[0];
  assert.equal(button.state?.enabled, true, 'Run once must be enabled');
  assert.equal(button.state?.secure, false, 'Run once must not be secure');
  assert.ok(button.actions.includes('click'), 'Run once must expose a native invoking action');
  return { request_id: 'paper-native-allow', target, observation_id: observation.id,
    delivery: 'background', input: { kind: 'click', anchor: { kind: 'element', element_id: button.id }, button: 'left', count: 1 } };
}

export function approvalEvidence(observation) {
  return { id: observation.id, target: observation.target, truncated: observation.truncated,
    screenshot: observation.screenshot,
    elements: observation.elements.map(({ id, role, label, depth, actions, state }) =>
      ({ id, role, label, depth, actions, state })) };
}
