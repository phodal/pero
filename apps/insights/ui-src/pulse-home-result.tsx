import { useId, useState } from 'react';
import { openAppSession, useAppChat, useAppObject } from '@pero/app-sdk';
import { Disclosure, Badge, Button, Card, CardHeader, EmptyIllustration, EmptyState, Icon } from '@pero/app-sdk/ui';
import { cardKind, projectBrief } from './work-recap-model.mjs';
import { InsightsError } from './feedback';
import { RichText } from './rich-text';
import './pulse-home-result.css';

const copy = {
  zh: {
    engineering: '工程进展', research: '研究进展', title: 'Insights', summary: 'AI 工作摘要', findings: '关键结论', attention: '需要你决定', discussion: '继续讨论',
    openSession: '打开会话', ahead: '接下来', generatedAt: '生成于 {time}', personalEmpty: '暂无新的个人工作更新。',
    legacy: '这份历史简报尚无综合摘要，已有发现与来源仍可查看。',
    summaryNote: '关键结论可沿来源回查；会话完成不代表成果已验收。',
    discuss: '讨论这份简报', continueQuestion: '哪些工作可以继续？', verifyQuestion: '哪些结论还需要核对？',
    discussHint: '带上这份简报和原始来源，继续同一条讨论。',
    original: '原始简报', originalNote: '以下是保存的模型内容，不表示已重新核验当前状态。',
    generating: '正在更新简报，当前内容继续保留。',
    evidence: '依据', why: '为什么给你看', sources: '来源', handled: 'Agent 报告已完成', more: '查看依据',
    needs_you: '需要你', risk: '风险', change: '变化', done: '已完成', watch: '待复核', filtered: '已过滤',
    sessionSource: '会话', webSource: '网页',
  },
  en: {
    engineering: 'Engineering', research: 'Research', title: 'Insights', summary: 'AI work summary', findings: 'Key findings', attention: 'Needs your decision', discussion: 'Continue the conversation',
    openSession: 'Open session', ahead: 'Ahead', generatedAt: 'Generated at {time}', personalEmpty: 'No new personal work updates.',
    legacy: 'A summary is not available for this saved brief. Its findings and sources remain available.',
    summaryNote: 'Follow the sources to review each conclusion; a completed conversation is not result acceptance.',
    discuss: 'Discuss this brief', continueQuestion: 'Which work can continue?', verifyQuestion: 'Which conclusions still need checking?',
    discussHint: 'Continue with this brief and its original sources as context.',
    original: 'Original brief', originalNote: 'This is saved model content, not a fresh verification of the current state.',
    generating: 'Updating your brief. The current edition is kept.',
    evidence: 'Evidence', why: 'Why you are seeing this', sources: 'Sources', handled: 'Agent reported this done', more: 'View evidence',
    needs_you: 'Needs you', risk: 'Risk', change: 'Change', done: 'Done', watch: 'To review', filtered: 'Filtered',
    sessionSource: 'Session', webSource: 'Web source',
  },
};

export type ResultCard = {
  id: string; topic?: string; topicType?: 'engineering' | 'research' | 'general'; kind?: string; title: string; conclusion?: string; body?: string; why?: string; impact?: string; handled?: boolean;
  entity?: { type?: string; id?: string; label: string; sessionId?: string } | null;
  action?: { label: string; sessionId?: string; prompt?: string } | null;
  sources?: { label: string; url?: string; sessionId?: string }[];
};
export type ResultBrief = {
  summary?: string; cards: ResultCard[]; tomorrow?: string;
};

