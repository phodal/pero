import test from 'node:test';
import assert from 'node:assert/strict';
import { initialConnectorDetail, updateConnectorDetail } from '../ui-src/connector-detail-model.mjs';

const definition = { transport: 'stdio', command: '/original', sha256: 'a'.repeat(64), tools: [] };
const open = (state = initialConnectorDetail(), providerId = 'matlab') => updateConnectorDetail(state, {
  type: 'opened', initial: { detailProviderId: providerId, connectorIdField: providerId,
    definitionText: JSON.stringify(definition), baseline: JSON.stringify(definition) }, discover: true,
});
const success = effect => ({ type: 'request.completed', effect, reply: { ok: true,
  definition: { ...definition, command: '/discovered' }, found: { command: [], matlabRoot: [], extensionFile: [] } } });

test('switching providers or closing invalidates late discovery and install results', () => {
  const first = open();
  const second = open(first.state, 'simulink');
  assert.deepEqual(updateConnectorDetail(second.state, success(first.effects[0])), { state: second.state, effects: [] });
  const preparing = updateConnectorDetail(second.state, { type: 'install.requested' });
  const closed = updateConnectorDetail(preparing.state, { type: 'close.requested', busy: false });
  const late = updateConnectorDetail(closed.state, { type: 'request.completed', effect: preparing.effects[0], reply: { ok: true, command: 'never-run' } });
  assert.deepEqual(late, { state: closed.state, effects: [] });
  assert.equal(closed.state.definitionText, '');
});

test('discovery can complete without replacing a draft edited while it was running', () => {
  const first = open();
  const draft = JSON.stringify({ ...definition, command: '/typed-by-user' });
  const edited = updateConnectorDetail(first.state, { type: 'field.changed', field: 'definitionText', value: draft });
  const completed = updateConnectorDetail(edited.state, success(first.effects[0]));
  assert.equal(completed.state.definitionText, draft);
  assert.equal(completed.state.baseline, first.state.baseline);
  assert.equal(completed.state.discovery.state, 'done');
  // An explicit retry may adopt the newly discovered configuration.
  const retry = updateConnectorDetail(completed.state, { type: 'discovery.requested' });
  assert.equal(JSON.parse(updateConnectorDetail(retry.state, success(retry.effects[0])).state.definitionText).command, '/discovered');
});

test('a superseded discovery cannot win by returning last', () => {
  const first = open();
  const retry = updateConnectorDetail(first.state, { type: 'discovery.requested' });
  const completed = updateConnectorDetail(retry.state, success(retry.effects[0]));
  assert.deepEqual(updateConnectorDetail(completed.state, success(first.effects[0])), { state: completed.state, effects: [] });
});

test('busy close is refused; changing the draft rearms the two-step discard guard', () => {
  const initial = open().state;
  const dirty = updateConnectorDetail(initial, { type: 'field.changed', field: 'definitionText', value: '{}' }).state;
  const busy = updateConnectorDetail(dirty, { type: 'close.requested', busy: true, force: true });
  assert.equal(busy.state, dirty);
  assert.equal(busy.effects[0].key, 'busy');
  const armed = updateConnectorDetail(dirty, { type: 'close.requested', busy: false });
  assert.equal(armed.state.phase, 'editing');
  const edited = updateConnectorDetail(armed.state, { type: 'field.changed', field: 'connectorIdField', value: 'new-id' });
  assert.equal(edited.state.discardArmed, false);
  const again = updateConnectorDetail(edited.state, { type: 'close.requested', busy: false });
  assert.equal(again.state.phase, 'editing');
  assert.equal(updateConnectorDetail(again.state, { type: 'close.requested', busy: false }).state.phase, 'closed');
});

