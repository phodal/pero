import { openAppSession, useAppAgent, useAppI18n } from '@pero/app-sdk';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Feedback, LibraryHeader } from '@pero/app-sdk/ui';
import { analysisRequest, briefFromReply, briefResultPrompt } from './work-recap-model.mjs';
import { PulseHomeResult, type ResultBrief } from './pulse-home-result';
import type { RecapSession, RecapTurn, WorkRecap } from './pulse-work-recap';
import { ResearchUpdates } from './research-updates';
import { InsightsError } from './feedback';

type GenerationFailure = { kind: 'host'; message: string } | { kind: 'needs_input' | 'incomplete' };

type HostTurn = { status?: string; request?: string; response?: string; response_kind?: string; boundary?: string; seq_start?: number; seq_end?: number; truncated?: boolean };
type HostSession = {
  threadId?: string; app?: string; turn_count?: number; completed?: number; failed?: number; stopped?: number; tool_calls?: number;
  unfinished?: number; unknown_turns?: number; repository?: string;
  status?: string; response_kind?: string; request?: string; response?: string; turns?: HostTurn[];
  source?: { start_seq?: number; end_seq?: number; as_of_seq?: number; digest?: string };
};

function pointStatus(status: string | undefined): RecapTurn['status'] {
  if (status === 'completed' || status === 'failed' || status === 'unfinished' || status === 'unknown') return status;
  if (status === 'stopped') return 'unfinished';
  return 'unknown';
}

function pointKind(kind: string | undefined): RecapTurn['responseKind'] {
  return kind === 'final' || kind === 'intermediate' ? kind : 'unknown';
}

function toSession(session: HostSession): RecapSession {
  const turns: RecapTurn[] = (session.turns ?? []).map((turn, index) => ({
    turnId: `${session.threadId || 'session'}:${index + 1}`,
    status: pointStatus(turn.status),
    startSeq: turn.seq_start ?? 0,
    endSeq: turn.seq_end ?? 0,
    start: '',
    end: '',
    request: turn.request,
    response: turn.response,
    responseKind: pointKind(turn.response_kind),
    outcome: turn.status === 'stopped' ? 'stopped' : undefined,
    boundary: turn.boundary === 'explicit' ? 'explicit' : 'legacy',
    truncated: turn.truncated,
  }));
  const latest = turns.at(-1);
  return {
    sessionId: session.threadId || '',
    title: turns[0]?.request || session.threadId || '',
    repository: session.repository,
    turns,
    turnCount: session.turn_count ?? turns.length,
    status: pointStatus(session.status),
    outcome: session.status === 'stopped' ? 'stopped' : undefined,
    request: latest?.request ?? session.request,
    response: latest?.response ?? session.response,
    completedTurns: session.completed ?? 0,
    failedTurns: session.failed ?? 0,
    unfinishedTurns: session.unfinished ?? 0,
    unknownTurns: session.unknown_turns ?? 0,
    toolCalls: session.tool_calls ?? 0,
    updatedAt: '',
    truncated: turns.some(turn => turn.truncated),
    source: {
      kind: 'journal',
      startSeq: session.source?.start_seq ?? 0,
      endSeq: session.source?.end_seq ?? 0,
      asOfSeq: session.source?.as_of_seq ?? 0,
      digest: session.source?.digest ?? '',
      durable: true,
    },
  };
}

function toRecap(sessions: HostSession[], asOf: string): WorkRecap {
  const work = sessions.filter(session => session.app !== 'insights');
  const mapped = work.slice(-20).map(toSession);
  const omitted = work.length - mapped.length;
  return {
    date: '',
    timezone: '',
    start: '',
    end: '',
    asOf,
    scope: 'cumulative_host_journal',
    sessions: mapped,
    coverage: { examined: sessions.length, matched: work.length, shown: mapped.length, unreadable: 0, omitted, complete: omitted === 0 && !mapped.some(session => session.truncated) },
  };
}

