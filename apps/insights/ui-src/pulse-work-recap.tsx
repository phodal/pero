import React, { useState } from 'react';
import { SectionHead, RichText } from './rich-text';
import { workRecapPrompt, recapDisplayTurns, recapLatestTurn } from './work-recap-model.mjs';
import './pulse-work-recap.css';

export type EvidenceCoverage = { examined: number; matched: number; shown: number; unreadable: number; omitted: number; complete: boolean };
export type RecapTurn = {
  turnId: string; status: 'completed' | 'failed' | 'unfinished' | 'unknown'; startSeq: number; endSeq: number; start: string; end: string;
  request?: string; response?: string; requestSeq?: number; responseSeq?: number; responseKind: 'final' | 'intermediate' | 'unknown';
  outcome?: string; boundary: 'explicit' | 'legacy'; startedBeforeWindow?: boolean; truncated?: boolean;
};
export type RecapSession = {
  sessionId: string; title: string; projectId?: string; taskId?: string; runId?: string; harnessId?: string;
  repository?: string; turns?: RecapTurn[]; turnCount?: number; omittedTurns?: number; unfinishedTurns?: number; unknownTurns?: number;
  status: string; outcome?: string; request?: string; response?: string; completedTurns: number; failedTurns: number; toolCalls: number; updatedAt: string; truncated: boolean;
  source: { kind: string; startSeq: number; endSeq: number; asOfSeq: number; digest: string; durable: boolean };
};
export type WorkRecap = { date: string; timezone: string; start: string; end: string; asOf: string; scope: string; sessions: RecapSession[]; coverage: EvidenceCoverage };
export type MemoryContext = {
  items: Array<{ id: string; scope: string; repository: string; topic: string; content: string; type: string; paths?: string[]; source: string; sourceRef: string; digest: string; readAt: string; truncated: boolean; freshness?: string;
    relevance?: { level: 'strong' | 'related' | 'weak'; score: number; reasons: Array<{ kind: 'path' | 'topic' | 'unfinished-work' | 'scope-only'; sessionId?: string; path?: string; terms?: string[] }>; sessionIds: string[] } }>;
  coverage: EvidenceCoverage; policy: string; codexEnabled?: boolean;
};

const copy = {
  zh: {
    heading: '昨天的工作', empty: '昨天没有可读取的本地会话记录。', scope: '当前 Host 的会话记录', partial: '覆盖不完整：{omitted} 个会话未展示，{unreadable} 个记录无法读取。',
    goal: '当时的目标', response: 'Agent 的结果声明', noText: '这段记录没有文字摘要。', evidence: '查看记录与来源', turns: '完成回合', failures: '失败回合', tools: '工具调用',
    open: '打开会话', more: '查看全部 {n} 个会话', less: '收起', memory: '相关记忆', memoryEmpty: '还没有相关记忆。可以在会话中沉淀经验，或在 Pulse 设置中启用 Codex 记忆。',
    point: 'Point 已发布记忆', codex: 'Codex 记忆', cached: '缓存读取于', clipped: '部分内容已截取', suggestions: '结合记忆规划下一步', hint: '每日简报也会结合这些记录和记忆生成建议。生成的建议需要复核。', durable: '持久化记录', live: '内存记录',
    memoryPartial: '仅展示 {shown} 条记忆，另有 {omitted} 条未展示。', claim: '会话完成和 Agent 的声明不代表成果已验证或验收。', countRange: '计数仅覆盖列出的来源序号范围，可能未包含全天记录。',
    completed: '回合完成', failed: '回合失败', unfinished: '回合未完成', unknown: '回合状态未知', intermediate: '过程中的回应', unknownResponse: '边界未确认的回应', noFinal: '这轮没有最终回复。',
    turn: '回合 {n}', omittedTurns: '仅显示最近 {shown} 轮，另有 {omitted} 轮未展示。', legacy: '旧记录未提供回合证据，结果需打开会话核对。', legacyBoundary: '回合边界由历史消息推断', beforeWindow: '跨日回合：只显示昨天窗口内的内容。',
    selected: '选取依据', path: '涉及路径', topic: '主题词匹配', unfinishedWork: '关联未完成工作', scopeOnly: '仅匹配当前范围', relevanceMissing: '尚无相关性说明', relevanceHint: '选取依据不代表内容已验证或源版本仍然有效。', asOf: '读取时序号',
  },
  en: {
    heading: 'Yesterday’s work', empty: 'No readable local session records for yesterday.', scope: 'Session records on this Host', partial: 'Incomplete coverage: {omitted} sessions omitted; {unreadable} records unreadable.',
    goal: 'Goal at the time', response: 'Agent’s result claim', noText: 'No text summary in this part of the record.', evidence: 'Records and sources', turns: 'Completed turns', failures: 'Failed turns', tools: 'Tool calls',
    open: 'Open session', more: 'View all {n} sessions', less: 'Show less', memory: 'Related memory', memoryEmpty: 'No related memory yet. Capture lessons in a session, or enable Codex memory in Pulse settings.',
    point: 'Published Point memory', codex: 'Codex memory', cached: 'Cached read at', clipped: 'Some content truncated', suggestions: 'Plan next steps with memory', hint: 'The daily brief also uses these records and memory to suggest next steps. Review generated suggestions.', durable: 'Persisted record', live: 'In-memory record',
    memoryPartial: 'Showing {shown} memory entries; {omitted} omitted.', claim: 'A completed session or an Agent’s claim does not establish verification or acceptance.', countRange: 'Counts cover the listed source sequence range and may omit other records from the day.',
    completed: 'Turn completed', failed: 'Turn failed', unfinished: 'Turn unfinished', unknown: 'Turn status unknown', intermediate: 'Intermediate response', unknownResponse: 'Response with uncertain boundary', noFinal: 'This turn has no final response.',
    turn: 'Turn {n}', omittedTurns: 'Showing the latest {shown} turns; {omitted} omitted.', legacy: 'This older record has no turn evidence. Open the session to check its result.', legacyBoundary: 'Turn boundary inferred from historical messages', beforeWindow: 'Turn spans days: only content in yesterday’s window is shown.',
    selected: 'Why selected', path: 'Related path', topic: 'Matching topic terms', unfinishedWork: 'Related unfinished work', scopeOnly: 'Current scope only', relevanceMissing: 'No relevance explanation yet', relevanceHint: 'Selection reasons do not verify the content or current source version.', asOf: 'Sequence at read',
  },
};

