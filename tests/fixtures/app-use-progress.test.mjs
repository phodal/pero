import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FULL_APP_USE_ACTIONS, fullAppUseProgress, waitForFullAppUse } from './app-use-progress.mjs';

const baseline = () => ({ id: 'original', scope: { app: 'virtual-cell', panel: 'main' }, error: null, tools: [], messages: [] });
const tools = count => FULL_APP_USE_ACTIONS.slice(0, count).map((action, index) => ({ id: `tool-${index}`, title: `App Use: ${action}`, status: 'completed' }));
const result = { role: 'assistant', text: 'APP_USE_RESULT:{"scenario":"full","steps":[]}' };

test('full scenario can exceed the old aggregate deadline while completing its fixed tools', () => {
  const before = baseline(), observe = fullAppUseProgress(before, 0);
  for (let count = 1; count <= 25; count++) assert.equal(observe({ ...before, tools: tools(count), messages: count === 25 ? [result] : [] }, count * 2000), count === 25);
});

test('old tools and results cannot satisfy a new turn', () => {
  const before = { ...baseline(), tools: tools(25), messages: [result] }, observe = fullAppUseProgress(before, 0);
  assert.equal(observe(before, 1000), false);
  assert.throws(() => observe(before, 30000), /stopped completing/);
});

test('repeated completion and started chatter do not reset progress', () => {
  const before = baseline(), observe = fullAppUseProgress(before, 0);
  const chat = { ...before, tools: tools(1) };
  assert.equal(observe(chat, 1000), false);
  assert.equal(observe(chat, 29000), false);
  chat.tools.push({ ...tools(2)[1], status: 'in_progress' });
  assert.throws(() => observe(chat, 31000), /stopped completing/);
});

test('runPlan may use its declared 60 seconds without refreshing on chatter', () => {
  const before = baseline(), observe = fullAppUseProgress(before, 0);
  observe({ ...before, tools: tools(23) }, 1000);
  const chat = { ...before, tools: [...tools(23), { ...tools(24)[23], status: 'in_progress' }] };
  assert.equal(observe(chat, 31000), false);
  assert.equal(observe(chat, 60000), false);
  assert.throws(() => observe(chat, 61000), /stopped completing/);
});

test('runPlan completion within its budget advances the next stage deadline', () => {
  const before = baseline(), observe = fullAppUseProgress(before, 0);
  observe({ ...before, tools: tools(23) }, 1000);
  assert.equal(observe({ ...before, tools: tools(24) }, 59000), false);
  assert.equal(observe({ ...before, tools: tools(25), messages: [result] }, 60000), true);
});

test('coalesced start and runPlan completion use the operation budget, then return to 30 seconds', () => {
  const before = baseline(), observe = fullAppUseProgress(before, 0);
  observe({ ...before, tools: tools(22) }, 1000);
  assert.equal(observe({ ...before, tools: tools(24) }, 45000), false);
  assert.equal(observe({ ...before, tools: tools(24) }, 74000), false);
  assert.throws(() => observe({ ...before, tools: tools(24) }, 75000), /stopped completing/);
});

test('overall ceiling wins even if fresh completed tools continue arriving', () => {
  const before = baseline(), observe = fullAppUseProgress(before, 0);
  for (let count = 1; count <= 24; count++) observe({ ...before, tools: tools(count) }, count * 12000);
  assert.throws(() => observe({ ...before, tools: tools(25), messages: [result] }, 300000), /five-minute/);
});

for (const [name, change, pattern] of [
  ['wrong thread', chat => { chat.id = 'other'; }, /conversation/],
  ['wrong scope', chat => { chat.scope = null; }, /scope/],
  ['chat error', chat => { chat.error = 'fixture failure'; }, /chat error/],
  ['failed tool', chat => { chat.tools[0].status = 'failed'; }, /tool failed/],
  ['duplicate ID', chat => { chat.tools.push(chat.tools[0]); }, /duplicate/],
  ['extra tool', chat => { chat.tools = [...tools(25), { id: 'extra', title: 'App Use: observe', status: 'completed' }]; }, /extra fixture/],
  ['unexpected action', chat => { chat.tools[0].title = 'App Use: other'; }, /deep-equal/],
]) test(name, () => {
  const before = baseline(), chat = { ...before, tools: tools(1) };
  change(chat);
  assert.throws(() => fullAppUseProgress(before, 0)(chat, 1), pattern);
});

test('wrong scenario, fixture error and premature result remain failures', () => {
  for (const [payload, pattern] of [
    [{ scenario: 'hidden' }, /unexpected fixture/],
    [{ scenario: 'full', error: 'failed' }, /reported an error/],
    [{ scenario: 'full' }, /complete tool sequence/],
  ]) {
    const before = baseline(), chat = { ...before, messages: [{ role: 'assistant', text: `APP_USE_RESULT:${JSON.stringify(payload)}` }] };
    assert.throws(() => fullAppUseProgress(before, 0)(chat, 1), pattern);
  }
});


test('polling wrapper propagates hard failures without retrying them', async () => {
  const before = baseline();
  let reads = 0;
  await assert.rejects(waitForFullAppUse(async () => { reads++; return { ...before, id: 'other' }; }, before), /conversation/);
  assert.equal(reads, 1);
});

test('already completed fast turn is checked against its pre-submit baseline', async () => {
  const before = baseline();
  let reads = 0;
  const receipt = await waitForFullAppUse(async () => { reads++; return { ...before, tools: tools(25), messages: [result] }; }, before);
  assert.equal(reads, 1);
  assert.equal(receipt.completedTools, 25);
  assert.ok(Number.isFinite(receipt.elapsedMs) && receipt.elapsedMs >= 0);
});
