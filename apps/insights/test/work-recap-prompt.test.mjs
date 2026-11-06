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
    assert.equal(card.kind, 'watch');
    assert.deepEqual(JSON.parse(JSON.stringify(brief)), brief, 'A published brief can cross the JSON App surface without losing fields');
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
  assert.match(brief, /kind（必填，取第5条允许值）/);
  assert.match(brief, /2–3 条工作主线或共同进展.*2–3 句/);
  assert.match(brief, /120–180 字.*English 约 60–90 words/);
  assert.match(brief, /不要逐篇罗列论文或列全 8 张卡片/);
  assert.match(brief, /详细论文名和交付清单留在 cards/);
  assert.match(brief, /累计会话日志/);
  assert.match(brief, /回合完成或助手声称/);
  for (const requirement of [
    /summary、title、conclusion、why、impact、entity\.label、action\.label、sources\.label、tomorrow/,
    /禁止在这些字段复制 chat- 或 app:/,
    /r4 \/ r6 内部简称/,
    /APP_SESSION_INACTIVE 等错误码/,
    /完整 Conventional Commit 原文/,
    /raw ID \/ URL 精确保留在 sessionId \/ id \/ url/,
    /“图表提取记录”“论文概述对话”“桌面设计改动”/,
    /不同论文不得因主题、标题相似/,
    /只有状态或占位回应、没有实质结果且没有用户决策价值的记录，不单独成卡/,
    /原文没有内容就不能假装提炼出了成果/,
    /论文名、模型名和有识别意义的技术名词可以保留英文/,
    /历史对话里的资料可用性、失败和读取状态，只能描述为那次会话当时的观察，不是当前事实/,
    /本轮明确的当前 I\/O 快照/,
    /先核对论文对象、版本、读取入口和记录先后/,
    /不能把某次单一入口的限制扩大成整篇论文或整个项目缺资料/,
    /已有完整材料的记录时.*不能直接宣告需要补缺全文/,
  ]) assert.match(brief, requirement);
  assert.match(brief, /输出语言：zh.*简体中文/);
  const sessionId = 'chat-1793584789985-4';
  const english = briefResultPrompt({ sessions: [{ sessionId, turns: [{ request: 'Continue', response: 'Now' }] }] }, [], [], 'en');
  assert.match(english, /Output locale: en.*natural English/);
  const context = JSON.parse(english.slice(english.lastIndexOf('\n{"workRecap":') + 1));
  assert.equal(context.workRecap.sessions[0].sessionId, sessionId);
  assert.equal(context.workRecap.sessions[0].turns[0].response, 'Now');
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