export function PulseWorkRecap({ recap, memory, locale = 'zh', openSession, delegate, suggestion }: {
  recap?: WorkRecap; memory?: MemoryContext; locale?: 'zh' | 'en'; openSession?: (id: string) => void; delegate?: (prompt: string) => void; suggestion?: string;
}) {
  const [all, setAll] = useState(false);
  const t = copy[locale];
  const fmt = (value: string, vars: Record<string, number>) => value.replace(/\{(\w+)\}/g, (match, key) => key in vars ? String(vars[key]) : match);
  const responseLabel = (turn: RecapTurn) => turn.responseKind === 'final' ? t.response : turn.responseKind === 'intermediate' ? t.intermediate : t.unknownResponse;
  if (!recap || (!recap.sessions.length && !memory?.items.length && !recap.coverage.omitted && !recap.coverage.unreadable)) return null;
  const sessions = all ? recap.sessions : recap.sessions.slice(0, 3);
  return <section className="point-pulse-section point-pulse-recap" aria-labelledby="point-pulse-recap-heading">
    <SectionHead id="point-pulse-recap-heading" title={t.heading} count={recap.coverage.matched} />
    <p className="point-pulse-muted">{recap.date} · {recap.timezone} · {t.scope}</p>
    {!recap.coverage.complete && <p className="point-pulse-banner" role="status">{recap.coverage.omitted || recap.coverage.unreadable ? fmt(t.partial, recap.coverage) : t.clipped}</p>}
    {!sessions.length && <p className="point-pulse-muted">{t.empty}</p>}
    <div className="point-pulse-recap-list">{sessions.map(session => {
      const turns = recapDisplayTurns(session);
      const latest = recapLatestTurn(session);
      return <article key={session.sessionId}>
      <header><strong>{session.title || session.sessionId}</strong>{openSession && <button type="button" onClick={() => openSession(session.sessionId)}>{t.open}</button>}</header>
      {latest && <span className="point-pulse-recap-turn-status" data-status={latest.status}>{t[latest.status] || t.unknown}</span>}
      <p>{latest ? latest.request || (latest.startedBeforeWindow ? t.beforeWindow : t.noText) : session.request || t.noText}</p>
      {latest?.response && <p className="point-pulse-recap-response"><span>{responseLabel(latest)}{locale === 'zh' ? '：' : ': '}</span>{latest.response.split('\n').find(Boolean)}</p>}
      {latest && latest.responseKind !== 'final' && <p className="point-pulse-muted">{t.noFinal}</p>}
      <details><summary>{t.evidence}</summary>
        {turns.map((turn, index) => <section className="point-pulse-recap-turn" key={turn.turnId || `${turn.startSeq}:${turn.endSeq}`}>
          <h3>{fmt(t.turn, { n: (session.turnCount ?? turns.length) - turns.length + index + 1 })} · {t[turn.status] || t.unknown}</h3>
          {turn.startedBeforeWindow && <p className="point-pulse-muted">{t.beforeWindow}</p>}
          {turn.request && <><h4>{t.goal}</h4><RichText text={turn.request} /></>}
          {turn.response && <><h4>{responseLabel(turn)}</h4><RichText text={turn.response} /></>}
          {turn.responseKind !== 'final' && <p className="point-pulse-muted">{t.noFinal}</p>}
          <small><time dateTime={turn.start}>{turn.start}</time> · <time dateTime={turn.end}>{turn.end}</time></small>
          <code>{turn.turnId} · seq {turn.startSeq}–{turn.endSeq}</code>
          {turn.boundary === 'legacy' && <small>{t.legacyBoundary}</small>}
          {turn.truncated && <small>{t.clipped}</small>}
        </section>)}
        {!turns.length && <><p className="point-pulse-muted">{t.legacy}</p>{session.request && <><h3>{t.goal}</h3><RichText text={session.request} /></>}</>}
        {!!session.omittedTurns && <p className="point-pulse-muted">{fmt(t.omittedTurns, { shown: turns.length, omitted: session.omittedTurns })}</p>}
        <p className="point-pulse-muted">{t.turns}: {session.completedTurns} · {t.failures}: {session.failedTurns} · {t.tools}: {session.toolCalls}</p>
        {session.truncated && <p className="point-pulse-muted">{t.countRange}</p>}
        <p className="point-pulse-muted">{t.claim}</p>
        <small>{session.source.durable ? t.durable : t.live} · {session.harnessId || 'Point'}</small>
        <code>{session.sessionId} · seq {session.source.startSeq}–{session.source.endSeq} · {t.asOf}: {session.source.asOfSeq} · {session.source.digest}</code>
        {session.truncated && <small>{t.clipped}</small>}
      </details>
    </article>})}</div>
    {recap.sessions.length > 3 && <button type="button" aria-expanded={all} onClick={() => setAll(value => !value)}>{all ? t.less : fmt(t.more, { n: recap.sessions.length })}</button>}
    <details className="point-pulse-recap-memory"><summary>{t.memory} <small>{memory?.items.length ?? 0}</small></summary>
      {!memory?.items.length && <p className="point-pulse-muted">{t.memoryEmpty}</p>}
      {memory?.coverage.omitted ? <p className="point-pulse-muted">{fmt(t.memoryPartial, memory.coverage)}</p> : null}
      {memory?.items.map(item => <article key={`${item.scope}:${item.id}:${item.digest}`}>
        <strong>{item.topic}</strong><RichText text={item.content} />
        <div className="point-pulse-recap-relevance"><small>{t.selected}</small>
          {!item.relevance?.reasons.length && <small>{t.relevanceMissing}</small>}
          {!!item.relevance?.reasons.length && <ul>{item.relevance.reasons.map((reason, index) => <li key={index}>
            <span>{reason.kind === 'path' ? t.path : reason.kind === 'topic' ? t.topic : reason.kind === 'unfinished-work' ? t.unfinishedWork : reason.kind === 'scope-only' ? t.scopeOnly : t.relevanceMissing}</span>
            {reason.path && <code>{reason.path}</code>}
            {reason.terms?.length ? <span> · {reason.terms.join(', ')}</span> : null}
            {reason.sessionId && <span> · {openSession ? <button type="button" onClick={() => openSession(reason.sessionId!)}>{t.open}</button> : reason.sessionId}</span>}
          </li>)}</ul>}
          <small>{t.relevanceHint}</small>
        </div>
        <small>{item.source === 'codex-memory' ? t.codex : t.point} · {item.repository || item.scope}</small>
        <small>{t.cached}: {item.readAt} · {item.sourceRef}</small><code>{item.digest}</code>
        {item.truncated && <small>{t.clipped}</small>}
      </article>)}
    </details>
    {(recap.sessions.length > 0 || (memory?.items.length ?? 0) > 0) && <div className="point-pulse-recap-next">
      {delegate && <button type="button" className="point-primary-action" onClick={() => delegate(workRecapPrompt(recap, memory, locale))}>{t.suggestions}</button>}
      {suggestion ? <RichText text={suggestion} /> : null}
      <p className="point-pulse-muted">{t.hint}</p>
    </div>}
  </section>;
}
