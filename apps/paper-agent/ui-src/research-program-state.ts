import { useCallback, useEffect, useRef, useState } from 'react';
import { useHostCapability, type AppAgentRun, type AppAgentScope } from '@pero/app-sdk';
import type { Api, Paper } from './types';

export type Limits = { rounds: number; searches: number; candidates: number; reads: number; downloads: number; downloadBytes: number; modelRequests: number; appCalls: number };
export type Page = { offset: number; total: number; nextOffset: number | null };
type Candidate = { id: string; title: string; url: string; decision: string; reason: string; blocker: string | null; documentId: string | null };
type Round = { id: string; number: number; question: string; claims: { text: string; stance: string; quote: string; reportId: string; passageId?: string; sourceKind?: string; sourceUrl?: string }[]; gaps: string[]; nextAction: string; newEvidence: number };
export type Program = {
  id: string; checkpoint: string;
  protocol: { question: string; scope: string; inclusion: string; exclusion: string; seedPaperIds: string[]; acquisition: string; limits: Limits; deadline: string };
  candidatePage?: Page; roundPage?: Page; usage: Omit<Limits, 'modelRequests'>;
  runtime: { status: string; modelRequestsUsed: number; appCallsUsed: number } | null;
  candidates: Candidate[]; rounds: Round[]; gaps: string[]; stopReason: string | null;
  jobs: { id: string; status: string; input: { operation: string; query?: { query?: string; relation?: string } }; error: string; outcome?: { status: string; errors: { source: string; error: string }[]; warnings: { source: string; message: string }[] } }[];
};
export type ProgramSummary = Pick<Program, 'id' | 'checkpoint' | 'protocol' | 'usage' | 'stopReason'>;

const errorText = (value: unknown) => value instanceof Error ? value.message : String(value);