test('save receipts are bound to the editor generation and preserve newer edits', () => {
  const first = open().state;
  const edited = updateConnectorDetail(first, { type: 'field.changed', field: 'definitionText', value: '{}' }).state;
  const saved = updateConnectorDetail(edited, { type: 'saved', generation: first.generation, connectorId: 'saved-id', text: first.definitionText });
  assert.equal(saved.state.definitionText, '{}');
  assert.equal(saved.state.baseline, first.definitionText);
  const switched = open(saved.state, 'simulink').state;
  assert.equal(updateConnectorDetail(switched, { type: 'saved', generation: first.generation, connectorId: 'saved-id', text: '{}' }).state, switched);
});

test('background install polls without replay, rediscovers on success, and stops with the dialog', () => {
  const preparing = updateConnectorDetail(open().state, { type: 'install.requested' });
  assert.deepEqual(preparing.effects.map(effect => effect.operation), ['install.run']);
  const failed = updateConnectorDetail(preparing.state, { type: 'request.completed', effect: preparing.effects[0], reply: { ok: false }, error: 'native error' });
  assert.equal(failed.state.discovery.installError, 'native error');
  assert.deepEqual(failed.effects, []);
  const started = updateConnectorDetail(preparing.state, { type: 'request.completed', effect: preparing.effects[0], reply: { ok: true, job: { state: 'running', log: '', exitCode: null } } });
  assert.deepEqual(started.effects.map(effect => effect.kind), ['poll']);
  assert.deepEqual(updateConnectorDetail(started.state, { type: 'request.completed', effect: preparing.effects[0], reply: { ok: true, job: { state: 'running' } } }).effects, [], 'duplicate completion must not poll twice');
  const progress = updateConnectorDetail(started.state, { type: 'install.progress', generation: started.state.generation, job: { state: 'running', log: 'x', exitCode: null } });
  assert.equal(progress.state.discovery.install.log, 'x');
  const done = updateConnectorDetail(progress.state, { type: 'install.progress', generation: started.state.generation, job: { state: 'done', log: 'x', exitCode: 0 } });
  assert.deepEqual(done.effects.map(effect => effect.operation), ['discover']);
  // The same "Install" click continues to adding the connection once discovery finds the server.
  const found = updateConnectorDetail(done.state, success(done.effects[0]));
  assert.equal(found.state.discovery.continueAfterInstall, true);
  const retried = updateConnectorDetail(found.state, { type: 'discovery.requested' });
  assert.equal(retried.state.discovery.continueAfterInstall, false, 'an explicit re-check does not add on its own');
  const closed = updateConnectorDetail(progress.state, { type: 'close.requested', busy: false, force: true });
  assert.deepEqual(updateConnectorDetail(closed.state, { type: 'install.progress', generation: started.state.generation, job: { state: 'done' } }).effects, []);
  const afterFail = updateConnectorDetail(progress.state, { type: 'install.progress', generation: started.state.generation, job: { state: 'failed', log: 'boom', exitCode: 1 } });
  assert.deepEqual(afterFail.effects, [], 'a failed install is never retried automatically');
});

test('secrets are not admitted into replayable workflow state', () => {
  const state = open().state;
  assert.deepEqual(updateConnectorDetail(state, { type: 'field.changed', field: 'secretValue', value: 'not-a-real-secret' }), { state, effects: [] });
});

test('Feishu runtime refresh preserves explicit tool admission while replacing detected paths', () => {
  const current = { transport: 'stdio', command: '/old/node', tools: [] };
  const opened = updateConnectorDetail(initialConnectorDetail(), { type: 'opened', initial: {
    detailConnectorId: 'feishu', detailProviderId: 'feishu-workspace', definitionText: JSON.stringify(current), baseline: JSON.stringify(current),
  } });
  const requested = updateConnectorDetail(opened.state, { type: 'discovery.requested' });
  const completed = updateConnectorDetail(requested.state, { type: 'request.completed', effect: requested.effects[0], reply: {
    ok: true, definition: { transport: 'stdio', command: '/point/node', tools: ['feishu_document_get'] },
    found: { command: [], matlabRoot: [], extensionFile: [] },
  } });
  const result = JSON.parse(completed.state.definitionText);
  assert.equal(result.command, '/point/node');
  assert.deepEqual(result.tools, [], 'runtime repair must not enable tools that the user left disabled');
});
