import { useEffect, useRef, useState } from 'react';
import type { Agent, Api, Intent, Report } from './types';
import type { Translator } from './i18n';

export type ResearchRequest = { question: string; paperIds: string[]; verifyCode: boolean; verificationPlan: string; fullText?: boolean; parentIntentId?: string };
type ResearchStage = { stage: 'plan' | 'select' | 'answer'; id: string; requestId: string; prompt: string; question: string; round?: number; intent?: Intent };

export function useResearch(api: Api, agent: Agent, active: boolean, refresh: () => Promise<void>, onError: (error: unknown) => void, t: Translator) {
  const [plannedQuestion, setPlannedQuestion] = useState(''), [phase, setPhase] = useState<ResearchStage['stage']>('answer');
  const stage = useRef<ResearchStage | null>(null), selectedAgent = useRef('');
  const [intent, setIntent] = useState<Intent | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [raw, setRaw] = useState('');
  const [repair, setRepair] = useState(false);
  const [pollRevision, setPollRevision] = useState(0);
  const mounted = useRef(true), gate = useRef(false), generation = useRef(0), cursor = useRef(0);
  const pollIdentity = useRef(0);
  const working = ['running', 'needs_input', 'cancelling'].includes(status);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  const current = (id: number) => mounted.current && generation.current === id;

  async function save(text: string, frozen = intent, session = sessionId) {
    if (!frozen) return;
    const id = generation.current;
    const saved = await api.post<Report>('/api/reports', { intentId: frozen.id, text, ...(session ? { sessionId: session } : {}) });
    const full = saved.sections ? saved : await api.get<Report>(`/api/reports/${saved.id}`);
    if (current(id)) { setReport(full); setRepair(false); await refresh(); }
    return full;
  }
  async function launchStage(next: ResearchStage, agentId: string) {
    stage.current = next; selectedAgent.current = agentId;
    setPhase(next.stage); setPlannedQuestion(next.question); setRaw(''); setPending(true); setBusy(true);
    if (next.intent) setIntent(next.intent);
    try {
      const run = await agent.start({ requestId: next.requestId, prompt: next.prompt, agentId });
      if (!mounted.current) return;
      setSessionId(run.sessionId); cursor.current = 0; setStatus('running'); setPending(false);
    } finally { if (mounted.current) setBusy(false); }
  }
  async function begin(input: ResearchRequest, agentId: string, execute: boolean) {
    if (gate.current || working) return;
    gate.current = true; setBusy(true); const id = ++generation.current;
    try {
      if (pending && stage.current) { await launchStage(stage.current, selectedAgent.current); return true; }
      if (input.fullText) await Promise.all(input.paperIds.map(paperId => api.post('/api/pdf', { paperId })));
      const request = { ...input, requestId: crypto.randomUUID() };
      if (execute && input.fullText) {
        const planned = await api.post<ResearchStage>('/api/research/plan', request);
        if (!current(id)) return;
        setIntent(null); setReport(null); setRepair(false);
        await launchStage(planned, agentId);
      } else {
        const frozen = await api.post<Intent>('/api/intents', request);
        if (!current(id)) return;
        setIntent(frozen); setReport(null); setRaw(''); setRepair(false); setSessionId(''); setStatus(''); setPlannedQuestion('');
        await refresh();
        if (!current(id) || !execute) return true;
        await launchStage({ stage: 'answer', id: frozen.id, requestId: frozen.requestId, prompt: frozen.prompt, question: frozen.question, intent: frozen }, agentId);
      }
      return true;
    } catch (error) { if (current(id)) onError(error); }
    finally { gate.current = false; if (current(id)) setBusy(false); }
  }
  useEffect(() => {
    if (!active || !sessionId || !working) return;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const id = generation.current, identity = ++pollIdentity.current;
    async function poll() {
      try {
        const reply = await agent.events({ sessionId, after: cursor.current });
        if (stopped || !current(id) || identity !== pollIdentity.current) return;
        cursor.current = reply.cursor; setStatus(reply.status);
        if (reply.text) setRaw(reply.text);
        if (reply.status === 'failed') onError(new Error(reply.text || t('failed')));
        if (reply.status === 'completed') {
          if (!reply.text?.trim()) throw new Error(t('noFinal'));
          try {
            const currentStage = stage.current;
            if (currentStage && currentStage.stage !== 'answer') {
              setBusy(true);
              const next = await api.post<ResearchStage>(currentStage.stage === 'plan' ? '/api/research/search' : '/api/research/select', { id: currentStage.id, text: reply.text });
              if (!stopped && current(id)) { await launchStage(next, selectedAgent.current); await refresh(); }
            } else { await save(reply.text, intent, sessionId); }
          } catch (error) {
            if (!stopped && current(id)) { setBusy(false); setStatus('failed'); setRepair(stage.current?.stage === 'answer'); onError(error); }
          }
        } else if (['running', 'needs_input', 'cancelling'].includes(reply.status)) timer = setTimeout(poll, 1000);
      } catch (error) {
        if (!stopped && current(id)) { onError(error); setStatus('failed'); }
      }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [active, agent, sessionId, intent?.id, pollRevision]);

  async function cancel() {
    if (!sessionId || busy) return;
    setBusy(true);
    try { await agent.cancel({ sessionId }); setStatus('cancelling'); setPollRevision(value => value + 1); }
    catch (error) { onError(error); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function openReport(id: string) {
    if (gate.current || working || pending) return;
    gate.current = true; setBusy(true); const version = ++generation.current;
    try {
      const full = await api.get<Report>(`/api/reports/${id}`);
      const frozen = await api.get<Intent>(`/api/intents/${full.intentId}`);
      if (current(version)) { setReport(full); setIntent(frozen); setSessionId(''); setRaw(''); setRepair(false); setStatus(''); setPlannedQuestion(''); stage.current = null; }
    } catch (error) { if (current(version)) onError(error); }
    finally { gate.current = false; if (current(version)) setBusy(false); }
  }
  async function openIntent(id: string) {
    if (gate.current || working || pending) return;
    gate.current = true; setBusy(true); const version = ++generation.current;
    try {
      const frozen = await api.get<Intent>(`/api/intents/${id}`);
      if (current(version)) { setIntent(frozen); setReport(null); setSessionId(''); setRaw(''); setRepair(false); setStatus(''); setPlannedQuestion(''); stage.current = null; }
    } catch (error) { if (current(version)) onError(error); }
    finally { gate.current = false; if (current(version)) setBusy(false); }
  }
  async function saveRaw() {
    if (gate.current || !intent || !raw.trim() || working) return;
    gate.current = true; setBusy(true);
    try { await save(raw); }
    catch (error) { setRepair(true); onError(error); }
    finally { gate.current = false; if (mounted.current) setBusy(false); }
  }
  function reset() {
    if (working || pending || busy) return;
    generation.current++; stage.current = null; setPlannedQuestion(''); setIntent(null); setReport(null); setSessionId(''); setStatus(''); setRaw(''); setRepair(false);
  }
  return { retryPoll: () => { setStatus('running'); setPollRevision(value => value + 1); }, plannedQuestion, phase, intent, report, sessionId, status, busy, pending, working, raw, setRaw, repair, begin, cancel, openReport, openIntent, saveRaw, reset };
}