/** The mounted workspace retains the draft; read-only history never requires an Agent. */
export function useResearchProgramState(api: Api, seed: Paper | null, visible = true) {
  const agent = useHostCapability('agent');
  const createId = useRef(crypto.randomUUID()), listRequest = useRef(0), selectionRequest = useRef(0);
  const [programs, setPrograms] = useState<ProgramSummary[]>([]), [selected, setSelected] = useState<Program | null>(null), [run, setRun] = useState<AppAgentRun | null>(null);
  const [scope, setScope] = useState<AppAgentScope | null>(null), [available, setAvailable] = useState(false), [busy, setBusy] = useState(false);
  const [listLoading, setListLoading] = useState(false), [listLoaded, setListLoaded] = useState(false), [listError, setListError] = useState('');
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false), [capabilityError, setCapabilityError] = useState('');
  const [runLookupReady, setRunLookupReady] = useState(false);
  const [readLoading, setReadLoading] = useState(false), [selectionLoading, setSelectionLoading] = useState(false), [readError, setReadError] = useState(''), [actionError, setError] = useState('');
  const [failedSelection, setFailedSelection] = useState<ProgramSummary | null>(null), [selectionError, setSelectionError] = useState('');
  const [seeds, setSeeds] = useState<string[]>(seed ? [seed.id] : []), [question, setQuestion] = useState(''), [researchScope, setResearchScope] = useState(''), [inclusion, setInclusion] = useState(''), [exclusion, setExclusion] = useState('');
  const [candidateOffset, setCandidateOffset] = useState(0), [roundOffset, setRoundOffset] = useState(0), [listNext, setListNext] = useState<number | null>(null);
  const [acquisition, setAcquisition] = useState('saved_only'), [limits, setLimits] = useState({ rounds: 3, searches: 8, reads: 24, modelRequests: 40 }), [minutes, setMinutes] = useState(30);
  const [revision, setRevision] = useState(0);
  const active = !!run && ['running', 'cancelling', 'needs_input'].includes(run.status);
  const expired = !!selected && Date.now() >= Date.parse(selected.protocol.deadline);

  const reload = useCallback(async () => {
    const request = ++listRequest.current;
    setListLoading(true); setListError(''); setCapabilitiesLoading(true); setCapabilityError('');
    const [list, workspaces, harnesses] = await Promise.allSettled([
      api.post<{ programs: ProgramSummary[]; page?: Page }>('/api/programs', { operation: 'list' }),
      api.get<{ items: { workspaceId: string }[] }>('/api/workspaces'),
      api.get<{ items: { id: string; available: boolean }[] }>('/api/harnesses'),
    ]);
    if (request !== listRequest.current) return;
    if (list.status === 'fulfilled') {
      setPrograms(list.value.programs); setListNext(list.value.page?.nextOffset ?? null); setListLoaded(true);
    } else setListError(errorText(list.reason));
    if (workspaces.status === 'fulfilled') setScope(workspaces.value.items[0] ? { workspaceId: workspaces.value.items[0].workspaceId } : null);
    else { setScope(null); setCapabilityError(errorText(workspaces.reason)); }
    if (harnesses.status === 'fulfilled') setAvailable(harnesses.value.items.some(item => item.id === 'pero' && item.available));
    else { setAvailable(false); setCapabilityError(errorText(harnesses.reason)); }
    setListLoading(false); setCapabilitiesLoading(false); setRevision(value => value + 1);
  }, [api]);

  useEffect(() => {
    if (visible) void reload();
    return () => { listRequest.current++; };
  }, [visible, reload]);
  useEffect(() => {
    if (seed) {
      setSeeds(items => items.includes(seed.id) || items.length >= 5 ? items : [...items, seed.id]);
      newPlan();
    }
  }, [seed?.id]);

  useEffect(() => {
    if (!selected || !visible || busy) { setReadLoading(false); return; }
    let alive = true, timer: ReturnType<typeof setTimeout>;
    const id = selected.id;
    let failures = 0;
    async function poll() {
      setReadLoading(true); setRunLookupReady(false);
      let saved: Program;
      try {
        saved = await api.post<Program>('/api/programs', { operation: 'read', programId: id, offset: candidateOffset, roundOffset, roundLimit: 1 });
        if (!alive) return;
        setReadError(''); setSelected(saved); setPrograms(items => items.map(item => item.id === id ? saved : item));
      } catch (reason) {
        if (alive) {
          setReadError(errorText(reason));
          if (active) timer = setTimeout(() => void poll(), Math.min(30000, 2000 * 2 ** failures++));
        }
        return;
      } finally { if (alive) setReadLoading(false); }
      if (!agent || !scope) return;
      try {
        const lookup = await agent.call<{ run: AppAgentRun | null }>('lookup', { scope, requestId: id });
        let next = lookup.run ? await agent.call<AppAgentRun>('status', { scope, runId: lookup.run.id }) : null;
        if (!alive) return;
        if (saved.stopReason === 'user_stopped' && next && ['running', 'needs_input'].includes(next.status))
          next = await agent.call<AppAgentRun>('cancel', { scope, runId: next.id });
        if (!alive) return;
        failures = 0; setCapabilityError(''); setRun(next);
        setRunLookupReady(!!next || !saved.runtime);
        if (next && ['running', 'cancelling', 'needs_input'].includes(next.status)) timer = setTimeout(() => void poll(), 2000);
      } catch (reason) {
        if (alive) { setCapabilityError(errorText(reason)); timer = setTimeout(() => void poll(), Math.min(30000, 2000 * 2 ** failures++)); }
      }
    }
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [api, selected?.id, scope?.workspaceId, agent, run?.attempt, active, busy, candidateOffset, roundOffset, visible, revision]);

  async function perform(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  async function save() {
    const saved = await api.post<Program>('/api/programs', { operation: 'create', requestId: createId.current, question, scope: researchScope, inclusion, exclusion, seedPaperIds: seeds, acquisition, limits, minutes });
    selectionRequest.current++; setRunLookupReady(false); setFailedSelection(null); setSelectionError('');
    setCandidateOffset(0); setRoundOffset(0); setReadError(''); setSelected(saved); setRun(null); setPrograms(items => [saved, ...items.filter(item => item.id !== saved.id)]);
  }
  async function start() {
    if (!agent || !scope || !selected || !runLookupReady || run) return;
    const launch = await api.post<{ context: Record<string, unknown>; prompt: string }>('/api/programs', { operation: 'launch', programId: selected.id });
    const next = await agent.call<AppAgentRun>('start', { scope, requestId: selected.id, harnessId: 'pero', text: launch.prompt, context: launch.context });
    setRun(next); await agent.call('open', { sessionId: next.sessionId });
  }
  async function control(action: 'cancel' | 'retry' | 'stop') {
    if (!agent || !scope || !run || !selected) return;
    if (action === 'stop') {
      const saved = await api.post<Program>('/api/programs', { operation: 'stop', programId: selected.id, operationId: crypto.randomUUID() });
      setSelected(saved); setRun(await agent.call<AppAgentRun>('cancel', { scope, runId: run.id }));
    } else setRun(await agent.call<AppAgentRun>(action, { scope, runId: run.id, ...(action === 'retry' ? { requestId: crypto.randomUUID() } : {}) }));
  }
  function newPlan() {
    selectionRequest.current++; setSelectionLoading(false);
    setRunLookupReady(false); setFailedSelection(null); setSelectionError('');
    setSelected(null); setRun(null); setError(''); setReadError(''); createId.current = crypto.randomUUID();
  }
  async function selectProgram(program: ProgramSummary) {
    const request = ++selectionRequest.current;
    setSelectionLoading(true); setReadError(''); setError(''); setRunLookupReady(false); setFailedSelection(null); setSelectionError('');
    try {
      const detail = await api.post<Program>('/api/programs', { operation: 'read', programId: program.id, offset: 0, roundOffset: 0, roundLimit: 1 });
      if (request !== selectionRequest.current) return;
      setCandidateOffset(0); setRoundOffset(0); setSelected(detail); setRun(null); setFailedSelection(null); setSelectionError('');
    } catch (reason) { if (request === selectionRequest.current) { setFailedSelection(program); setSelectionError(errorText(reason)); } }
    finally { if (request === selectionRequest.current) setSelectionLoading(false); }
  }
  async function retryRead() {
    if (failedSelection) { await selectProgram(failedSelection); return; }
    if (!selected) { await reload(); return; }
    const request = selectionRequest.current;
    const detail = await api.post<Program>('/api/programs', { operation: 'read', programId: selected.id, offset: candidateOffset, roundOffset, roundLimit: 1 });
    if (request !== selectionRequest.current) return;
    setReadError(''); setSelected(detail); setRevision(value => value + 1);
  }
  async function morePrograms() {
    if (listNext === null) return;
    const page = await api.post<{ programs: ProgramSummary[]; page: Page }>('/api/programs', { operation: 'list', offset: listNext });
    setPrograms(items => [...items, ...page.programs]); setListNext(page.page.nextOffset);
  }
  return {
    agent, programs, selected, run, scope, available, busy, loading: listLoading, listLoading, listLoaded, listRefreshing: listLoading && listLoaded, listError,
    capabilityError, capabilitiesLoading, runLookupReady, readLoading: readLoading || selectionLoading, error: actionError || selectionError || readError, setError, failedSelection,
    seeds, setSeeds, question, setQuestion, researchScope, setResearchScope, inclusion, setInclusion, exclusion, setExclusion,
    acquisition, setAcquisition, limits, setLimits, minutes, setMinutes, candidateOffset, setCandidateOffset, roundOffset, setRoundOffset, listNext,
    active, expired, reload, perform, save, start, control, newPlan, selectProgram, retryRead, morePrograms,
  };
}
