import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FixtureApproval } from './fixture-approval.mjs';
import { plan, startFixtureProvider } from './fixture-provider.mjs';
const name = tool => `mcp__pero-app-use__app__paper-agent__${tool}`;
const args = { url: 'https://research.example.org/source-ready' };
const call = (title = name('inspect-research-link'), rawInput = args) => ({ kind: 'session_update', thread_id: 'owned', data: { sessionUpdate: 'tool_call', toolCallId: 'call', title, rawInput, status: 'in_progress' } });
const request = () => ({ kind: 'permission', thread_id: 'owned', data: { permission_id: 'pending', toolCall: { toolCallId: 'call' }, options: [{ kind: 'allow_once', optionId: 'allow' }, { kind: 'reject_once', optionId: 'deny' }] } });
function setup() { const p = new FixtureApproval('standard'); p.beginTurn(0); p.expect('call', name('inspect-research-link'), args); p.observe(call(), 'owned'); return p; }

test('only exact authored pending call on owned session receives one-use approval', () => {
  const p = setup(); assert.equal(p.respond(request(), 'owned').option_id, 'allow');
  assert.equal(p.respond(request(), 'owned').option_id, 'deny');
  assert.equal(p.decisions.filter(d => d.allowed).length, 1);
  assert.equal(p.errors.length, 1);
});
test('unknown, altered, wrong-session, settled and malformed requests never grant', () => {
  for (const mutate of [
    (p, r) => { r.thread_id = 'other'; },
    (p, r) => { r.data.toolCall.toolCallId = 'unknown'; },
    (p, r) => { p.observe(call(name('inspect-research-link'), { url: 'https://unapproved.example' }), 'owned'); },
    (p, r) => { p.observe(call('shell'), 'owned'); },
    (p, r) => { r.data.options = [{ kind: 'allow_always', optionId: 'all' }]; },
    (p, r) => { p.observe({ kind: 'session_update', thread_id: 'owned', data: { sessionUpdate: 'tool_call_update', toolCallId: 'call', status: 'completed' } }, 'owned'); },
  ]) { const p = setup(), r = request(); mutate(p, r); assert.notEqual(p.respond(r, 'owned').option_id, 'allow'); assert.equal(p.decisions[0].allowed, false); }
});
test('phase gates deny early acquisition, decline mutations, images, execution and other Apps', () => {
  for (const scene of ['standard', 'nonstandard-decline', 'ambiguity', 'injection']) {
    const p = new FixtureApproval(scene); p.beginTurn(0);
    for (const tool of ['commit-research-bundle', 'research-source', 'research-pdf', 'prepare-research', 'research-assets']) assert.throws(() => p.expect('x', name(tool), { operation: 'start' }));
    p.beginTurn(1);
    if (scene !== 'standard') assert.throws(() => p.expect('x', name('inspect-research-link'), args));
    for (const [tool, input] of [['research-source-read', { operation: 'image' }], ['research-source', { operation: 'cancel' }], ['research-step', { action: 'execute' }], ['research-assets', { operation: 'start' }]]) assert.equal(p.permits(name(tool), input), false);
    for (const tool of ['shell', 'mcp__pero-app-use__app__data__download', 'mcp__pero-app-use__app_write']) assert.equal(p.permits(tool, {}), false);
  }
  const p = setup(); p.beginTurn(1); assert.equal(p.respond(request(), 'owned').option_id, 'deny');
});
test('denial in scripted plan identifies authorization instead of JSON parse error', () => {
  const iterator = plan('standard', 'digest'); iterator.next();
  assert.throws(() => iterator.next('tool approval denied: inspect-research-link'), /Fixture tool denied before dispatch/);
});
test('loopback provider returns explicit terminal denial without opaque HTTP 500', async () => {
  const provider = await startFixtureProvider('source', 'digest', '');
  try {
    const response = await fetch(provider.endpoint + '/chat/completions', { method: 'POST', headers: { authorization: 'Bearer local-paper-study-fixture' }, body: JSON.stringify({ messages: [{ role: 'tool', content: 'tool approval denied: fixture' }] }) });
    assert.equal(response.status, 200); assert.match(await response.text(), /permission denied/); assert.match(provider.errors[0], /denied before dispatch/);
  } finally { await provider.close(); }
});

test('real mode stops before credential input or provider construction', () => {
  const run = spawnSync(process.execPath, ['--experimental-transform-types', fileURLToPath(new URL('./run.mjs', import.meta.url)), '--real', 'standard', '/does-not-exist'], { encoding: 'utf8', timeout: 5000, input: '' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Real campaign stopped: this runner has no human ACP permission responder/);
  assert.doesNotMatch(run.stderr, /Missing or invalid credential input/);
});

test('each active phase requires actual requests and consumes every planned Paper call', () => {
  const p = setup(); assert.throws(() => p.finishTurn(), /actual permission request/);
  p.respond(request(), 'owned'); p.finishTurn();
  p.beginTurn(1); assert.throws(() => p.finishTurn(), /No actual bounded permission/);
  const decline = new FixtureApproval('injection'); decline.beginTurn(0);
  assert.throws(() => decline.finishTurn(), /No actual bounded permission/);
  decline.beginTurn(1); decline.finishTurn();
});

test('ID-only Go permission updates retain subject; supplied updates must match exactly', () => {
  for (const subject of [{}, { title: name('inspect-research-link'), rawInput: args }]) {
    const p = setup(), r = request(); Object.assign(r.data.toolCall, subject);
    assert.equal(p.respond(r, 'owned').option_id, 'allow');
    assert.equal(p.respond(r, 'owned').option_id, 'deny');
  }
  for (const subject of [
    { title: 'shell' }, { title: null }, { title: {} },
    { rawInput: { command: 'unauthorized' } }, { rawInput: null },
    { rawInput: JSON.stringify(args) }, { rawInput: [] },
  ]) {
    const p = setup(), r = request(); Object.assign(r.data.toolCall, subject);
    assert.equal(p.respond(r, 'owned').option_id, 'deny');
    assert.equal(p.decisions[0].allowed, false);
    // A conflicting subject consumes the request; restoring it cannot replay.
    r.data.toolCall = { toolCallId: 'call', title: name('inspect-research-link'), rawInput: args };
    assert.equal(p.respond(r, 'owned').option_id, 'deny');
  }
});
