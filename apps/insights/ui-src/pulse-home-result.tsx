import { useId, useState } from 'react';
import { openAppSession, useAppChat } from '@pero/app-sdk';
import { Button, Feedback, Tabs, TabsContent, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
import { cardKind, pulseFeed } from './work-recap-model.mjs';
import './pulse-home-result.css';

const copy = {
  zh: {
    title: 'Insights', forMe: '给我的', popular: '热门', recent: '最近', today: '今天',
    openSession: '打开会话', ahead: '接下来', generatedAt: '生成于 {time}',
    personalEmpty: '暂无新的个人工作更新。', popularEmpty: '还没有值得广传的变化。', recentEmpty: '还没有更新。',
    generating: 'Point 正在读今天发生的事，写你的简报…', loading: '正在读取工作记录与 Agent 状态…',
    noAgent: '未连接可用 Agent。连接后可生成简报。', notGenerated: '工作记录已就绪，可以生成简报。',
    evidence: '依据', why: '为什么给你看', sources: '来源', handled: 'Agent 报告已完成', more: '查看依据',
    needs_you: '需要你', risk: '风险', change: '变化', done: '已完成', watch: '在盯', filtered: '已过滤',
  },
  en: {
    title: 'Insights', forMe: 'For me', popular: 'Popular', recent: 'Recent', today: 'Today',
    openSession: 'Open session', ahead: 'Ahead', generatedAt: 'Generated at {time}',
    personalEmpty: 'No new personal work updates.', popularEmpty: 'Nothing notable to share yet.', recentEmpty: 'No updates yet.',
    generating: 'Point is reading today and writing your brief…', loading: 'Loading work records and Agent availability…',
    noAgent: 'No Agent is connected. Connect an Agent to generate a brief.', notGenerated: 'Work records are ready. You can generate a brief.',
    evidence: 'Evidence', why: 'Why you are seeing this', sources: 'Sources', handled: 'Agent reported this done', more: 'View evidence',
    needs_you: 'Needs you', risk: 'Risk', change: 'Change', done: 'Done', watch: 'Watching', filtered: 'Filtered',
  },
};

export type ResultCard = {
  id: string; kind?: string; title: string; conclusion?: string; body?: string; why?: string; impact?: string; handled?: boolean;
  entity?: { type?: string; id?: string; label: string; sessionId?: string } | null;
  action?: { label: string; sessionId?: string; prompt?: string } | null;
  sources?: { label: string; url?: string; sessionId?: string }[];
};
export type ResultBrief = {
  cards: ResultCard[]; tomorrow?: string;
  view?: { schemaVersion: number; sections: { title?: string; layout?: string; cardIds?: string[] }[] } | null;
};
type Feed = 'for-me' | 'popular' | 'recent';
type BriefState = 'loading' | 'no-agent' | 'not-generated' | 'error' | 'ready';

function when(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date().toDateString() === date.toDateString()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Post({ card, time, t }: { card: ResultCard; time: string; t: typeof copy.zh }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const detailId = useId(), chat = useAppChat();
  const kind = cardKind(card);
  const bullets = (card.body ?? '').split(/\n+/).map(line => line.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
  const showList = bullets.length > 1;
  const hasDetails = (!showList && !!card.body) || !!card.why || card.handled;
  const act = (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError('');
    void operation().catch(reason => setError(String(reason))).finally(() => setBusy(false));
  };
  const action = card.action;
  return <article className="point-pulse-post" data-kind={kind}>
    <header>
      <h3>{card.title}</h3>
      {hasDetails && <Button variant="ghost" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen(!open)}>{t.more}</Button>}
    </header>
    <p className="point-pulse-status"><i aria-hidden="true" /><span>{t[kind as keyof typeof t] || kind}</span>
      {card.entity?.label && <span className="point-pulse-dot">{card.entity.label}</span>}
      {time && <span className="point-pulse-dot">{time}</span>}
    </p>
    {card.conclusion && <p className="point-pulse-body">{card.conclusion}</p>}
    {showList && <ul>{bullets.map((line, index) => <li key={index}>{line}</li>)}</ul>}
    <div className="point-pulse-actions">
      {action && (action.sessionId || action.prompt) && <Button disabled={busy} onClick={() => act(() => action.sessionId ? openAppSession(action.sessionId) : chat.compose(action.prompt!))}>{action.label}</Button>}
      {card.entity?.sessionId && card.entity.sessionId !== action?.sessionId && <Button disabled={busy} onClick={() => act(() => openAppSession(card.entity!.sessionId!))}>{t.openSession}</Button>}
    </div>
    {!!card.sources?.length && <div className="point-pulse-sources"><span>{t.sources}</span><ul>
      {card.sources.map((source, index) => <li key={index}>{source.sessionId
        ? <Button variant="ghost" disabled={busy} onClick={() => act(() => openAppSession(source.sessionId!))}>{source.label}</Button>
        : /^https?:\/\//i.test(source.url ?? '') ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a> : <span>{source.label}</span>}</li>)}
    </ul></div>}
    {error && <Feedback kind="error">{error}</Feedback>}
    {hasDetails && <div id={detailId} hidden={!open} className="point-pulse-detail">
      {!showList && card.body && <section><h4>{t.evidence}</h4><p>{card.body}</p></section>}
      {card.why && <section><h4>{t.why}</h4><p>{card.why}</p></section>}
      {card.handled && <p>{t.handled}</p>}
    </div>}
  </article>;
}

export function PulseHomeResult({ brief, createdAt, running, locale, state = 'ready' }: {
  brief?: ResultBrief | null; createdAt?: string; running?: boolean; locale: 'zh' | 'en'; state?: BriefState;
}) {
  const t = copy[locale], [feed, setFeed] = useState<Feed>('for-me');
  const stamp = when(createdAt);
  const day = createdAt && new Date(createdAt).toDateString() === new Date().toDateString();
  const tabs: [Feed, string][] = [['for-me', t.forMe], ['popular', t.popular], ['recent', t.recent]];
  return <section aria-label={t.title}>
    {running && <p className="point-pulse-muted" role="status">{t.generating}</p>}
    {!brief && !running && state !== 'ready' && state !== 'error' && <p className="point-pulse-muted" role="status">{state === 'loading' ? t.loading : state === 'no-agent' ? t.noAgent : t.notGenerated}</p>}
    <Tabs value={feed} onValueChange={next => setFeed(next as Feed)}>
      <TabsList className="point-pulse-tabs" aria-label={t.title}>{tabs.map(([id, label]) => <TabsTrigger key={id} value={id}>{label}</TabsTrigger>)}</TabsList>
      <div className="point-pulse-day"><span>{day || !stamp ? t.today : stamp}</span></div>
      {createdAt && <p className="point-pulse-generated">{t.generatedAt.replace('{time}', stamp)}</p>}
      {tabs.map(([id]) => {
        const cards = pulseFeed(brief?.cards ?? [], id) as ResultCard[];
        return <TabsContent key={id} value={id} forceMount>
          {brief && cards.length === 0 && <p className="point-pulse-muted">{id === 'popular' ? t.popularEmpty : id === 'recent' ? t.recentEmpty : t.personalEmpty}</p>}
          <div className="point-pulse-feed">{cards.map(card => <Post key={card.id} card={card} time={stamp} t={t} />)}</div>
          {brief?.tomorrow && id !== 'popular' && <section className="point-pulse-ahead"><h2>{t.ahead}</h2><p>{brief.tomorrow}</p></section>}
        </TabsContent>;
      })}
    </Tabs>
  </section>;
}
