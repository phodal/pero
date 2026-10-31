import { useState } from 'react';
import { cardKind, projectBrief } from './work-recap-model.mjs';
import './pulse-home-result.css';

/** Strings copied from pulse-home-copy.ts. This page is PulseBrief, not the work recap. */
const copy = {
  zh: {
    needs: '需要你', agent: 'Point 判断', review: '查看冲突', openSession: '打开会话', ahead: '接下来',
    generatedAt: '生成于 {time}', personalEmpty: '暂无新的个人工作更新。', generating: 'Point 正在读今天发生的事，写你的简报…',
    evidence: '依据', why: '为什么给你看', sources: '{n} 个来源', handled: 'Agent 报告已完成',
    needs_you: '需要你', risk: '风险', change: '变化', done: '已完成', watch: '在盯', filtered: '已过滤',
    project: '项目', session: '会话', file: '文件', pr: 'PR', issue: 'Issue', commit: '提交', branch: '分支', meeting: '会议', automation: '自动化',
  },
  en: {
    needs: 'Needs you', agent: 'Point’s judgment', review: 'Review conflict', openSession: 'Open session', ahead: 'Ahead',
    generatedAt: 'Generated at {time}', personalEmpty: 'No new personal work updates.', generating: 'Point is reading today and writing your brief…',
    evidence: 'Evidence', why: 'Why you are seeing this', sources: '{n} sources', handled: 'Agent reported this done',
    needs_you: 'Needs you', risk: 'Risk', change: 'Change', done: 'Done', watch: 'Watching', filtered: 'Filtered',
    project: 'Project', session: 'Session', file: 'File', pr: 'PR', issue: 'Issue', commit: 'Commit', branch: 'Branch', meeting: 'Meeting', automation: 'Automation',
  },
};

export type ResultCard = {
  id: string; kind?: string; title: string; conclusion?: string; body?: string; why?: string; impact?: string; handled?: boolean;
  entity?: { type?: string; id?: string; label: string; sessionId?: string } | null;
  action?: { label: string; sessionId?: string; prompt?: string } | null;
  sources?: { label: string; url?: string; sessionId?: string }[];
};

export type ResultBrief = {
  cards: ResultCard[];
  tomorrow?: string;
  view?: { schemaVersion: number; sections: { title?: string; layout?: string; cardIds?: string[] }[] } | null;
};

function when(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Eye() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 3.5c3.2 0 5.6 2.4 6.7 4.2a.6.6 0 0 1 0 .6C13.6 10.1 11.2 12.5 8 12.5S2.4 10.1 1.3 8.3a.6.6 0 0 1 0-.6C2.4 5.9 4.8 3.5 8 3.5Zm0 1.2c-2.5 0-4.4 1.9-5.4 3.3 1 1.4 2.9 3.3 5.4 3.3s4.4-1.9 5.4-3.3C12.4 6.6 10.5 4.7 8 4.7Zm0 1.3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" /></svg>;
}

function Arrow() {
  return <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6.2 3.2 10.9 8l-4.7 4.8-.9-.9L9.1 8 5.3 4.1l.9-.9Z" /></svg>;
}

function EntityChip({ entity, t }: { entity: NonNullable<ResultCard['entity']>; t: typeof copy.zh }) {
  const type = t[entity.type as keyof typeof t] || entity.type || '';
  return <span className="point-pulse-entity"><span className="point-pulse-entity-type">{type}</span><span className="point-pulse-entity-label">{entity.label}</span></span>;
}

function BriefCard({ card, lead, t }: { card: ResultCard; lead?: boolean; t: typeof copy.zh }) {
  const [open, setOpen] = useState(false);
  const kind = cardKind(card);
  return <article className="point-pulse-card" data-kind={kind} data-lead={lead || undefined} data-open={open || undefined}>
    <header>
      <span className="point-pulse-kind" data-kind={kind}><i aria-hidden="true" />{t[kind]}</span>
      {card.impact && <span className="point-pulse-impact">{card.impact}</span>}
    </header>
    <h3><button type="button" className="point-pulse-card-title" aria-expanded={open} onClick={() => setOpen(!open)}>{card.title}</button></h3>
    {card.conclusion && <p className="point-pulse-card-conclusion">{card.conclusion}</p>}
    {open && <div className="point-pulse-card-detail">
      {card.body && <section><h4>{t.evidence}</h4><p>{card.body}</p></section>}
      {card.why && <section><h4>{t.why}</h4><p>{card.why}</p></section>}
    </div>}
    <footer>
      {card.entity && <EntityChip entity={card.entity} t={t} />}
      {card.handled && <span className="point-pulse-handled">{t.handled}</span>}
      {(card.sources?.length ?? 0) > 0 && !open && <button type="button" className="point-pulse-evidence" onClick={() => setOpen(true)}>{t.sources.replace('{n}', String(card.sources?.length))}</button>}
    </footer>
  </article>;
}

