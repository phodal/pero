import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analysisRequest, workRecapPrompt } from '../ui-src/work-recap-model.mjs';

test('the next-step prompt keeps Point’s analysis contract', () => {
  const screen = readFileSync(new URL('../ui-src/pulse-work-recap.tsx', import.meta.url), 'utf8');
  assert.match(screen, /当时的目标/);
  assert.match(screen, /记录与来源/);
  assert.match(screen, /结合记忆规划下一步/);
  const prompt = workRecapPrompt({
    sessions: [{ sessionId: 'chat-1793283309757-2', turns: [{ turnId: '1', request: '杭州', response: '我来搜一下杭州今天的天气。', responseKind: 'intermediate', status: 'unfinished' }] }],
  }, { items: [] });
  assert.match(prompt, /结果声明/);
  assert.match(prompt, /下一步/);
  assert.match(prompt, /只提供建议，不执行/);
  assert.match(prompt, /杭州/);
  assert.match(prompt, /我来搜一下杭州今天的天气。/);
  assert.equal(prompt.includes('Unmatched older response'), false);
});

test('opening the recap starts analysis without a click', () => {
  for (const [state, expected] of [
    [{ recapReady: false, modelReady: true, started: false }, 'wait'],
    [{ recapReady: true, modelReady: false, started: false }, 'wait'],
    [{ recapReady: true, modelReady: true, started: false }, 'start'],
    [{ recapReady: true, modelReady: true, started: true }, 'regenerate'],
  ]) {
    assert.equal(analysisRequest(state), expected);
  }
});
