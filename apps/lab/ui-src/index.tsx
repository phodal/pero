import React, { useCallback, useEffect, useRef, useState } from 'react';
import { appObjectProps, downloadFile, useAppApi, useAppChat, useAppDataChanged, useAppObject } from '@pero/app-sdk';
import { Button, Split, SplitPane, Tabs, TabsContent, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
import type { Comparison, Engine, Experiment, LabState, Protocol } from './types';
import { bytesToBase64, exampleProtocol, trialLabel } from './presentation';
import { Deck } from './deck';
import { ProtocolEditor } from './protocol-editor';
import { describeStep } from './protocol-draft';
import { labReferenceState } from './reference';
import { Results, Timeline } from './evidence';
import './styles.css';

const emptySchema = { type: 'object', properties: {}, additionalProperties: false };
export default function Lab() {
  const api = useAppApi(), chat = useAppChat();
  const [history, setHistory] = useState<Experiment[]>([]), [engine, setEngine] = useState<Engine | null>(null);
  const [initialState, setInitialState] = useState<LabState | null>(null);
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
    const data = await api.get<{ experiments: Experiment[]; engine: Engine; initial_state: LabState }>('/api/state');
    setHistory(data.experiments); setEngine(data.engine); setInitialState(data.initial_state);
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
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'pero:app:location' || typeof event.data.location !== 'string') return;
      const match = /^experiment\/([a-f0-9]{32})$/.exec(event.data.location);
      if (match) void open(match[1]);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [api]);
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
      setDraft(JSON.stringify(exampleProtocol(50, next.initial_state.revision), null, 2));
    });
  }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!experiment) return;
    await perform(async () => {
      const next = await api.post<Experiment>(`/api/experiments/${experiment.id}/${action}`, { ...(trialId ? { trialId } : {}), ...extra });
      update(next);
      if (action === 'propose') { setTrialId(next.trials.at(-1)?.id ?? ''); setNotice('Candidate saved.'); }
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
      update(next); setTrialId(next.trials.at(-1)?.id ?? ''); setNotice('Candidate saved.');
    });
  }
  function revise() {
    if (!trial) return;
    setParentId(trial.id); setReason(''); setDraft(JSON.stringify(trial.protocol, null, 2)); setTab('protocol');
    setNotice('');
  }
  async function importFile(file: File) {
    if (!experiment || !trial) return;
    await perform(async () => {
      if (!source.trim()) throw new Error('Describe the measurement source before importing.');
      if (file.size > 64 * 1024) throw new Error('Measurement file must be 64 KiB or smaller.');
      const content_base64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      update(await api.post<Experiment>(`/api/experiments/${experiment.id}/import`, { trialId: trial.id, filename: file.name, content_base64, source }));
      setNotice('Measurement imported.');
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
  useAppObject({ id: 'lab', kind: 'lab-experiment', label: 'Lab', state: labReferenceState(experiment), actions: {
    refresh: { description: 'Reload saved evidence without executing actions.', parameters: emptySchema, run: refresh },
    open_experiment: { description: 'Open saved experiment.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }, run: async ({ id }) => { if (!history.some(item => item.id === id)) throw new Error('Unknown experiment'); await open(String(id)); } },
    select_trial: { description: 'View a saved trial without execution.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }, run: ({ id }) => { if (!experiment?.trials.some(item => item.id === id)) throw new Error('Unknown trial'); setTrialId(String(id)); } },
    select_tab: { description: 'Show a Lab view.', parameters: { type: 'object', properties: { tab: { enum: ['deck', 'protocol', 'runs', 'results'] } }, required: ['tab'], additionalProperties: false }, run: ({ tab }) => { if (!['deck', 'protocol', 'runs', 'results'].includes(String(tab))) throw new Error('Unknown tab'); setTab(String(tab)); } },
  } });
  return <main className="lab" {...appObjectProps('lab')} aria-busy={loading || busy}>
    <header className="lab-header"><div><h1>Lab</h1><details className="simulation-details"><summary>Simulation only</summary><p>Illustrative dye model. No physical or biological validation.</p></details></div><div className="toolbar">
      <Button disabled={busy || loading} onClick={() => { selected.current = ''; setExperiment(null); setTrialId(''); setParentId(''); setReason(''); setComparison(null); setError(''); setNotice(''); }}>New experiment</Button>
      {/* Composing must not mutate the referenced App object while Host verifies its revision. */}
      <Button disabled={!experiment || busy || loading || running} onClick={() => void chat.compose(`Help with Color Mixing experiment ${experiment!.id}. Read its frozen criteria and lab state using Lab's declared tools. Propose a bounded Protocol IR, validate and simulate with PyLabRobot Chatterbox only, attach explicitly synthetic observations or inspect imported evidence, independently evaluate, then propose a linked revision with a reason based on the discrepancy. Do not change frozen criteria or claim physical validity.`, { attachments: [chat.objectReference('lab')], approveGoal: true }).catch(fail)}>Approve goal and ask Agent</Button>
      <Button disabled={busy || loading} onClick={() => void perform(refresh)}>Refresh</Button>
    </div></header>
    {error && <div className="error" role="alert">{error} <Button onClick={() => void perform(refresh)} disabled={busy}>Retry connection</Button></div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {loading ? <p role="status">Loading saved experiments…</p> : <>
      <div className="context-row"><label>Saved experiments <select aria-label="Saved experiments" value={experiment?.id ?? ''} disabled={busy} onChange={event => { if (event.target.value) void open(event.target.value); }}><option value="">New experiment</option>{history.map(item => <option value={item.id} key={item.id}>{item.objective} ({item.trials.length} trials)</option>)}</select></label>
        <span className={engine?.available ? 'muted' : 'error'}>{engine?.name ?? 'Backend'} {engine?.version ?? ''}: {engine?.available ? 'Ready' : 'Unavailable'}</span></div>
      {engine?.error && <p className="error">{engine.error}</p>}
      {!experiment ? <Split className="setup-layout" storageKey="lab.setup.panes" collapseBelow={920}>
        <SplitPane id="goal" min={300} size={420} resizeLabel="Resize experiment goal">
          <section className="new-experiment"><h2>Experiment goal</h2>
            <label>Objective<textarea className="objective-input" rows={2} value={objective} maxLength={500} disabled={busy} onChange={event => setObjective(event.target.value)} /></label>
            <div className="fields">
              <label>Target red fraction<input type="number" min="0" max="1" step="0.01" value={target} disabled={busy} onChange={event => setTarget(event.target.value)} /></label>
              <label>Tolerance<input type="number" min="0" max="1" step="0.01" value={tolerance} disabled={busy} onChange={event => setTolerance(event.target.value)} /></label>
            </div>
            <label>Maximum trials<input type="number" min="1" max="8" value={budget} disabled={busy} onChange={event => setBudget(event.target.value)} /></label>
            <dl className="facts goal-facts"><dt>Target well</dt><dd>B1</dd><dt>Final volume</dt><dd>100 ± 1 µL</dd><dt>Step limit</dt><dd>64 per trial</dd></dl>
            <div className="goal-actions"><Button variant="primary" busy={busy} onClick={() => void freeze()}>Freeze experiment</Button></div>
          </section>
        </SplitPane>
        <SplitPane id="initial-deck" min={460}>{initialState ? <Deck state={initialState} preview compact title="Initial deck" /> : <p className="muted">Preview unavailable. Refresh to retry.</p>}</SplitPane>
      </Split> : <>
        <section className="experiment-heading"><h2>{experiment.objective}</h2><p className="muted experiment-summary"><span className="candidate-status">Frozen</span><span>{experiment.criteria.target_well}</span><span>{experiment.criteria.target_volume_ul} ± {experiment.criteria.volume_tolerance_ul} µL</span><span>Red fraction {experiment.criteria.target_fraction} ± {experiment.criteria.tolerance}</span><span>{experiment.trials.length}/{experiment.max_trials} trials</span></p>
          <div className="toolbar"><label>Trial <select aria-label="Trial" value={trialId} onChange={event => setTrialId(event.target.value)} disabled={busy}><option value="">Select trial</option>{experiment.trials.map((item, index) => <option value={item.id} key={item.id}>{index + 1}: {item.status}{item.parent_trial_id ? ' (revision)' : ''}</option>)}</select></label>
          <Button disabled={busy} onClick={() => void perform(async () => { const report = await api.get<unknown>(`/api/experiments/${experiment.id}/export`); downloadFile(`lab-${experiment.id}.json`, JSON.stringify(report, null, 2), 'application/json'); setNotice('Evidence report exported.'); })}>Export JSON</Button></div>
        </section>
        <Tabs value={tab} onValueChange={setTab}><TabsList aria-label="Experiment views">{['deck', 'protocol', 'runs', 'results'].map(value => <TabsTrigger key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</TabsTrigger>)}</TabsList>
          <TabsContent value="deck"><Deck state={trial?.final_state ?? experiment.initial_state} /></TabsContent>
          <TabsContent value="protocol"><Split className="protocol-layout" storageKey="lab.protocol.panes" collapseBelow={980}>
            <SplitPane id="draft" min={360}>
              <ProtocolEditor heading={parentId ? 'Revision draft' : 'Candidate draft'} value={draft} onChange={setDraft} disabled={busy || running} state={experiment.initial_state} maxSteps={experiment.max_steps} />
              {parentId && <p className="muted">Revises {trialLabel(experiment.trials, parentId)}</p>}
              <details className="candidate-rationale" key={parentId || 'candidate'} open={!!parentId}><summary>{parentId ? 'Revision rationale (required)' : 'Candidate rationale'}</summary><input aria-label={parentId ? 'Revision rationale' : 'Candidate rationale'} value={reason} onChange={event => setReason(event.target.value)} disabled={busy || running} required={!!parentId} /></details>
              <div className="toolbar"><Button variant="primary" disabled={busy || running || experiment.trials.length >= experiment.max_trials || (!!parentId && !reason.trim())} onClick={() => void propose()}>Save candidate</Button><Button disabled={busy || running} onClick={() => { setDraft(JSON.stringify(exampleProtocol(50, experiment.initial_state.revision), null, 2)); }}>Load example protocol</Button></div>
              {experiment.trials.length >= experiment.max_trials && <p className="notice">Trial limit reached. Start a new experiment.</p>}
            </SplitPane>
            <SplitPane id="candidate" min={460} size={520} resizeLabel="Resize saved candidate and deck">
              <section className="saved-candidate"><div className="section-toolbar"><h2>Saved candidate</h2>{trial && <span className="candidate-status">{trial.status}</span>}</div>
                {!trial ? <p className="muted">No candidate saved.</p> : <>
                  <p className="candidate-title">{trialLabel(experiment.trials, trial.id)}</p>
                  <details><summary>{trial.protocol.steps.length} saved steps</summary><p className="muted">{trial.reason}</p><ol className="steps">{trial.protocol.steps.map((step, i) => <li key={i}>{describeStep(step)}</li>)}</ol></details>
                  {trial.error && <p className="error" role="alert">{trial.error}</p>}
                  <div className="toolbar"><Button disabled={busy || running || trial.status !== 'proposed'} onClick={() => void act('validate')}>Validate</Button><Button variant="primary" disabled={busy || running || trial.status !== 'validated' || !engine?.available} onClick={() => void act('simulate')}>Run simulation</Button><Button disabled={busy || running || !trial.verification} onClick={revise}>Revise candidate</Button></div>
                </>}
              </section>
              <Deck compact state={experiment.initial_state} title="Initial deck" />
            </SplitPane>
          </Split></TabsContent>
          <TabsContent value="runs">{running && <div className="toolbar"><p role="status">Simulation running…</p><Button onClick={() => { if (experiment) void api.post<Experiment>(`/api/experiments/${experiment.id}/cancel`, { trialId }).then(update).catch(fail); }}>Cancel simulation</Button></div>}<Timeline trial={trial} /></TabsContent>
          <TabsContent value="results"><Results experiment={experiment} trial={trial} comparison={comparison} />
            <section className="result-actions"><h2>Evidence</h2><p className="muted">Synthetic fixture: +0.1 fraction bias, not a measurement.</p><div className="toolbar"><Button disabled={busy || trial?.status !== 'completed' || !!trial?.observations.length || !!trial?.verification} onClick={() => void act('observe')}>Attach synthetic fixture</Button><Button variant="primary" disabled={busy || !trial || ['proposed', 'validated', 'running'].includes(trial.status) || !!trial.verification} onClick={() => void act('evaluate')}>Evaluate</Button><Button disabled={busy || experiment.trials.length < 2} onClick={() => void perform(async () => { setComparison(await api.post<Comparison>(`/api/experiments/${experiment.id}/compare`, {})); })}>Compare trials</Button><Button disabled={busy || !trial?.verification || running} onClick={revise}>Revise from feedback</Button></div>
              <label>Measurement source<input value={source} placeholder="Instrument, dataset or laboratory record" onChange={event => setSource(event.target.value)} /></label><label>Import CSV or JSON<input ref={fileInput} type="file" accept=".csv,.json" disabled={busy || trial?.status !== 'completed' || !source.trim() || !!trial?.observations.length || !!trial?.verification} onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); }} /></label>
              <p className="muted">Fraction units; up to 64 KiB.</p>
              <details><summary>Import format</summary><pre>{'well,value,unit\nB1,0.5,fraction\n'}</pre><p className="muted">Original bytes and SHA-256 are retained.</p></details>
            </section>
            <section><h2>Review decision</h2><label>Review rationale<input value={rationale} onChange={event => setRationale(event.target.value)} /></label><div className="toolbar"><Button disabled={busy || !trial?.verification || !rationale.trim() || running} onClick={event => { if (!event.nativeEvent.isTrusted) { setError('Review requires a direct UI interaction.'); return; } void review('accepted'); }}>Accept trial</Button><Button disabled={busy || !trial?.verification || !rationale.trim() || running} onClick={event => { if (!event.nativeEvent.isTrusted) { setError('Review requires a direct UI interaction.'); return; } void review('rejected'); }}>Reject trial</Button></div></section>
          </TabsContent>
        </Tabs>
      </>}
    </>}
  </main>;
}