export default function Insights() {
  const { t } = useAppI18n({ locale: { zh: 'zh', en: 'en' } });
  const locale = t('locale') === 'zh' ? 'zh' : 'en';
  const agent = useAppAgent();
  const [recap, setRecap] = useState<WorkRecap | null>(null);
  const [repositories, setRepositories] = useState<unknown[]>([]);
  const [conflicts, setConflicts] = useState<unknown[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [generationError, setGenerationError] = useState<GenerationFailure | null>(null);
  const [restoreError, setRestoreError] = useState('');
  const [brief, setBrief] = useState<ResultBrief | null>(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [running, setRunning] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const started = useRef(false);
  const inFlight = useRef(false), pendingSession = useRef('');
  const [generationSession, setGenerationSession] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'pero:app:location' || typeof event.data.location !== 'string') return;
      const match = /^brief\/([A-Za-z0-9_-]+)$/.exec(event.data.location);
      let thread = '';
      if (match) {
        try {
          thread = atob(match[1].replace(/-/g, '+').replace(/_/g, '/'));
        } catch { /* Invalid locations are reported by the recovery effect. */ }
      }
      started.current = true;
      setBrief(null);
      setGeneratedAt('');
      setGenerationError(null);
      setSelectedThread(thread);
      setAttempt(value => value + 1);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  useEffect(() => {
    if (selectedThread === '') {
      setError('');
      setRestoreError(locale === 'zh' ? '简报地址无效。' : 'The brief address is invalid.');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setError('');
    setRestoreError('');
    setLoading(true);
    fetch('/host/insights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error((await response.text()).slice(0, 500) || 'Insights failed');
        return response.json() as Promise<{ sessions?: HostSession[]; repositories?: unknown[]; conflicts?: unknown[] }>;
      })
      .then(async body => {
        if (controller.signal.aborted) return;
        setRepositories(Array.isArray(body.repositories) ? body.repositories : []);
        setConflicts(Array.isArray(body.conflicts) ? body.conflicts : []);
        const sessions = body.sessions ?? [];
        const history = sessions.filter(session => session.app === 'insights' && session.threadId && (selectedThread === null || session.threadId === selectedThread)).reverse();
        if (history.length || selectedThread !== null) started.current = true;
        setRecap(toRecap(sessions, new Date().toISOString()));
        let failure = '';
        for (const session of history) {
          if (controller.signal.aborted) return;
          if (session.status !== 'completed' || session.response_kind !== 'final') {
            failure = locale === 'zh' ? '历史会话尚未交付完整简报。' : 'A previous session has not delivered a complete brief.';
            continue;
          }
          try {
            const transcript = await agent.events({ sessionId: session.threadId!, after: 0 });
            if (controller.signal.aborted) return;
            const published = transcript.status === 'completed' ? briefFromReply(transcript.text) : null;
            if (!published) {
              failure = locale === 'zh' ? '已完成的会话缺少可读取的简报。' : 'A completed session has no readable brief.';
              continue;
            }
            setBrief(published);
            setGeneratedAt('');
            if (failure) setRestoreError(failure);
            return;
          } catch (reason) {
            failure = reason instanceof Error ? reason.message : String(reason);
          }
        }
        if ((history.length || selectedThread !== null) && !controller.signal.aborted) setRestoreError(failure || (locale === 'zh' ? '找不到已完成的简报。' : 'No completed brief was found.'));
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Insights failed'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt, selectedThread]);

  const modelReady = agent.available && agent.agents.some(item => item.available);
  const runAnalysis = (prompt: string) => {
    const agentId = agent.agents.find(item => item.available)?.id;
    if (!agentId || inFlight.current) return;
    inFlight.current = true;
    setGenerationError(null);
    setRunning(true);
    const requestId = `insights-${Date.now()}`;
    const session = pendingSession.current ? Promise.resolve({ sessionId: pendingSession.current }) : agent.start({ requestId, prompt, agentId });
    void session.then(async startedSession => {
      pendingSession.current = startedSession.sessionId;
      setGenerationSession(startedSession.sessionId);
      let cursor = 0, text = '', status = 'running';
      for (let i = 0; i < 90 && status === 'running' && mounted.current; i++) {
        const transcript = await agent.events({ sessionId: startedSession.sessionId, after: cursor });
        cursor = transcript.cursor;
        status = transcript.status;
        if (transcript.text) text = transcript.text;
        if (status !== 'running') break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!mounted.current) return;
      if (['completed', 'failed', 'cancelled'].includes(status)) { pendingSession.current = ''; setGenerationSession(''); }
      const published = briefFromReply(text);
      if (status !== 'completed' || !published) {
        setGenerationError({ kind: status === 'needs_input' ? 'needs_input' : 'incomplete' });
        return;
      }
      setGeneratedAt(new Date().toISOString());
      setBrief(published);
      setRestoreError('');
    }).catch(reason => {
      if (mounted.current) setGenerationError({ kind: 'host', message: reason instanceof Error ? reason.message : String(reason) });
    }).finally(() => {
      inFlight.current = false;
      if (mounted.current) setRunning(false);
    });
  };
  useEffect(() => {
    if (analysisRequest({ recapReady: !!recap, modelReady, started: started.current }) !== 'start' || !recap) return;
    started.current = true;
    runAnalysis(briefResultPrompt(recap, repositories, conflicts, locale));
  }, [recap, repositories, conflicts, modelReady, locale]);
  const waiting = loading || agent.infoLoading;
  const generateLabel = running ? (locale === 'zh' ? '正在更新…' : 'Updating…') : generationSession
    ? (locale === 'zh' ? '继续检查生成结果' : 'Check generation') : brief
    ? (locale === 'zh' ? '重新生成' : 'Regenerate') : generationError
    ? (locale === 'zh' ? '重试生成' : 'Retry generation') : (locale === 'zh' ? '生成简报' : 'Generate brief');
  const generate = <Button variant={brief ? 'secondary' : 'primary'} busy={running} disabled={waiting || !recap || !modelReady}
    onClick={() => recap && runAnalysis(briefResultPrompt(recap, repositories, conflicts, locale))}>{generateLabel}</Button>;
  const feedback = <>
    {error && <><InsightsError error={error} locale={locale} context="records" /><Button disabled={loading} onClick={() => { started.current = false; setAttempt(value => value + 1); }}>{locale === 'zh' ? '重试' : 'Retry'}</Button></>}
    {restoreError && <>
      <Feedback kind="warning" variant="block">{selectedThread !== null
        ? (locale === 'zh' ? '这份简报未能恢复。可重新读取，或生成一份新简报。' : 'This brief could not be restored. Reload it or generate a new brief.')
        : (locale === 'zh' ? '部分历史简报未能恢复。可重新读取，或生成一份新简报。' : 'Some previous briefs could not be restored. Reload them or generate a new brief.')}
        {brief && <span className="point-insights-error-hint">{locale === 'zh' ? '下方保留最近可读取的简报。' : 'The latest readable brief remains below.'}</span>}
      </Feedback>
      <details className="point-insights-diagnostics"><summary>{locale === 'zh' ? '技术详情' : 'Technical details'}</summary><pre>{restoreError.slice(0, 1000)}</pre></details>
      <Button disabled={loading} onClick={() => setAttempt(value => value + 1)}>{locale === 'zh' ? '重新读取' : 'Reload'}</Button>
    </>}
    {generationError && <>
      {generationError.kind === 'host' ? <InsightsError error={generationError.message} locale={locale} retained={!!brief} />
        : <Feedback kind="error" variant="block">
          {generationError.kind === 'needs_input'
            ? (locale === 'zh' ? '生成已暂停，需要在会话中补充信息。' : 'Generation paused and needs input in its session.')
            : (locale === 'zh' ? '上次生成未完成，请重试。' : 'The last brief did not complete. Please retry.')}
          {brief && <span className="point-insights-error-hint">{locale === 'zh' ? '下方保留上次生成的简报。' : 'The previous brief remains below.'}</span>}
        </Feedback>}
      {generationSession && <Button onClick={() => void openAppSession(generationSession).catch(reason => setGenerationError({ kind: 'host', message: String(reason) }))}>{locale === 'zh' ? '打开生成会话' : 'Open generation session'}</Button>}
    </>}
  </>;
  return <main className="point-pulse-page">
    <div className="point-pulse-main">
      <LibraryHeader className="point-pulse-top" title={locale === 'zh' ? '工作简报' : 'Work brief'}
        subtitle={brief ? undefined : locale === 'zh' ? '关注工作变化、待决事项与值得复核的结果。' : 'Changes, open decisions, and results worth reviewing.'}
        actions={brief && generate} />
      {brief ? <>
        <div className="point-insights-feedback">{feedback}</div>
        <PulseHomeResult brief={brief} createdAt={generatedAt || undefined} running={running} locale={locale} />
      </> : <Card tone="blue" variant="soft" className="point-insights-start">
        <h2>{locale === 'zh' ? '今天有哪些值得关注的事？' : 'What deserves your attention today?'}</h2>
        {error || restoreError || generationError ? <div className="point-insights-feedback">{feedback}</div>
          : waiting || running ? <Feedback kind="status">{waiting
            ? (locale === 'zh' ? '正在读取工作记录与 Agent 状态…' : 'Loading work records and Agent availability…')
            : (locale === 'zh' ? '正在整理工作记录，生成你的简报…' : 'Reading your work records and preparing your brief…')}</Feedback>
          : <p className="point-insights-start-copy">{!modelReady
            ? (locale === 'zh' ? '未连接可用 Agent。请先在设置 → 模型与 Agent 中配置，再检查连接。' : 'No Agent is connected. Connect an Agent to generate a brief.')
            : (locale === 'zh' ? '从工作会话和研究变化中整理重点，生成后可查看来源并继续处理。' : 'Bring together the important changes from your work and research, with sources you can review.')}</p>}
        <div className="point-insights-start-actions">{generate}
          {!modelReady && !waiting && <Button variant="ghost" onClick={() => void agent.refresh()}>{locale === 'zh' ? '检查 Agent 连接' : 'Check Agent connection'}</Button>}
        </div>
      </Card>}
      <ResearchUpdates hideEmpty={!!brief} />
    </div>
  </main>;
}
