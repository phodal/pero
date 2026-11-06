import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisRequest, briefFromReply, briefResultPrompt, projectBrief, pulseFeed, workRecapPrompt } from '../ui-src/work-recap-model.mjs';

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

test('brief publications preserve sources, actions, and next steps across reply formats', () => {
  const sessionId = 'chat-1793718026531-2';
  const url = 'https://github.com/phodal/pero/commit/9cf2df1240064ea8b02cb4fe7cd068719a5b1af8';
  const prompt = `打开 ${sessionId} 交接给 Agent：沿用同版本 TeX 源，标注哪些数字来自原文。`;
  for (const [publication, expected] of [
    [{ summary: '论文阅读已拿到图表材料，接下来可沿原会话核对关键结论。', cards: [{ title: '论文图表已交付', entity: { type: 'session', label: '论文阅读', sessionId }, action: { label: '打开会话', sessionId }, sources: [{ label: '阅读会话', sessionId }, { label: '提交', url }] }], tomorrow: '核对原文证据。' },
      { entity: { type: 'session', label: '论文阅读', sessionId }, action: { label: '打开会话', sessionId }, sources: [{ label: '阅读会话', sessionId }, { label: '提交', url }], tomorrow: '核对原文证据。' }],
    [{ cards: [{ title: '论文图表已交付', entity: 'session', action: prompt, sources: [{ sessionId }, { url }, null, {}] }], tomorrow: ['核对原文证据。', '继续论文概述。'], view: { schemaVersion: 1, sections: [] } },
      { entity: { type: 'session', label: 'session' }, action: { label: '交给 Agent', prompt }, sources: [{ label: sessionId, sessionId }, { label: url, url }], tomorrow: '核对原文证据。\n继续论文概述。' }],
  ]) {
    const brief = briefFromReply(JSON.stringify(publication));
    assert.equal(brief.summary, publication.summary ?? '');
    const card = brief.cards[0];
    assert.deepEqual({ entity: card.entity, action: card.action, sources: card.sources, tomorrow: brief.tomorrow }, expected);
    assert.equal(Object.hasOwn(brief, 'view'), false);
  }
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
  assert.match(brief, /不要把 entity 或 action 写成字符串/);
  assert.match(brief, /"label":"来源名称","sessionId":"原会话 ID"/);
  assert.match(brief, /tomorrow 是一个字符串/);
  assert.match(brief, /先写 summary/);
  assert.match(brief, /累计会话日志/);
  assert.match(brief, /回合完成或助手声称/);
  assert.equal(brief.includes('昨天的 workRecap'), false);
  assert.equal(brief.includes('按内容生成 view'), false);
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
