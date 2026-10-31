import { useState } from 'react';
import { cardKind, pulseFeed } from './work-recap-model.mjs';
import './pulse-home-result.css';

/** Strings copied from pulse-home-copy.ts. This page is PulseBrief, not the work recap. */
const copy = {
  zh: {
    title: 'Insights', forMe: '给我的', popular: '热门', recent: '最近', today: '今天',
    needs: '需要你', agent: 'Point 判断', review: '查看冲突', openSession: '打开会话', ahead: '接下来',
    generatedAt: '生成于 {time}', personalEmpty: '暂无新的个人工作更新。', popularEmpty: '还没有值得广传的变化。', recentEmpty: '还没有更新。',
    generating: 'Point 正在读今天发生的事，写你的简报…',
    evidence: '依据', why: '为什么给你看', sources: '{n} 个来源', handled: 'Agent 报告已完成', more: '更多',
    needs_you: '需要你', risk: '风险', change: '变化', done: '已完成', watch: '在盯', filtered: '已过滤',
    project: '项目', session: '会话', file: '文件', pr: 'PR', issue: 'Issue', commit: '提交', branch: '分支', meeting: '会议', automation: '自动化',
  },
  en: {
    title: 'Insights', forMe: 'For me', popular: 'Popular', recent: 'Recent', today: 'Today',
    needs: 'Needs you', agent: 'Point’s judgment', review: 'Review conflict', openSession: 'Open session', ahead: 'Ahead',
    generatedAt: 'Generated at {time}', personalEmpty: 'No new personal work updates.', popularEmpty: 'Nothing notable to share yet.', recentEmpty: 'No updates yet.',
    generating: 'Point is reading today and writing your brief…',
    evidence: 'Evidence', why: 'Why you are seeing this', sources: '{n} sources', handled: 'Agent reported this done', more: 'More',
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

type Feed = 'for-me' | 'popular' | 'recent';

function when(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function lines(value?: string) {
  return (value ?? '').split(/\n+/).map(line => line.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
}

function Post({ card, time, t }: { card: ResultCard; time: string; t: typeof copy.zh }) {
  const [open, setOpen] = useState(false);
  const kind = cardKind(card);
  const bullets = lines(card.body);
  const showList = bullets.length > 1;
  return <article className="point-pulse-post" data-kind={kind}>
    <header>
      <h3>{card.title}</h3>
      <button type="button" className="point-pulse-more" aria-expanded={open} aria-label={t.more} onClick={() => setOpen(!open)}>•••</button>
    </header>
    <p className="point-pulse-status">
      <i aria-hidden="true" />
      <span>{t[kind as keyof typeof t] || kind}</span>
      {card.entity?.label && <span className="point-pulse-dot">{card.entity.label}</span>}
      {time && <span className="point-pulse-dot">{time}</span>}
    </p>
    {card.conclusion && <p className="point-pulse-body">{card.conclusion}</p>}
    {showList && <ul>{bullets.map(line => <li key={line}>{line}</li>)}</ul>}
    {open && <div className="point-pulse-detail">
      {!showList && card.body && <section><h4>{t.evidence}</h4><p>{card.body}</p></section>}
      {card.why && <section><h4>{t.why}</h4><p>{card.why}</p></section>}
      {card.handled && <p>{t.handled}</p>}
      {(card.sources?.length ?? 0) > 0 && <p>{t.sources.replace('{n}', String(card.sources?.length))}</p>}
    </div>}
  </article>;
}

/**
 * A Pulse feed. For me is the default. needs_you stays available as Point 判断
 * through the status line, and the edition is the other two tabs.
 */
export function PulseHomeResult({ brief, createdAt, running, locale }: { brief?: ResultBrief | null; createdAt?: string; running?: boolean; locale: 'zh' | 'en' }) {
  const t = copy[locale];
  const [feed, setFeed] = useState<Feed>('for-me');
  const cards = pulseFeed(brief?.cards ?? [], feed) as ResultCard[];
  const stamp = when(createdAt);
  const day = createdAt && new Date(createdAt).toDateString() === new Date().toDateString();
  const empty = feed === 'popular' ? t.popularEmpty : feed === 'recent' ? t.recentEmpty : t.personalEmpty;
  const tabs: [Feed, string][] = [['for-me', t.forMe], ['popular', t.popular], ['recent', t.recent]];
  return <div className="point-pulse-main">
    <header className="point-pulse-top">
      <h1>{t.title}</h1>
    </header>
    <div className="point-pulse-tabs" role="tablist">
      {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={feed === id} onClick={() => setFeed(id)}>{label}</button>)}
    </div>
    {running && <p className="point-pulse-muted" role="status">{t.generating}</p>}
    <div className="point-pulse-day"><span>{day || !stamp ? t.today : stamp}</span></div>
    {createdAt && <p className="point-pulse-generated">{t.generatedAt.replace('{time}', stamp)}</p>}
    {cards.length === 0 && !running && <p className="point-pulse-muted">{empty}</p>}
    <div className="point-pulse-feed">
      {cards.map(card => <Post key={card.id} card={card} time={stamp} t={t} />)}
    </div>
    {brief?.tomorrow && feed !== 'popular' && <section className="point-pulse-ahead"><h2>{t.ahead}</h2><p>{brief.tomorrow}</p></section>}
  </div>;
}
