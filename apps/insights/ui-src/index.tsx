import { useAppAgent, useAppI18n } from '@pero/app-sdk';
import { useEffect, useRef, useState } from 'react';
import { analysisRequest, briefFromReply, briefResultPrompt } from './work-recap-model.mjs';
import { PulseHomeResult, type ResultBrief } from './pulse-home-result';
import type { RecapSession, RecapTurn, WorkRecap } from './pulse-work-recap';

type HostTurn = { status?: string; request?: string; response?: string; response_kind?: string; boundary?: string; seq_start?: number; seq_end?: number; truncated?: boolean };
type HostSession = {
  threadId?: string; turn_count?: number; completed?: number; failed?: number; stopped?: number; tool_calls?: number;
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
    harnessId: 'Pero',
    turns,
    turnCount: session.turn_count ?? turns.length,
    status: pointStatus(session.status),
    outcome: session.status === 'stopped' ? 'stopped' : undefined,
    request: latest?.request ?? session.request,
    response: latest?.response ?? session.response,
    completedTurns: session.completed ?? 0,
    failedTurns: session.failed ?? 0,
    toolCalls: session.tool_calls ?? 0,
    updatedAt: '',
    truncated: false,
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

function toRecap(sessions: HostSession[]): WorkRecap {
  const now = new Date();
  const mapped = sessions.map(toSession);
  return {
    date: now.toLocaleDateString('sv-SE'),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    start: now.toISOString(),
    end: now.toISOString(),
    asOf: now.toISOString(),
    scope: 'host',
    sessions: mapped,
    coverage: { examined: mapped.length, matched: mapped.length, shown: mapped.length, unreadable: 0, omitted: 0, complete: true },
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
  const [brief, setBrief] = useState<ResultBrief | null>(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [running, setRunning] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetch('/host/insights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error((await response.text()).slice(0, 500) || 'Insights failed');
        return response.json() as Promise<{ sessions?: HostSession[]; repositories?: unknown[]; conflicts?: unknown[] }>;
      })
      .then(body => {
        if (controller.signal.aborted) return;
        setRepositories(Array.isArray(body.repositories) ? body.repositories : []);
        setConflicts(Array.isArray(body.conflicts) ? body.conflicts : []);
        setRecap(toRecap(body.sessions ?? []));
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Insights failed'); });
    return () => controller.abort();
  }, [attempt]);

  const modelReady = agent.available && agent.agents.some(item => item.available);
  const runAnalysis = (prompt: string) => {
    const agentId = agent.agents.find(item => item.available)?.id;
    if (!agentId) return;
    setBrief(null);
    setRunning(true);
    const requestId = `insights-${Date.now()}`;
    void agent.start({ requestId, prompt, agentId }).then(async startedSession => {
      let cursor = 0;
      let text = '';
      let status = 'running';
      for (let i = 0; i < 90 && status === 'running'; i++) {
        const transcript = await agent.events({ sessionId: startedSession.sessionId, after: cursor });
        cursor = transcript.cursor;
        status = transcript.status === 'needs_input' ? 'running' : transcript.status;
        if (transcript.text) text = transcript.text;
        if (status !== 'running') break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      setRunning(false);
      const published = briefFromReply(text);
      if (status === 'failed' || status === 'cancelled' || !published) {
        setError(locale === 'zh' ? '上次生成失败。' : 'The last brief failed.');
        return;
      }
      setGeneratedAt(new Date().toISOString());
      setBrief(published);
    }).catch(reason => {
      setRunning(false);
      setError(reason instanceof Error ? reason.message : (locale === 'zh' ? '上次生成失败。' : 'The last brief failed.'));
    });
  };
  useEffect(() => {
    if (analysisRequest({ recapReady: !!recap, modelReady, started: started.current }) !== 'start' || !recap) return;
    started.current = true;
    runAnalysis(briefResultPrompt(recap, repositories, conflicts, locale));
  }, [recap, repositories, conflicts, modelReady, locale]);
  return <div className="point-pulse-page">
    {error && <p className="point-pulse-banner" role="alert">{error} <button type="button" onClick={() => { started.current = false; setAttempt(value => value + 1); }}>{locale === 'zh' ? '重试' : 'Retry'}</button></p>}
    <PulseHomeResult brief={brief} createdAt={generatedAt || undefined} running={running} locale={locale} />
  </div>;
}
