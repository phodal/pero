import { useEffect, useRef, useState } from 'react';
import type { Agent, Api, Intent, Report } from './types';
import type { Translator } from './i18n';

export type ResearchRequest = { question: string; paperIds: string[]; verifyCode: boolean; verificationPlan: string; fullText?: boolean };
export function useResearch(api: Api, agent: Agent, active: boolean, refresh: () => Promise<void>, onError: (error: unknown) => void, t: Translator) {
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
  async function begin(input: ResearchRequest, agentId: string, execute: boolean) {
    if (gate.current || working) return;
    gate.current = true; setBusy(true); const id = ++generation.current;
    try {
      if (input.fullText && !pending) await Promise.all(input.paperIds.map(paperId => api.post('/api/pdf', { paperId })));
      const frozen = pending && intent ? intent : await api.post<Intent>('/api/intents', { ...input, requestId: crypto.randomUUID() });
      if (!current(id)) return;
      setIntent(frozen); setReport(null); setRaw(''); setRepair(false); setSessionId(''); setStatus('');
      await refresh();
      if (!current(id) || !execute) return frozen;
      setPending(true);
      const run = await agent.start({ requestId: frozen.requestId, prompt: frozen.prompt, agentId });
      if (!current(id)) return;
      setSessionId(run.sessionId); cursor.current = 0; setStatus('running'); setPending(false);
      return frozen;
    } catch (error) { if (current(id)) onError(error); }
    finally { gate.current = false; if (current(id)) setBusy(false); }
  }
  useEffect(() => {
    if (!active || !sessionId || !intent || !working) return;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const id = generation.current, identity = ++pollIdentity.current;
    async function poll() {
      try {
        const reply = await agent.events({ sessionId, after: cursor.current });
        if (stopped || !current(id) || identity !== pollIdentity.current) return;
        cursor.current = reply.cursor; setStatus(reply.status);
        if (reply.text) setRaw(reply.text);
        if (reply.status === 'completed') {
          if (!reply.text?.trim()) throw new Error(t('noFinal'));
          try { await save(reply.text, intent, sessionId); }
          catch (error) { if (!stopped && current(id)) { setRepair(true); onError(error); } }
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
      if (current(version)) { setReport(full); setIntent(frozen); setSessionId(''); setRaw(''); setRepair(false); setStatus(''); }
    } catch (error) { if (current(version)) onError(error); }
    finally { gate.current = false; if (current(version)) setBusy(false); }
  }
  async function openIntent(id: string) {
    if (gate.current || working || pending) return;
    gate.current = true; setBusy(true); const version = ++generation.current;
    try {
      const frozen = await api.get<Intent>(`/api/intents/${id}`);
      if (current(version)) { setIntent(frozen); setReport(null); setSessionId(''); setRaw(''); setRepair(false); setStatus(''); }
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
    generation.current++; setIntent(null); setReport(null); setSessionId(''); setStatus(''); setRaw(''); setRepair(false);
  }
  return { retryPoll: () => { setStatus('running'); setPollRevision(value => value + 1); }, intent, report, sessionId, status, busy, pending, working, raw, setRaw, repair, begin, cancel, openReport, openIntent, saveRaw, reset };
}
