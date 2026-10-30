import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

// The deterministic full fixture has 25 sequential tools. Completion, not
// status/text chatter, advances its test-only responsiveness deadline.
export const FULL_APP_USE_ACTIONS = [
  'inventory', 'start', 'describe', 'capture', 'observe', 'act', 'wait',
  'verify', 'verify', 'verify', 'observe', 'act', 'wait', 'verify', 'observe',
  'act', 'act', 'observe', 'act', 'verify', 'capture', 'stop', 'start', 'runPlan', 'observe',
];

export function fullAppUseProgress(before, startedAt) {
  const oldTools = new Set(before.tools.map(tool => tool.id));
  const completed = new Set();
  let progressAt = startedAt;
  return (chat, now) => {
    assert.equal(chat.id, before.id, 'full scenario changed its conversation');
    assert.deepEqual(chat.scope, before.scope, 'full scenario changed its App scope');
    assert.equal(chat.error, null, 'full scenario reported a chat error');
    assert.ok(now - startedAt < 300000, 'full scenario exceeded its five-minute test ceiling');
    const tools = chat.tools.filter(tool => !oldTools.has(tool.id));
    assert.ok(tools.length <= FULL_APP_USE_ACTIONS.length, 'unexpected extra fixture tool');
    assert.equal(new Set(tools.map(tool => tool.id)).size, tools.length, 'duplicate fixture tool ID');
    assert.deepEqual(tools.map(tool => tool.title), FULL_APP_USE_ACTIONS.slice(0, tools.length).map(action => `App Use: ${action}`));
    assert.ok(tools.every(tool => tool.status !== 'failed'), 'full scenario tool failed');
    // runPlan already has a 60-second production operation deadline. Other
    // stages retain the prior 30-second E2E responsiveness bound. Neither a
    // started tool nor a repeated update resets time since actual completion.
    const runPlan = completed.size <= 23 && tools.length >= 24
      && tools.slice(0, 23).every(tool => tool.status === 'completed');
    assert.ok(now - progressAt < (runPlan ? 60000 : 30000), 'full scenario stopped completing tools');
    for (const tool of tools) {
      if (tool.status === 'completed' && !completed.has(tool.id)) {
        completed.add(tool.id);
        progressAt = now;
      }
    }
    const answer = chat.messages.slice(before.messages.length).filter(message => message.role === 'assistant').at(-1)?.text || '';
    if (!answer.startsWith('APP_USE_RESULT:')) return false;
    const result = JSON.parse(answer.slice('APP_USE_RESULT:'.length));
    assert.equal(result.scenario, 'full', 'unexpected fixture scenario');
    assert.equal(result.error, undefined, 'full fixture reported an error');
    assert.equal(completed.size, FULL_APP_USE_ACTIONS.length, 'fixture result preceded its complete tool sequence');
    return true;
  };
}

export async function waitForFullAppUse(readChat, before) {
  const startedAt = performance.now();
  const observe = fullAppUseProgress(before, startedAt);
  while (!observe(await readChat(), performance.now())) await setTimeout(100);
  return { elapsedMs: Math.round(performance.now() - startedAt), completedTools: FULL_APP_USE_ACTIONS.length };
}