function when(value: string | undefined, locale: 'zh' | 'en') {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date().toDateString() === date.toDateString()
    ? date.toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Post({ card, t, locale }: { card: ResultCard; t: typeof copy.zh; locale: 'zh' | 'en' }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const detailId = useId(), chat = useAppChat();
  const kind = cardKind(card);
  const hasDetails = (!!card.conclusion && !!card.body) || !!card.why || card.handled;
  const objectNames: Record<string, string> = locale === 'zh'
    ? { session: '会话', pr: 'PR', issue: '问题', commit: '提交', file: '文件', meeting: '会议', automation: '自动化', branch: '分支', project: '项目' }
    : { session: 'Session', pr: 'PR', issue: 'Issue', commit: 'Commit', file: 'File', meeting: 'Meeting', automation: 'Automation', branch: 'Branch', project: 'Project' };
  const objectLabel = card.entity?.label === card.entity?.type ? objectNames[card.entity?.label ?? ''] : card.entity?.label;
  const act = (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError('');
    void operation().catch(reason => setError(String(reason))).finally(() => setBusy(false));
  };
  const action = card.action;
  const showMeta = !!card.sources?.length || hasDetails;
  return <article className="point-pulse-post" data-kind={kind}>
    <header className="point-pulse-post-head">
      <div className="point-pulse-post-title">
        <h3>{card.title}</h3>
        {objectLabel && <p className="point-pulse-object">{objectLabel}</p>}
      </div>
      <Badge tone={kind === 'needs_you' || kind === 'risk' ? 'warning' : kind === 'change' ? 'info' : 'neutral'}>{t[kind as keyof typeof t] || kind}</Badge>
    </header>
    {card.conclusion && <p className="point-pulse-body">{card.conclusion}</p>}
    {!card.conclusion && card.body && <RichText text={card.body} />}
    <div className="point-pulse-actions">
      {action && (action.sessionId || action.prompt) && <Button variant="link" disabled={busy} onClick={() => act(() => action.sessionId ? openAppSession(action.sessionId) : chat.compose(action.prompt!))}>{action.label}</Button>}
      {card.entity?.sessionId && card.entity.sessionId !== action?.sessionId && <Button variant="link" disabled={busy} onClick={() => act(() => openAppSession(card.entity!.sessionId!))}>{t.openSession}</Button>}
    </div>
    {showMeta && <div className="point-pulse-meta">
      {!!card.sources?.length && <div className="point-pulse-sources"><span>{t.sources}</span><ul>
        {card.sources.map((source, index) => <li key={index}>{source.sessionId
          ? <Button variant="link" disabled={busy} title={source.sessionId} onClick={() => act(() => openAppSession(source.sessionId!))}>{source.label === source.sessionId ? `${t.sessionSource} ${index + 1}` : source.label}</Button>
          : /^https?:\/\//i.test(source.url ?? '') ? <a href={source.url} title={source.url} target="_blank" rel="noopener noreferrer">{source.label === source.url ? `${t.webSource} ${index + 1}` : source.label}</a> : <span>{source.label}</span>}</li>)}
      </ul></div>}
      {hasDetails && <Button variant="ghost" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen(!open)}>{t.more}</Button>}
    </div>}
    {error && <InsightsError error={error} locale={locale} context="action" />}
    {hasDetails && <div id={detailId} hidden={!open} className="point-pulse-detail">
      {card.conclusion && card.body && <section><h4>{t.evidence}</h4><RichText text={card.body} /></section>}
      {card.why && <section><h4>{t.why}</h4><RichText text={card.why} /></section>}
      {card.handled && <p>{t.handled}</p>}
    </div>}
  </article>;
}

export function PulseHomeResult({ brief, createdAt, running, locale }: {
  brief: ResultBrief; createdAt?: string; running?: boolean; locale: 'zh' | 'en';
}) {
  const t = copy[locale], chat = useAppChat(), id = useId();
  useAppObject({ id: 'insights-brief', kind: 'work-brief', label: locale === 'zh' ? '工作简报' : 'Work brief', state: brief });
  const [discussing, setDiscussing] = useState(false), [discussionError, setDiscussionError] = useState('');
  const [originalOpen, setOriginalOpen] = useState(false);
  const edition = projectBrief(brief);
  const stamp = when(createdAt, locale);
  const summary = brief.summary?.trim() ?? '';
  const discuss = (question: string) => {
    if (discussing) return;
    setDiscussing(true); setDiscussionError('');
    void chat.compose(question, { attachments: [chat.objectReference('insights-brief')] })
      .catch(reason => setDiscussionError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setDiscussing(false));
  };
  if (!brief.cards.length && !brief.tomorrow && !summary) return <section className="point-insights-empty-result" aria-label={t.title}>
    <EmptyState icon={<EmptyIllustration kind="brief"/>} description={t.personalEmpty}/>
    {running && <p className="point-pulse-muted" role="status">{t.generating}</p>}
    {createdAt && <p className="point-pulse-generated">{t.generatedAt.replace('{time}', stamp)}</p>}
  </section>;
  return <section aria-label={t.title}>
    {running && <p className="point-pulse-muted" role="status">{t.generating}</p>}
    <div className="point-brief-layout" data-attention={edition.needCards.length ? 'true' : undefined}>
      <section className="point-brief-summary" aria-labelledby={`${id}-summary`}>
        <div className="point-brief-summary-head"><h2 id={`${id}-summary`}><Icon name="ai-sparkles" size={16}/>{t.summary}</h2>
          {createdAt && <p className="point-pulse-generated">{t.generatedAt.replace('{time}', stamp)}</p>}
        </div>
        {summary ? <><div className="point-brief-summary-text"><RichText text={summary} /></div><p className="point-brief-summary-note">{t.summaryNote}</p></>
          : <p className="point-brief-legacy-note">{t.legacy}</p>}
      </section>
      {!!edition.needCards.length && <Card asChild tone="apricot" variant="soft" className="point-brief-attention"><aside aria-labelledby={`${id}-attention`}>
        <h2 id={`${id}-attention`} className="point-brief-section-title">{t.attention}</h2>
        {edition.needCards.map((card: ResultCard) => <Post key={card.id} card={card} t={t} locale={locale} />)}
      </aside></Card>}
      {!!edition.cards.length && <section className="point-brief-findings" aria-labelledby={`${id}-findings`}>
        <h2 id={`${id}-findings`} className="point-brief-section-title">{t.findings}</h2>
        <div className="point-brief-topics">{edition.topics.map(topic => <Card asChild key={`${topic.type}:${topic.label}`} className="point-brief-topic"><section aria-label={topic.type === 'general' ? topic.label || undefined : t[topic.type]}>
          <CardHeader tone={topic.type === 'engineering' ? 'blue' : topic.type === 'research' ? 'apricot' : 'neutral'}>
            <h2 className="point-brief-topic-title">{topic.type === 'general' ? topic.label || t.findings : t[topic.type]}</h2>
          </CardHeader>
          <div className="point-pulse-feed">{topic.cards.map((card: ResultCard) => <Post key={card.id} card={card} t={t} locale={locale} />)}</div>
        </section></Card>)}</div>
      </section>}
      <section className="point-brief-discussion" aria-labelledby={`${id}-discussion`}>
        <div className="point-brief-discussion-head"><div><h2 id={`${id}-discussion`}>{t.discussion}</h2><p>{t.discussHint}</p></div>
          <Button variant="primary" busy={discussing} onClick={() => discuss(t.discuss)}>{t.discuss}</Button>
        </div>
        <div className="point-brief-questions">{[t.continueQuestion, t.verifyQuestion].map(question => <Button key={question} disabled={discussing} onClick={() => discuss(question)}>{question}</Button>)}</div>
        {discussionError && <InsightsError error={discussionError} locale={locale} context="action" />}
        {brief.tomorrow && <section className="point-pulse-ahead"><h3>{t.ahead}</h3><ul>{brief.tomorrow.split(/\n+/).filter(line => line.trim()).map((line, index) => <li key={index}>{line}</li>)}</ul></section>}
        <Disclosure variant="inline" className="point-insights-diagnostics" onOpenChange={setOriginalOpen} summary={<>{t.original}</>}>
          {originalOpen && <><p>{t.originalNote}</p><pre>{JSON.stringify(brief, null, 2)}</pre></>}
        </Disclosure>
      </section>
    </div>
  </section>;
}
