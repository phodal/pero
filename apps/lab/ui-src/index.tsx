import React, { useCallback, useEffect, useRef, useState } from 'react';
import { appObjectProps, downloadFile, useAppApi, useAppChat, useAppDataChanged, useAppObject } from '@pero/app-sdk';
import { Button, Split, SplitPane, Tabs, TabsContent, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
import type { Comparison, Engine, Experiment, Protocol } from './types';
import { bytesToBase64, exampleProtocol } from './presentation';
import { Deck } from './deck';
import { Results, Timeline } from './evidence';
import './styles.css';

const emptySchema = { type: 'object', properties: {}, additionalProperties: false };
export default function Lab() {
  const api = useAppApi(), chat = useAppChat();
  const [history, setHistory] = useState<Experiment[]>([]), [engine, setEngine] = useState<Engine | null>(null);
  const [experiment, setExperiment] = useState<Experiment | null>(null), [trialId, setTrialId] = useState('');
  const [tab, setTab] = useState('deck'), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [objective, setObjective] = useState('Mix 100 µL in B1 with a measured red fraction of 0.5');
  const [target, setTarget] = useState('0.5'), [tolerance, setTolerance] = useState('0.05'), [budget, setBudget] = useState('4');
  const [draft, setDraft] = useState(JSON.stringify(exampleProtocol(), null, 2));
  const [parentId, setParentId] = useState(''), [reason, setReason] = useState('');
  const [source, setSource] = useState(''), [rationale, setRationale] = useState('');
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const selected = useRef(''), pending = useRef(false), fileInput = useRef<HTMLInputElement>(null);
  const trial = experiment?.trials.find(item => item.id === trialId);
  const running = experiment?.trials.some(item => item.status === 'running') ?? false;
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));
  const update = (next: Experiment) => {
    setExperiment(next);
    setHistory(items => [next, ...items.filter(item => item.id !== next.id)]);
    setTrialId(previous => next.trials.some(item => item.id === previous) ? previous : next.trials.at(-1)?.id ?? '');
  };
  const refresh = useCallback(async () => {
    const data = await api.get<{ experiments: Experiment[]; engine: Engine }>('/api/state');
    setHistory(data.experiments); setEngine(data.engine);
    if (selected.current) {
      const next = data.experiments.find(item => item.id === selected.current);
      if (next) setExperiment(next);
    }
  }, [api]);
  useEffect(() => { void refresh().catch(fail).finally(() => setLoading(false)); }, [refresh]);
  useAppDataChanged(async () => { try { await refresh(); } catch (cause) { fail(cause); } });
  useEffect(() => {
    if (!running) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(); } catch (cause) { if (!stopped) fail(cause); }
      if (!stopped) timer = setTimeout(() => void poll(), 500);
    };
    timer = setTimeout(() => void poll(), 500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [running, refresh]);
  async function perform(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (cause) { fail(cause); } finally { pending.current = false; setBusy(false); }
  }
  async function open(id: string) {
    await perform(async () => {
      const next = await api.get<Experiment>(`/api/experiments/${encodeURIComponent(id)}`);
      selected.current = id; update(next); setTrialId(next.trials.at(-1)?.id ?? ''); setComparison(null); setParentId(''); setReason('');
      setDraft(JSON.stringify(exampleProtocol(50, next.initial_state.revision), null, 2)); setTab('deck');
    });
  }
  async function freeze() {
    await perform(async () => {
      if (!objective.trim() || !target.trim() || !tolerance.trim() || !budget.trim()) throw new Error('Enter an objective, target, tolerance and trial budget.');
      const next = await api.post<Experiment>('/api/experiments', { objective, target_fraction: Number(target), tolerance: Number(tolerance), max_trials: Number(budget) });
      selected.current = next.id; update(next); setComparison(null); setTab('protocol');
      setDraft(JSON.stringify(exampleProtocol(50, next.initial_state.revision), null, 2)); setNotice('Objective, evaluation rules and initial state are frozen.');
    });
  }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!experiment) return;
    await perform(async () => {
      const next = await api.post<Experiment>(`/api/experiments/${experiment.id}/${action}`, { ...(trialId ? { trialId } : {}), ...extra });
      update(next);
      if (action === 'propose') { setTrialId(next.trials.at(-1)?.id ?? ''); setNotice('Candidate frozen. Validate before execution.'); }
      if (action === 'simulate') setTab('runs');
      if (action === 'observe' || action === 'evaluate') setTab('results');
    });
  }
  async function propose() {
    if (!experiment) return;
    await perform(async () => {
      let protocol: Protocol;
      try { protocol = JSON.parse(draft); } catch { throw new Error('Protocol must be valid JSON. No candidate was saved.'); }
      const next = await api.post<Experiment>(`/api/experiments/${experiment.id}/propose`, { protocol, ...(parentId ? { parentTrialId: parentId, reason } : { reason: reason || 'Initial candidate' }) });
      update(next); setTrialId(next.trials.at(-1)?.id ?? ''); setNotice('Candidate frozen. Validate before execution.');
    });
  }
  function revise() {
    if (!trial) return;
    setParentId(trial.id); setReason(''); setDraft(JSON.stringify(trial.protocol, null, 2)); setTab('protocol');
    setNotice('Editing a new candidate. The parent trial and its evidence will not change.');
  }
  async function importFile(file: File) {
    if (!experiment || !trial) return;
    await perform(async () => {
      if (!source.trim()) throw new Error('Describe the measurement source before importing.');
      if (file.size > 64 * 1024) throw new Error('Measurement file must be 64 KiB or smaller.');
      const content_base64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      update(await api.post<Experiment>(`/api/experiments/${experiment.id}/import`, { trialId: trial.id, filename: file.name, content_base64, source }));
      setNotice('Original bytes and digest saved as imported evidence.');
    });
    if (fileInput.current) fileInput.current.value = '';
  }
  async function review(decision: string) {
    if (!experiment || !trial) return;
    await perform(async () => {
      if (!rationale.trim()) throw new Error('Enter a review rationale.');
      update(await api.post<Experiment>(`/api/experiments/${experiment.id}/review`, { trialId: trial.id, decision, rationale })); setRationale('');
    });
  }
  useAppObject({ id: 'lab', kind: 'lab-experiment', label: 'Lab', state: {
    loading, busy, tab, experimentId: experiment?.id ?? null, specHash: experiment?.spec_hash ?? null,
    trialId: trial?.id ?? null, status: trial?.status ?? 'empty', verification: trial?.verification ?? null,
    engine, error: error || trial?.error || null,
    history: history.map(item => ({ id: item.id, objective: item.objective, trials: item.trials.length })),
    trials: experiment?.trials.map(item => ({ id: item.id, status: item.status, parent_trial_id: item.parent_trial_id, reason: item.reason, verification: item.verification })) ?? [],
  }, actions: {
    refresh: { description: 'Reload saved evidence without executing actions.', parameters: emptySchema, run: refresh },
    open_experiment: { description: 'Open saved experiment.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }, run: async ({ id }) => { if (!history.some(item => item.id === id)) throw new Error('Unknown experiment'); await open(String(id)); } },
    select_trial: { description: 'View a saved trial without execution.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }, run: ({ id }) => { if (!experiment?.trials.some(item => item.id === id)) throw new Error('Unknown trial'); setTrialId(String(id)); } },
    select_tab: { description: 'Show a Lab view.', parameters: { type: 'object', properties: { tab: { enum: ['deck', 'protocol', 'runs', 'results'] } }, required: ['tab'], additionalProperties: false }, run: ({ tab }) => { if (!['deck', 'protocol', 'runs', 'results'].includes(String(tab))) throw new Error('Unknown tab'); setTab(String(tab)); } },
  } });
  return <main className="lab" {...appObjectProps('lab')} aria-busy={loading || busy}>
    <header className="lab-header"><div><h1>Lab</h1><span className="muted">Color mixing</span></div><div className="toolbar">
      <Button disabled={busy || loading} onClick={() => { selected.current = ''; setExperiment(null); setTrialId(''); setParentId(''); setReason(''); setComparison(null); setError(''); setNotice(''); }}>New experiment</Button>
      <Button disabled={!experiment || busy} onClick={() => void perform(async () => { await chat.compose(`Help with Color Mixing experiment ${experiment!.id}. Read its frozen criteria and lab state using Lab's declared tools. Propose a bounded Protocol IR, validate and simulate with PyLabRobot Chatterbox only, attach explicitly synthetic observations or inspect imported evidence, independently evaluate, then propose a linked revision with a reason based on the discrepancy. Do not change frozen criteria or claim physical validity.`, { attachments: [chat.objectReference('lab')], approveGoal: true }); })}>Approve goal and ask Agent</Button>
      <Button disabled={busy || loading} onClick={() => void perform(refresh)}>Refresh</Button>
    </div></header>
    <p className="safety">Simulation only. The dye model is illustrative, not physical or biological validation.</p>
    {error && <div className="error" role="alert">{error} <Button onClick={() => void perform(refresh)} disabled={busy}>Retry connection</Button></div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {loading ? <p role="status">Loading saved experiments…</p> : <>
      <div className="context-row"><label>Saved experiments <select aria-label="Saved experiments" value={experiment?.id ?? ''} disabled={busy} onChange={event => { if (event.target.value) void open(event.target.value); }}><option value="">New experiment</option>{history.map(item => <option value={item.id} key={item.id}>{item.objective} ({item.trials.length} trials)</option>)}</select></label>
        <span className={engine?.available ? 'muted' : 'error'}>{engine?.name ?? 'Backend'} {engine?.version ?? ''}: {engine?.available ? 'Ready' : 'Unavailable'}</span></div>
      {engine?.error && <p className="error">{engine.error} Re-enable Lab after repairing its Host-managed Python environment.</p>}
      {!experiment ? <section className="new-experiment"><h2>New Color Mixing experiment</h2><p>Freeze the objective and evaluation rules before proposing a protocol. Each trial starts from the same frozen 96-well state.</p>
        <label>Objective<input value={objective} maxLength={500} onChange={event => setObjective(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void freeze(); }} /></label>
        <div className="fields"><label>Target red fraction<input type="number" min="0" max="1" step="0.01" value={target} onChange={event => setTarget(event.target.value)} /></label><label>Tolerance<input type="number" min="0" max="1" step="0.01" value={tolerance} onChange={event => setTolerance(event.target.value)} /></label><label>Maximum trials<input type="number" min="1" max="8" value={budget} onChange={event => setBudget(event.target.value)} /></label></div>
        <p className="muted">Target well B1; final volume 100 ± 1 µL. A1: 200 µL virtual red dye. A2: 200 µL diluent. 96 fresh tips; 64 steps per trial.</p>
        <Button variant="primary" busy={busy} onClick={() => void freeze()}>Freeze experiment</Button>
      </section> : <>
        <section className="experiment-heading"><h2>{experiment.objective}</h2><p className="muted">Frozen target: {experiment.criteria.target_well}, red fraction {experiment.criteria.target_fraction} ± {experiment.criteria.tolerance}; {experiment.criteria.target_volume_ul} µL. Trials {experiment.trials.length}/{experiment.max_trials}.</p>
          <div className="toolbar"><label>Trial <select aria-label="Trial" value={trialId} onChange={event => setTrialId(event.target.value)} disabled={busy}><option value="">Select trial</option>{experiment.trials.map((item, index) => <option value={item.id} key={item.id}>{index + 1}: {item.status}{item.parent_trial_id ? ' (revision)' : ''}</option>)}</select></label>
          <Button disabled={busy} onClick={() => void perform(async () => { const report = await api.get<unknown>(`/api/experiments/${experiment.id}/export`); downloadFile(`lab-${experiment.id}.json`, JSON.stringify(report, null, 2), 'application/json'); setNotice('Evidence report exported.'); })}>Export JSON</Button></div>
        </section>
        <Tabs value={tab} onValueChange={setTab}><TabsList aria-label="Experiment views">{['deck', 'protocol', 'runs', 'results'].map(value => <TabsTrigger key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</TabsTrigger>)}</TabsList>
          <TabsContent value="deck"><Deck state={trial?.final_state ?? experiment.initial_state} /></TabsContent>
          <TabsContent value="protocol"><Split storageKey="lab.protocol.panes" collapseBelow={760}>
            <SplitPane id="draft" min={300}><h2>{parentId ? 'Revision draft' : 'Candidate draft'}</h2><p className="muted">Typed JSON only. Saving creates an immutable candidate, never arbitrary Python.</p>
              <label>Protocol JSON<textarea className="protocol-editor" spellCheck={false} value={draft} onChange={event => setDraft(event.target.value)} disabled={busy || running} /></label>
              {parentId && <p>Parent trial: {parentId}</p>}
              <label>{parentId ? 'Revision rationale' : 'Candidate rationale'}<input value={reason} onChange={event => setReason(event.target.value)} disabled={busy || running} /></label>
              <div className="toolbar"><Button variant="primary" disabled={busy || running || experiment.trials.length >= experiment.max_trials || (!!parentId && !reason.trim())} onClick={() => void propose()}>Save candidate</Button><Button disabled={busy || running} onClick={() => { setDraft(JSON.stringify(exampleProtocol(50, experiment.initial_state.revision), null, 2)); }}>Load example protocol</Button></div>
            </SplitPane>
            <SplitPane id="candidate" min={240} size={360}><h2>Saved candidate</h2>{!trial ? <p>Save a candidate to validate its ordered steps.</p> : <><p>Status: {trial.status}</p>{trial.parent_trial_id && <p>Revises {trial.parent_trial_id}</p>}<p>{trial.reason}</p><ol className="steps">{trial.protocol.steps.map((step, i) => <li key={i}>{step.op.replaceAll('_', ' ')} {step.resource} {step.volume_ul != null ? `${step.volume_ul} µL` : ''}</li>)}</ol>{trial.error && <p className="error">{trial.error}</p>}
              <div className="toolbar"><Button disabled={busy || running || trial.status !== 'proposed'} onClick={() => void act('validate')}>Validate</Button><Button variant="primary" disabled={busy || running || trial.status !== 'validated' || !engine?.available} onClick={() => void act('simulate')}>Run simulation</Button><Button disabled={busy || running || !trial.verification} onClick={revise}>Revise candidate</Button></div></>}
            </SplitPane>
          </Split></TabsContent>
          <TabsContent value="runs">{running && <div className="toolbar"><p role="status">Simulation running; recording each step.</p><Button onClick={() => { if (experiment) void api.post<Experiment>(`/api/experiments/${experiment.id}/cancel`, { trialId }).then(update).catch(fail); }}>Cancel simulation</Button></div>}<Timeline trial={trial} /></TabsContent>
          <TabsContent value="results"><Results experiment={experiment} trial={trial} comparison={comparison} />
            <section className="result-actions"><h2>Attach and evaluate evidence</h2><p className="muted">Synthetic fixture adds a fixed +0.1 fraction bias to the prediction. It is not a measurement of real liquid.</p><div className="toolbar"><Button disabled={busy || trial?.status !== 'completed' || !!trial?.observations.length || !!trial?.verification} onClick={() => void act('observe')}>Attach synthetic fixture</Button><Button variant="primary" disabled={busy || !trial || ['proposed', 'validated', 'running'].includes(trial.status) || !!trial.verification} onClick={() => void act('evaluate')}>Evaluate</Button><Button disabled={busy || experiment.trials.length < 2} onClick={() => void perform(async () => { setComparison(await api.post<Comparison>(`/api/experiments/${experiment.id}/compare`, {})); })}>Compare trials</Button><Button disabled={busy || !trial?.verification || running} onClick={revise}>Revise from feedback</Button></div>
              <label>Measurement source<input value={source} placeholder="Instrument, dataset or laboratory record" onChange={event => setSource(event.target.value)} /></label><label>Import CSV or JSON<input ref={fileInput} type="file" accept=".csv,.json" disabled={busy || trial?.status !== 'completed' || !source.trim() || !!trial?.observations.length || !!trial?.verification} onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); }} /></label>
              <p className="muted">Original bytes and SHA-256 are retained. Required measurement unit: fraction. Maximum 64 KiB.</p>
              <details><summary>Import format</summary><pre>{'well,value,unit\nB1,0.5,fraction\n'}</pre></details>
            </section>
            <section><h2>Review decision</h2><label>Review rationale<input value={rationale} onChange={event => setRationale(event.target.value)} /></label><div className="toolbar"><Button disabled={busy || !trial?.verification || !rationale.trim() || running} onClick={event => { if (!event.nativeEvent.isTrusted) { setError('Review requires a direct UI interaction.'); return; } void review('accepted'); }}>Accept trial</Button><Button disabled={busy || !trial?.verification || !rationale.trim() || running} onClick={event => { if (!event.nativeEvent.isTrusted) { setError('Review requires a direct UI interaction.'); return; } void review('rejected'); }}>Reject trial</Button></div></section>
          </TabsContent>
        </Tabs>
      </>}
    </>}
  </main>;
}
