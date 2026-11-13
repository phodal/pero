import { Disclosure, Popover, Input, Textarea, Select } from '@pero/app-sdk/ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { appObjectProps, downloadFile, useAppApi, useAppChat, useAppContext, useAppDataChanged, useAppObject } from '@pero/app-sdk';
import { AppBar, Button, ContentPane, ContentSection, FilePicker, Icon, IconButton, InspectorHeader, LibraryHeader, MetadataList, Split, SplitPane, Tabs, TabsContent, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
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
  const api = useAppApi(), chat = useAppChat(), { locale } = useAppContext();
  const zh = locale === 'zh-CN';
  const text = (en: string, zhText: string) => zh ? zhText : en;
  const viewLabel = (value: string) => text(value[0].toUpperCase() + value.slice(1), value === 'deck' ? '台面' : value === 'protocol' ? '方案' : value === 'runs' ? '运行' : '结果');
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
  const shownDeck = trial?.final_state ?? experiment?.initial_state;
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
    <Tabs className="experiment-tabs" value={tab} onValueChange={setTab}>
    <AppBar
      scope={<>
        {experiment && <TabsList variant="navigation" aria-label={text('Experiment views', '实验视图')}>{['deck', 'protocol', 'runs', 'results'].map(value => <TabsTrigger key={value} value={value}>{viewLabel(value)}</TabsTrigger>)}</TabsList>}
        {!loading ? <label className="experiment-picker">{text('Experiment', '实验')}<Select label={text('Saved experiments', '已保存的实验')} title={experiment?.objective} value={experiment?.id ?? ''} disabled={busy} onChange={value => { if (value) void open(value); else startNewExperiment(); }} options={[{value:"",label:text('New experiment', '新建实验')}, ...history.map(item => ({value:item.id,label:`${item.objective} (${item.trials.length} ${text('trials', '次试次')})`}))]} /></label> : undefined}
        {experiment && <label className="trial-picker">{text('Trial', '试次')}<Select label={text('Trial', '试次')} value={trialId} onChange={setTrialId} disabled={busy} options={[{value:"",label:text('Select trial', '选择试次')}, ...experiment.trials.map((item, index) => ({value:item.id,label:`${index + 1}: ${item.status}${item.parent_trial_id ? text(' (revision)', '（修订）') : ''}`}))]}/></label>}
      </>}
      utilities={<><Popover label={text('Simulation scope', '仿真范围')} trigger={text('Simulation only', '仅仿真')} triggerVariant="ghost">{() => <p>{text('Illustrative dye model. No physical or biological validation.', '染料示意模型。没有物理或生物学验证。')}</p>}</Popover>
        <IconButton label={text('Refresh', '刷新')} disabled={busy || loading} onClick={() => void perform(refresh)}><Icon name="refresh" /></IconButton></>}
      commands={<>
        {experiment && <Button variant="ghost" disabled={busy || loading} onClick={startNewExperiment}><Icon name="plus" />{text('New experiment', '新建实验')}</Button>}
        {experiment && <Button variant="ghost" disabled={busy} onClick={() => void perform(async () => { const report = await api.get<unknown>(`/api/experiments/${experiment.id}/export`); downloadFile(`lab-${experiment.id}.json`, JSON.stringify(report, null, 2), 'application/json'); setNotice(text('Evidence report exported.', '证据报告已导出。')); })}><Icon name="export" />{text('Export JSON', '导出 JSON')}</Button>}
      </>}
      primary={experiment ? <Button variant="primary" disabled={busy || loading || running} onClick={() => void chat.compose(`Help with Color Mixing experiment ${experiment.id}. Read its frozen criteria and lab state using Lab's declared tools. Propose a bounded Protocol IR, validate and simulate with PyLabRobot Chatterbox only, attach explicitly synthetic observations or inspect imported evidence, independently evaluate, then propose a linked revision with a reason based on the discrepancy. Do not change frozen criteria or claim physical validity.`, { attachments: [chat.objectReference('lab')], approveGoal: true }).catch(fail)}><Icon name="agent" />{text('Approve goal and ask Agent', '确认目标并询问')}</Button> : <Button variant="primary" disabled={loading} busy={busy} onClick={() => void freeze()}><Icon name="lock" />{text('Freeze experiment', '冻结实验')}</Button>} />
    {error && <div className="error app-error" role="alert"><Icon name="alert" />{error} <Button onClick={() => void perform(refresh)} disabled={busy}>{text('Retry connection', '重试连接')}</Button></div>}
    {engine?.error && <p className="error app-error">{engine.error}</p>}
    {experiment && <div className="experiment-summary"><span className="frozen-label"><Icon name="lock" size={12} />{text('Frozen', '已冻结')}</span><span>{experiment.criteria.target_well}</span><span>{experiment.criteria.target_volume_ul} ± {experiment.criteria.volume_tolerance_ul} µL</span><span>{text('Red fraction', '红色比例')} {experiment.criteria.target_fraction} ± {experiment.criteria.tolerance}</span><span>{experiment.trials.length}/{experiment.max_trials} {text('trials', '次试次')}</span></div>}
    <div className="lab-workspace">
    {loading ? <p className="empty" role="status">{text('Loading saved experiments…', '正在读取已保存的实验…')}</p> : <>
      {!experiment ? <Split className="setup-layout" storageKey="lab.setup.workbench.panes" collapseBelow={820}>
        <SplitPane id="goal" className="goal-pane" min={300} size={320} resizeLabel={text('Resize experiment goal', '调整实验目标宽度')}>
          <ContentPane id="lab-goal" label={text('Experiment goal', '实验目标')} as="div" surface="workspace" inset="none" scroll="pane"
            header={<LibraryHeader density="compact" title={text('Experiment goal', '实验目标')} />}>
          <section className="new-experiment">
            <label>{text('Objective', '目标')}<Textarea className="objective-input" rows={2} value={objective} maxLength={500} disabled={busy} onChange={event => setObjective(event.target.value)} /></label>
            <div className="fields">
              <label>{text('Target red fraction', '目标红色比例')}<Input type="number" min="0" max="1" step="0.01" value={target} disabled={busy} onChange={event => setTarget(event.target.value)} /></label>
              <label>{text('Tolerance', '容差')}<Input type="number" min="0" max="1" step="0.01" value={tolerance} disabled={busy} onChange={event => setTolerance(event.target.value)} /></label>
            </div>
            <label>{text('Maximum trials', '最多试次')}<Input type="number" min="1" max="8" value={budget} disabled={busy} onChange={event => setBudget(event.target.value)} /></label>
            <div className="facts goal-facts"><MetadataList items={[
              { id: 'well', label: text('Target well', '目标孔'), value: 'B1' },
              { id: 'volume', label: text('Final volume', '最终体积'), value: '100 ± 1 µL' },
              { id: 'steps', label: text('Step limit', '步骤上限'), value: text('64 per trial', '每次试次 64 步') },
            ]} /></div>
          </section>
          </ContentPane>
        </SplitPane>
        <SplitPane id="initial-deck" className="initial-deck-pane" min={460}>
          <ContentPane id="lab-initial-deck" label={text('Initial deck', '初始台面')} as="div" surface="workspace" inset="none" scroll="content"
            header={<LibraryHeader density="compact" title={text('Initial deck', '初始台面')} actions={<span className="candidate-status">{text('Preview', '预览')}</span>} />}>
            {initialState ? <Deck state={initialState} preview compact hideHeading /> : <p className="empty">{text('Preview unavailable.', '无法预览。')} <Button onClick={() => void perform(refresh)}>{text('Refresh', '刷新')}</Button></p>}
          </ContentPane>
        </SplitPane>
      </Split> : <>
          <TabsContent className="workbench-panel" value="deck"><ContentPane id="lab-deck" label={text('Deck', '台面')} as="div" surface="workspace" inset="none" scroll="content"
            header={shownDeck && <LibraryHeader density="compact" title={text('96-well plate', '96 孔板')} actions={<span className="candidate-status">{text(`Revision ${shownDeck.revision}`, `修订 ${shownDeck.revision}`)}</span>} />}>{shownDeck && <Deck state={shownDeck} hideHeading />}</ContentPane></TabsContent>
          <TabsContent className="workbench-panel" value="protocol"><Split className="protocol-layout" storageKey="lab.protocol.workbench.panes" collapseBelow={940}>
            <SplitPane id="draft" className="draft-pane" min={480}>
              <ContentPane id="lab-draft" label={parentId ? text('Revision draft', '修订草案') : text('Candidate draft', '候选草案')} as="div" surface="workspace" inset="none" scroll="pane">
              <ProtocolEditor heading={parentId ? text('Revision draft', '修订草案') : text('Candidate draft', '候选草案')} value={draft} onChange={setDraft} disabled={busy || running} state={experiment.initial_state} maxSteps={experiment.max_steps} />
              <div className="draft-footer">
                {parentId && <p className="muted">{text('Revises', '修订自')} {trialLabel(experiment.trials, parentId)}</p>}
                <Disclosure variant="inline" className="candidate-rationale" key={parentId || 'candidate'} defaultOpen={!!parentId} summary={<>{parentId ? text('Revision rationale (required)', '修订理由（必填）') : text('Candidate rationale', '候选理由')}</>}><Input aria-label={parentId ? text('Revision rationale', '修订理由') : text('Candidate rationale', '候选理由')} value={reason} onChange={event => setReason(event.target.value)} disabled={busy || running} required={!!parentId} /></Disclosure>
                <div className="toolbar save-toolbar"><Button disabled={busy || running} onClick={() => { setDraft(JSON.stringify(exampleProtocol(50, experiment.initial_state.revision), null, 2)); }}>{text('Load example protocol', '载入示例方案')}</Button><Button disabled={busy || running || experiment.trials.length >= experiment.max_trials || (!!parentId && !reason.trim())} onClick={() => void propose()}><Icon name="save" />{text('Save candidate', '保存候选')}</Button></div>
                {experiment.trials.length >= experiment.max_trials && <p className="notice">{text('Trial limit reached. Start a new experiment.', '已达到试次上限。请新建实验。')}</p>}
              </div>
              </ContentPane>
            </SplitPane>
            <SplitPane id="candidate" className="candidate-pane" min={380} size={440} resizeLabel={text('Resize saved candidate and deck', '调整已保存候选与台面宽度')}>
              <ContentPane id="lab-candidate" label={text('Saved candidate', '已保存候选')} as="div" surface="reading" inset="compact" scroll="pane"
                header={<InspectorHeader title={trial ? trialLabel(experiment.trials, trial.id) : text('Saved candidate', '已保存候选')} identity={text('Candidate', '候选')} status={trial ? <span className="candidate-status">{trial.status}</span> : undefined} actions={trial ? <><Button disabled={busy || running || trial.status !== 'proposed'} onClick={() => void act('validate')}><Icon name="check" />{text('Validate', '校验')}</Button><Button variant="primary" disabled={busy || running || trial.status !== 'validated' || !engine?.available} onClick={() => void act('simulate')}><Icon name="play" />{text('Run simulation', '运行仿真')}</Button><Button disabled={busy || running || !trial.verification} onClick={revise}>{text('Revise candidate', '修订候选')}</Button></> : undefined} />}>
              <section className="saved-candidate">
                {!trial ? <p className="muted">{text('No candidate saved. Save a candidate from the draft.', '还没有候选。请从草案保存一个候选。')}</p> : <>
                  <Disclosure variant="inline" summary={<>{text(`${trial.protocol.steps.length} saved steps`, `${trial.protocol.steps.length} 个已保存步骤`)}</>}><p className="muted">{trial.reason}</p><ol className="steps">{trial.protocol.steps.map((step, i) => <li key={i}>{describeStep(step)}</li>)}</ol></Disclosure>
                  {trial.error && <p className="error" role="alert">{trial.error}</p>}
                </>}
              </section>
              <Deck compact state={experiment.initial_state} title={text('Initial deck', '初始台面')} />
              </ContentPane>
            </SplitPane>
          </Split></TabsContent>
          <TabsContent value="runs"><ContentPane id="lab-runs" label={text('Runs', '运行')} as="div" surface="workspace" inset="compact" scroll="pane">{running && <div className="toolbar"><p role="status">{text('Simulation running…', '仿真运行中…')}</p><Button onClick={() => { if (experiment) void api.post<Experiment>(`/api/experiments/${experiment.id}/cancel`, { trialId }).then(update).catch(fail); }}>{text('Cancel simulation', '取消仿真')}</Button></div>}<Timeline trial={trial} /></ContentPane></TabsContent>
          <TabsContent value="results"><ContentPane id="lab-results" label={text('Results', '结果')} as="div" surface="workspace" inset="compact" scroll="pane"><Results experiment={experiment} trial={trial} comparison={comparison} />
            <ContentSection id="lab-evidence" title={text('Evidence', '证据')}><p className="muted">{text('Synthetic fixture: +0.1 fraction bias, not a measurement.', '合成夹具：比例偏移 +0.1，不是测量值。')}</p><div className="toolbar"><Button disabled={busy || trial?.status !== 'completed' || !!trial?.observations.length || !!trial?.verification} onClick={() => void act('observe')}>{text('Attach synthetic fixture', '附加合成夹具')}</Button><Button disabled={busy || !trial || ['proposed', 'validated', 'running'].includes(trial.status) || !!trial.verification} onClick={() => void act('evaluate')}>{text('Evaluate', '评估')}</Button><Button disabled={busy || experiment.trials.length < 2} onClick={() => void perform(async () => { setComparison(await api.post<Comparison>(`/api/experiments/${experiment.id}/compare`, {})); })}>{text('Compare trials', '比较试次')}</Button><Button disabled={busy || !trial?.verification || running} onClick={revise}>{text('Revise from feedback', '根据反馈修订')}</Button></div>
              <label>{text('Measurement source', '测量来源')}<Input value={source} placeholder={text('Instrument, dataset or laboratory record', '仪器、数据集或实验记录')} onChange={event => setSource(event.target.value)} /></label><FilePicker label={text('Import CSV or JSON', '导入 CSV 或 JSON')} emptyLabel={text('No file selected', '未选择文件')} accept=".csv,.json" disabled={busy || trial?.status !== 'completed' || !source.trim() || !!trial?.observations.length || !!trial?.verification} onFile={file => void importFile(file)}/>
              <p className="muted">{text('Fraction units; up to 64 KiB.', '比例单位；最大 64 KiB。')}</p>
              <Disclosure variant="inline" summary={<>{text('Import format', '导入格式')}</>}><pre>{'well,value,unit\nB1,0.5,fraction\n'}</pre><p className="muted">{text('Original bytes and SHA-256 are retained.', '原始字节和 SHA-256 会保留。')}</p></Disclosure>
            </ContentSection>
            <ContentSection id="lab-review" title={text('Review decision', '审阅决定')}><label>{text('Review rationale', '审阅理由')}<Input value={rationale} onChange={event => setRationale(event.target.value)} /></label><div className="toolbar"><Button disabled={busy || !trial?.verification || !rationale.trim() || running} onClick={event => { if (!event.nativeEvent.isTrusted) { setError(text('Review requires a direct UI interaction.', '审阅需要直接在界面上操作。')); return; } void review('accepted'); }}>{text('Accept trial', '接受试次')}</Button><Button disabled={busy || !trial?.verification || !rationale.trim() || running} onClick={event => { if (!event.nativeEvent.isTrusted) { setError(text('Review requires a direct UI interaction.', '审阅需要直接在界面上操作。')); return; } void review('rejected'); }}>{text('Reject trial', '拒绝试次')}</Button></div></ContentSection>
          </ContentPane></TabsContent>
      </>}
    </>}
    </div>
    </Tabs>
    <footer className="lab-statusbar"><span className={engine?.available ? 'engine-status' : 'error'}><Icon name="circuit" size={12} />{engine?.name ?? text('Backend', '后端')} {engine?.version ?? ''}: {loading ? text('Connecting', '正在连接') : engine?.available ? text('Ready', '就绪') : text('Unavailable', '不可用')}</span><span className="status-message" role="status">{busy ? text('Working…', '正在处理…') : notice || (running ? text('Simulation running…', '仿真运行中…') : '')}</span></footer>
  </main>;
}
