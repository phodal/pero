import assert from 'node:assert/strict';

export const approvalTitle = 'Paper reproduction';

export function approvalTarget(targets) {
  const matches = targets.filter(target => target.kind === 'window' && target.title === approvalTitle);
  assert.equal(matches.length, 1, 'Expected exactly one Host-owned Paper approval window');
  return matches[0].reference;
}

// New Host-owned BrowserWindow contract, not a relaxation of the old GTK test.
// Production native driver still owns exact PID and ±2 geometry matching.
export function approvalAction(observation, target, nonce, label, requestId) {
  assert.ok(['Cancel', 'Run once'].includes(label));
  assert.deepEqual(observation.target, target);
  assert.equal(observation.truncated, false, 'Complete native semantic tree required');
  const roots = observation.elements.filter(element => element.depth === 0 &&
    element.role === 'frame' && element.label === approvalTitle);
  assert.equal(roots.length, 1, 'One named native BrowserWindow frame required');
  const dialogs = observation.elements.filter(element => element.depth > 0 &&
    element.role === 'dialog' && element.label === approvalTitle);
  assert.equal(dialogs.length, 1, 'One named trusted HTML dialog region required');
  const start = observation.elements.indexOf(dialogs[0]);
  const after = observation.elements.slice(start + 1);
  const boundary = after.findIndex(element => element.depth <= dialogs[0].depth);
  const contents = boundary < 0 ? after : after.slice(0, boundary);
  assert.ok(typeof nonce === 'string' && nonce.length > 0 &&
    contents.some(element => element.label.includes(nonce)), 'Authored nonce must occur within the dialog');
  const buttons = contents.filter(element => element.role === 'push button' && element.label === label);
  assert.equal(buttons.length, 1, 'One exact semantic button in the trusted dialog required');
  const button = buttons[0];
  assert.equal(button.state?.enabled, true);
  assert.equal(button.state?.secure, false);
  assert.ok(button.actions.includes('click'));
  return { request_id: requestId, target, observation_id: observation.id,
    delivery: 'background', input: { kind: 'click', anchor: { kind: 'element', element_id: button.id }, button: 'left', count: 1 } };
}