function cardByRef(cards: ResultCard[], ref: string) {
  const match = /^c(\d+)$/.exec(ref);
  if (!match) return undefined;
  return cards[Number(match[1]) - 1];
}

/**
 * PulseBrief's main column: 需要你, then the published edition.
 * needs_you is not repeated in the edition. An edition with nothing left says
 * there is no new personal work.
 */
export function PulseHomeResult({ brief, createdAt, running, locale }: { brief?: ResultBrief | null; createdAt?: string; running?: boolean; locale: 'zh' | 'en' }) {
  const t = copy[locale];
  const cards = brief?.cards ?? [];
  const projection = projectBrief({ cards });
  const needs = projection.needCards.map(card => {
    const session = card.action?.sessionId || card.entity?.sessionId;
    const project = card.entity?.type === 'project';
    return { key: card.id, title: card.title, detail: card.conclusion || card.body, entity: card.entity, action: project ? t.review : session ? t.openSession : '' };
  });
  const sections = brief?.view?.sections ?? [];
  const placed = new Set<string>();
  const grouped = sections.map(section => {
    const shown = (section.cardIds ?? []).map(id => cardByRef(cards, id)).filter((card): card is ResultCard => {
      if (!card || placed.has(card.id) || card.kind === 'needs_you' || card.kind === 'filtered') return false;
      placed.add(card.id);
      return true;
    });
    return { ...section, shown };
  }).filter(section => section.shown.length > 0);
  const rest = projection.cards.filter(card => !placed.has(card.id));
  return <div className="point-pulse-main">
    {needs.length > 0 && <section className="point-pulse-section" aria-labelledby="point-pulse-needs">
      <div className="point-pulse-head"><h2 id="point-pulse-needs">{t.needs}</h2><span className="point-pulse-count">{needs.length}</span></div>
      <div className="point-pulse-needs">{needs.map(need => <article key={need.key} className="point-pulse-need" data-tone="info">
        <span className="point-pulse-need-mark" aria-hidden="true"><Eye /></span>
        <div>
          <header><span className="point-pulse-need-label">{t.agent}</span></header>
          <h3>{need.title}</h3>
          {need.detail && <p>{need.detail}</p>}
          {(need.action || need.entity) && <footer>
            {need.action && <div className="point-pulse-need-actions"><button type="button" className="point-primary-action">{need.action} <Arrow /></button></div>}
            {need.entity && <div className="point-pulse-need-entity"><EntityChip entity={need.entity} t={t} /></div>}
          </footer>}
        </div>
      </article>)}</div>
    </section>}
    <section className="point-pulse-section">
      {running && <p className="point-pulse-muted" role="status">{t.generating}</p>}
      {createdAt && <div className="point-pulse-brief-meta"><time className="point-pulse-muted" dateTime={createdAt}>{t.generatedAt.replace('{time}', when(createdAt))}</time></div>}
      {!running && projection.cards.length === 0 && <p className="point-pulse-muted">{t.personalEmpty}</p>}
      {grouped.length > 0 && <div className="point-pulse-view">{grouped.map((section, index) => <section key={section.title || index} className="point-pulse-view-section" data-layout={section.layout}>
          {section.title && <h3>{section.title}</h3>}
          <div className="point-pulse-view-items">{section.shown.map((card, cardIndex) => <BriefCard key={card.id} card={card} lead={section.layout === 'lead' && cardIndex === 0} t={t} />)}</div>
        </section>)}</div>}
      {rest.length > 0 && <div className="point-pulse-grid">{rest.map((card, index) => <BriefCard key={card.id} card={card} lead={rest.length % 2 === 1 && index === 0} t={t} />)}</div>}
      {brief?.tomorrow && <section className="point-pulse-ahead"><div className="point-pulse-head"><h2>{t.ahead}</h2></div><p className="point-pulse-muted">{brief.tomorrow}</p></section>}
    </section>
  </div>;
}
