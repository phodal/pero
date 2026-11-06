import { Disclosure, Popover, Input, Textarea, Select } from '@pero/app-sdk/ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { appObjectProps, downloadFile, useAppApi, useAppChat, useAppDataChanged, useAppObject } from '@pero/app-sdk';
import { Button, FilePicker, Icon, Split, SplitPane, Tabs, TabsContent, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
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
  const selected = useRef(''), pending = useRef(false);
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
  function startNewExperiment() {
    selected.current = ''; setExperiment(null); setTrialId(''); setParentId(''); setReason(''); setComparison(null); setError(''); setNotice('');
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
    <header className="lab-header"><div className="app-title"><Icon name="flask" size={18} /><h1>Lab</h1><Popover label="Simulation scope" trigger="Simulation only" triggerVariant="ghost">{() => <p>Illustrative dye model. No physical or biological validation.</p>}</Popover></div><div className="toolbar">
      {experiment && <Button disabled={busy || loading} onClick={startNewExperiment}><Icon name="plus" />New experiment</Button>}
      <Button className="icon-button" variant="ghost" aria-label="Refresh" title="Refresh" disabled={busy || loading} onClick={() => void perform(refresh)}><Icon name="refresh" /></Button>
      {/* Composing must not mutate the referenced App object while Host verifies its revision. */}
      {experiment ? <Button variant="primary" disabled={busy || loading || running} onClick={() => void chat.compose(`Help with Color Mixing experiment ${experiment.id}. Read its frozen criteria and lab state using Lab's declared tools. Propose a bounded Protocol IR, validate and simulate with PyLabRobot Chatterbox only, attach explicitly synthetic observations or inspect imported evidence, independently evaluate, then propose a linked revision with a reason based on the discrepancy. Do not change frozen criteria or claim physical validity.`, { attachments: [chat.objectReference('lab')], approveGoal: true }).catch(fail)}><Icon name="agent" />Approve goal and ask Agent</Button> : <Button variant="primary" disabled={loading} busy={busy} onClick={() => void freeze()}><Icon name="lock" />Freeze experiment</Button>}
    </div></header>
    {error && <div className="error app-error" role="alert"><Icon name="alert" />{error} <Button onClick={() => void perform(refresh)} disabled={busy}>Retry connection</Button></div>}
    {engine?.error && <p className="error app-error">{engine.error}</p>}
    {!loading && <div className="context-row"><label className="experiment-picker">Experiment<Select label="Saved experiments" title={experiment?.objective} value={experiment?.id ?? ''} disabled={busy} onChange={value => { if (value) void open(value); else startNewExperiment(); }} options={[{value:"",label:"New experiment"}, ...history.map(item => ({value:item.id,label:`${item.objective} (${item.trials.length} trials)`}))]}/></label>
      {experiment && <div className="toolbar"><label>Trial<Select label="Trial" value={trialId} onChange={setTrialId} disabled={busy} options={[{value:"",label:"Select trial"}, ...experiment.trials.map((item, index) => ({value:item.id,label:`${index + 1}: ${item.status}${item.parent_trial_id ? ' (revision)' : ''}`}))]}/></label><Button variant="ghost" disabled={busy} onClick={() => void perform(async () => { const report = await api.get<unknown>(`/api/experiments/${experiment.id}/export`); downloadFile(`lab-${experiment.id}.json`, JSON.stringify(report, null, 2), 'application/json'); setNotice('Evidence report exported.'); })}><Icon name="export" />Export JSON</Button></div>}
    </div>}
    {experiment && <div className="experiment-summary"><span className="frozen-label"><Icon name="lock" size={12} />Frozen</span><span>{experiment.criteria.target_well}</span><span>{experiment.criteria.target_volume_ul} ± {experiment.criteria.volume_tolerance_ul} µL</span><span>Red fraction {experiment.criteria.target_fraction} ± {experiment.criteria.tolerance}</span><span>{experiment.trials.length}/{experiment.max_trials} trials</span></div>}
    <div className="lab-workspace">
    {loading ? <p className="empty" role="status">Loading saved experiments…</p> : <>
      {!experiment ? <Split className="setup-layout" storageKey="lab.setup.workbench.panes" collapseBelow={820}>
        <SplitPane id="goal" className="goal-pane" min={300} size={320} resizeLabel="Resize experiment goal">
          <section className="new-experiment"><h2><Icon name="target" />Experiment goal</h2>
            <label>Objective<Textarea className="objective-input" rows={2} value={objective} maxLength={500} disabled={busy} onChange={event => setObjective(event.target.value)} /></label>
            <div className="fields">
              <label>Target red fraction<Input type="number" min="0" max="1" step="0.01" value={target} disabled={busy} onChange={event => setTarget(event.target.value)} /></label>
              <label>Tolerance<Input type="number" min="0" max="1" step="0.01" value={tolerance} disabled={busy} onChange={event => setTolerance(event.target.value)} /></label>
            </div>
            <label>Maximum trials<Input type="number" min="1" max="8" value={budget} disabled={busy} onChange={event => setBudget(event.target.value)} /></label>
            <dl className="facts goal-facts"><dt>Target well</dt><dd>B1</dd><dt>Final volume</dt><dd>100 ± 1 µL</dd><dt>Step limit</dt><dd>64 per trial</dd></dl>
          </section>
        </SplitPane>
        <SplitPane id="initial-deck" className="initial-deck-pane" min={460}>{initialState ? <Deck state={initialState} preview compact title="Initial deck" /> : <p className="empty">Preview unavailable. Refresh to retry.</p>}</SplitPane>
      </Split> : <>
        <Tabs className="experiment-tabs" value={tab} onValueChange={setTab}><TabsList aria-label="Experiment views">{['deck', 'protocol', 'runs', 'results'].map(value => <TabsTrigger key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</TabsTrigger>)}</TabsList>
          <TabsContent className="workbench-panel" value="deck"><Deck state={trial?.final_state ?? experiment.initial_state} /></TabsContent>
          <TabsContent className="workbench-panel" value="protocol"><Split className="protocol-layout" storageKey="lab.protocol.workbench.panes" collapseBelow={940}>
            <SplitPane id="draft" className="draft-pane" min={480}>
              <ProtocolEditor heading={parentId ? 'Revision draft' : 'Candidate draft'} value={draft} onChange={setDraft} disabled={busy || running} state={experiment.initial_state} maxSteps={experiment.max_steps} />
              <div className="draft-footer">
                {parentId && <p className="muted">Revises {trialLabel(experiment.trials, parentId)}</p>}
                <Disclosure variant="inline" className="candidate-rationale" key={parentId || 'candidate'} defaultOpen={!!parentId} summary={<>{parentId ? 'Revision rationale (required)' : 'Candidate rationale'}</>}><Input aria-label={parentId ? 'Revision rationale' : 'Candidate rationale'} value={reason} onChange={event => setReason(event.target.value)} disabled={busy || running} required={!!parentId} /></Disclosure>
                <div className="toolbar save-toolbar"><Button disabled={busy || running} onClick={() => { setDraft(JSON.stringify(exampleProtocol(50, experiment.initial_state.revision), null, 2)); }}>Load example protocol</Button><Button variant="primary" disabled={busy || running || experiment.trials.length >= experiment.max_trials || (!!parentId && !reason.trim())} onClick={() => void propose()}><Icon name="save" />Save candidate</Button></div>
                {experiment.trials.length >= experiment.max_trials && <p className="notice">Trial limit reached. Start a new experiment.</p>}
              </div>
            </SplitPane>
            <SplitPane id="candidate" className="candidate-pane" min={380} size={440} resizeLabel="Resize saved candidate and deck">
              <section className="saved-candidate"><div className="section-toolbar"><h2><Icon name="document" />Saved candidate</h2>{trial && <span className="candidate-status">{trial.status}</span>}</div>
                {!trial ? <p className="muted">No candidate saved.</p> : <>
                  <p className="candidate-title">{trialLabel(experiment.trials, trial.id)}</p>
                  <Disclosure variant="inline" summary={<>{trial.protocol.steps.length} saved steps</>}><p className="muted">{trial.reason}</p><ol className="steps">{trial.protocol.steps.map((step, i) => <li key={i}>{describeStep(step)}</li>)}</ol></Disclosure>
                  {trial.error && <p className="error" role="alert">{trial.error}</p>}
                  <div className="toolbar"><Button disabled={busy || running || trial.status !== 'proposed'} onClick={() => void act('validate')}><Icon name="check" />Validate</Button><Button variant="primary" disabled={busy || running || trial.status !== 'validated' || !engine?.available} onClick={() => void act('simulate')}><Icon name="play" />Run simulation</Button><Button disabled={busy || running || !trial.verification} onClick={revise}>Revise candidate</Button></div>
                </>}
              </section>
              <Deck compact state={experiment.initial_state} title="Initial deck" />
            </SplitPane>
          </Split></TabsContent>
          <TabsContent value="runs">{running && <div className="toolbar"><p role="status">Simulation running…</p><Button onClick={() => { if (experiment) void api.post<Experiment>(`/api/experiments/${experiment.id}/cancel`, { trialId }).then(update).catch(fail); }}>Cancel simulation</Button></div>}<Timeline trial={trial} /></TabsContent>
          <TabsContent value="results"><Results experiment={experiment} trial={trial} comparison={comparison} />
            <section className="result-actions"><h2>Evidence</h2><p className="muted">Synthetic fixture: +0.1 fraction bias, not a measurement.</p><div className="toolbar"><Button disabled={busy || trial?.status !== 'completed' || !!trial?.observations.length || !!trial?.verification} onClick={() => void act('observe')}>Attach synthetic fixture</Button><Button variant="primary" disabled={busy || !trial || ['proposed', 'validated', 'running'].includes(trial.status) || !!trial.verification} onClick={() => void act('evaluate')}>Evaluate</Button><Button disabled={busy || experiment.trials.length < 2} onClick={() => void perform(async () => { setComparison(await api.post<Comparison>(`/api/experiments/${experiment.id}/compare`, {})); })}>Compare trials</Button><Button disabled={busy || !trial?.verification || running} onClick={revise}>Revise from feedback</Button></div>
              <label>Measurement source<Input value={source} placeholder="Instrument, dataset or laboratory record" onChange={event => setSource(event.target.value)} /></label><FilePicker label="Import CSV or JSON" emptyLabel="No file selected" accept=".csv,.json" disabled={busy || trial?.status !== 'completed' || !source.trim() || !!trial?.observations.length || !!trial?.verification} onFile={file => void importFile(file)}/>
              <p className="muted">Fraction units; up to 64 KiB.</p>
              <Disclosure variant="inline" summary={<>Import format</>}><pre>{'well,value,unit\nB1,0.5,fraction\n'}</pre><p className="muted">Original bytes and SHA-256 are retained.</p></Disclosure>
            </section>
            <section><h2>Review decision</h2><label>Review rationale<Input value={rationale} onChange={event => setRationale(event.target.value)} /></label><div className="toolbar"><Button disabled={busy || !trial?.verification || !rationale.trim() || running} onClick={event => { if (!event.nativeEvent.isTrusted) { setError('Review requires a direct UI interaction.'); return; } void review('accepted'); }}>Accept trial</Button><Button disabled={busy || !trial?.verification || !rationale.trim() || running} onClick={event => { if (!event.nativeEvent.isTrusted) { setError('Review requires a direct UI interaction.'); return; } void review('rejected'); }}>Reject trial</Button></div></section>
          </TabsContent>
        </Tabs>
      </>}
    </>}
    </div>
    <footer className="lab-statusbar"><span className={engine?.available ? 'engine-status' : 'error'}><Icon name="circuit" size={12} />{engine?.name ?? 'Backend'} {engine?.version ?? ''}: {loading ? 'Connecting' : engine?.available ? 'Ready' : 'Unavailable'}</span><span className="status-message" role="status">{busy ? 'Working…' : notice || (running ? 'Simulation running…' : '')}</span></footer>
  </main>;
}
