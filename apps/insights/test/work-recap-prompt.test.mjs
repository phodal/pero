import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analysisRequest, briefFromReply, briefResultPrompt, projectBrief, pulseFeed, workRecapPrompt } from '../ui-src/work-recap-model.mjs';

test('the page shows Pulse’s result, not the work recap', () => {
  const page = readFileSync(new URL('../ui-src/index.tsx', import.meta.url), 'utf8');
  const result = readFileSync(new URL('../ui-src/pulse-home-result.tsx', import.meta.url), 'utf8');
  assert.match(page, /PulseHomeResult/);
  assert.equal(page.includes('PulseWorkRecap'), false);
  assert.match(result, /需要你/);
  assert.match(result, /Point 判断/);
  assert.match(result, /生成于/);
  assert.match(result, /暂无新的个人工作更新/);
  assert.match(result, /For me/);
  assert.match(result, /Popular/);
  assert.match(result, /Recent/);
});

test('the feed splits personal, notable, and recent cards', () => {
  const cards = [
    { kind: 'needs_you', title: '等待审阅' },
    { kind: 'risk', title: '可能卡住' },
    { kind: 'change', title: '接口换了' },
    { kind: 'done', title: '已经合上' },
    { kind: 'filtered', title: '构建产物' },
  ];
  assert.deepEqual(pulseFeed(cards, 'for-me').map(card => card.title), ['等待审阅', '可能卡住']);
  assert.deepEqual(pulseFeed(cards, 'popular').map(card => card.title), ['接口换了', '已经合上']);
  assert.deepEqual(pulseFeed(cards, 'recent').map(card => card.title), ['等待审阅', '可能卡住', '接口换了', '已经合上']);
});

test('a needs_you card is the result row, and the edition underneath stays empty', () => {
  const brief = briefFromReply('说明\n{"cards":[{"kind":"needs_you","title":"等待审阅","conclusion":"v1 已登记，还没有裁决。","body":"依据","entity":{"type":"project","label":"CardDemo Frontend"}}],"tomorrow":""}');
  assert.equal(brief.cards.length, 1);
  assert.equal(brief.cards[0].id, 'c1');
  const view = projectBrief(brief);
  assert.equal(view.needCards.length, 1);
  assert.equal(view.needCards[0].title, '等待审阅');
  assert.equal(view.cards.length, 0);
});

test('the next-step prompt keeps Point’s analysis contract', () => {
  const prompt = workRecapPrompt({
    sessions: [{ sessionId: 'chat-1793283309757-2', turns: [{ turnId: '1', request: '杭州', response: '我来搜一下杭州今天的天气。', responseKind: 'intermediate', status: 'unfinished' }] }],
  }, { items: [] });
  assert.match(prompt, /结果声明/);
  assert.match(prompt, /下一步/);
  assert.match(prompt, /只提供建议，不执行/);
  assert.match(prompt, /杭州/);
  assert.match(prompt, /我来搜一下杭州今天的天气。/);
  assert.equal(prompt.includes('Unmatched older response'), false);
  const brief = briefResultPrompt({ sessions: [] }, [{ repository: 'github.com/phodal/pero', unpushedCommits: 1, uncommittedFiles: ['dirty.rs'] }], [], 'zh');
  assert.match(brief, /看完就结束的工作简报/);
  assert.match(brief, /pulse_publish/);
  assert.match(brief, /最多挑 8 件/);
  assert.match(brief, /dirty.rs/);
  assert.match(brief, /do not establish clean local work/);
  assert.equal(brief.includes('"repository":"not_read"'), false);
  assert.equal(brief.includes('给出最多三项具体的下一步建议'), false);
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
