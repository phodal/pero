import { Disclosure, Badge, Button, Card, Checkbox, Dialog, EmptyState, Feedback, Input, Select, RadioGroup, RadioGroupItem, Slider, Table, Tabs, TabsContent, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
import React, { useEffect, useRef, useState } from "react";
import { useAppContext } from "@pero/app-sdk";
import { ContentPane, ContentSection, InspectorHeader, LibraryHeader, ListRow, Split, SplitPane } from "@pero/app-sdk/ui";
import type { Check, Experiment, Series, Template } from "./types";
import {
  chartTarget,
  checkConcepts,
  curvePath,
  signalLabel,
  numeric,
  responseComparison,
  plotArea,
  suggestedDraft,
  fieldLabel,
  verdictSummary,
  verificationRows,
  verificationUnits,
  worstMetrics,
  type Concept,
} from "./presentation";

function checkValue(value: number | null, unit?: string) {
  return `${numeric(value)}${value != null && Number.isFinite(value) && unit ? ` ${unit}` : ""}`;
}

function Checks({ checks, label = "Verification checks", units }: {
  checks: Check[]; label?: string; units?: ReturnType<typeof verificationUnits>;
}) {
  return <Table label={label} density="compact" rows={checks.map((check, index) => ({ ...check, key: String(index) }))} rowId={row => row.key} columns={[
    { id: 'name', header: 'Check', cell: row => row.name },
    { id: 'verdict', header: 'Verdict', size: 100, cell: row => <Badge tone={verdictTone(row.verdict)}>{row.verdict}</Badge> },
    { id: 'actual', header: 'Actual', size: 90, meta: { align: 'end' }, cell: row => checkValue(row.actual, units?.get(row.name)) },
    { id: 'limit', header: 'Limit', size: 90, meta: { align: 'end' }, cell: row => checkValue(row.limit, units?.get(row.name)) },
    { id: 'evidence', header: 'Evidence', size: 240, cell: row => row.message },
  ]} />;
}

function verdictTone(verdict: string) {
  return verdict === 'PASS' ? 'success' : verdict === 'FAIL' ? 'error' : verdict === 'NOT_RUN' ? 'neutral' : 'warning';
}

function ticks(min: number, max: number, count: number) {
  if (!(max > min)) return [min];
  return Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1));
}

function Curve({
  name,
  unit,
  baseline,
  candidate,
  candidateLabel,
  showBaseline,
  target,
}: {
  name: string;
  unit: string;
  baseline?: Series;
  candidate?: Series;
  candidateLabel: string;
  showBaseline: boolean;
  target: number | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const original = [baseline, candidate].filter(Boolean) as Series[];
  const logarithmic = original.length > 0 && original.every((series) => series.xUnit === "Hz" && series.x.every((x) => x > 0));
  const draw = (series?: Series) => series && logarithmic ? { ...series, x: series.x.map(Math.log10) } : series;
  const drawnBaseline = showBaseline ? draw(baseline) : undefined;
  const drawnCandidate = draw(candidate);
  const all = [drawnBaseline, drawnCandidate].filter(Boolean) as Series[];
  const points = all.flatMap((series) => series.x.map((x, i) => [x, series.y[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  if (!points.length) return <p>No finite observations for {signalLabel(name)}.</p>;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  if (target != null) ys.push(target);
  const bounds: [number, number, number, number] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const readout = drawnCandidate ?? drawnBaseline;
  const nearest = hover == null || !readout ? null : readout.x.reduce((best, x, index) => Math.abs(x - hover) < Math.abs(readout.x[best] - hover) ? index : best, 0);
  const xOf = (value: number) => plotArea.left + ((value - bounds[0]) / (bounds[1] - bounds[0] || 1)) * (plotArea.right - plotArea.left);
  const yOf = (value: number) => plotArea.bottom - ((value - bounds[2]) / (bounds[3] - bounds[2] || 1)) * (plotArea.bottom - plotArea.top);
  const displayX = nearest == null ? null : logarithmic ? 10 ** (readout?.x[nearest] ?? 0) : readout?.x[nearest];
  return (
    <div className="chart-frame">
      <svg
        className="chart"
        viewBox="0 0 560 240"
        role="img"
        aria-label={[signalLabel(name), drawnBaseline && "dashed baseline", drawnCandidate && `solid ${candidateLabel}`, target != null && "dashed target"].filter(Boolean).join(", ")}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const viewX = ((event.clientX - rect.left) / rect.width) * 560;
          const fraction = (viewX - plotArea.left) / (plotArea.right - plotArea.left);
          setHover(bounds[0] + Math.min(1, Math.max(0, fraction)) * (bounds[1] - bounds[0]));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {ticks(bounds[2], bounds[3], 4).map((value) => (
          <line key={value} x1={plotArea.left} x2={plotArea.right} y1={yOf(value)} y2={yOf(value)} />
        ))}
        <line x1={plotArea.left} y1={plotArea.bottom} x2={plotArea.right} y2={plotArea.bottom} />
        <line x1={plotArea.left} y1={plotArea.top} x2={plotArea.left} y2={plotArea.bottom} />
        {target != null && (
          <line className="target-line" x1={plotArea.left} x2={plotArea.right} y1={yOf(target)} y2={yOf(target)} strokeDasharray="4 4" />
        )}
        {drawnBaseline && <path d={curvePath(drawnBaseline, bounds)} className="baseline-curve" fill="none" strokeWidth="2" />}
        {drawnCandidate && <path d={curvePath(drawnCandidate, bounds)} className="candidate-curve" fill="none" strokeWidth="2" />}
        {nearest != null && readout && (
          <g className="crosshair">
            <line x1={xOf(readout.x[nearest])} x2={xOf(readout.x[nearest])} y1={plotArea.top} y2={plotArea.bottom} />
            <circle cx={xOf(readout.x[nearest])} cy={yOf(readout.y[nearest])} r="3" />
          </g>
        )}
        {ticks(bounds[0], bounds[1], 3).map((value) => (
          <text key={value} x={xOf(value)} y="222" textAnchor="middle">{numeric(logarithmic ? 10 ** value : value)}</text>
        ))}
        <text x={(plotArea.left + plotArea.right) / 2} y="236" textAnchor="middle">
          {logarithmic ? "Frequency (Hz, log scale)" : candidate?.xUnit === "s" || baseline?.xUnit === "s" ? "Time (s)" : (candidate?.xUnit ?? baseline?.xUnit ?? "x")}
        </text>
        {ticks(bounds[2], bounds[3], 3).map((value) => (
          <text key={`y-${value}`} x={plotArea.left - 4} y={yOf(value)} textAnchor="end">{numeric(value)}</text>
        ))}
      </svg>
      {nearest != null && displayX != null && (
        <div className="chart-tooltip" style={{ left: `${(xOf(readout!.x[nearest]) / 560) * 100}%` }}>
          <strong>{numeric(displayX)} {logarithmic ? "Hz" : readout?.xUnit || ""}</strong>
          {showBaseline && baseline && <span>Baseline {checkValue(baseline.y[nearest], unit)}</span>}
          {candidate && <span>{candidateLabel} {checkValue(candidate.y[nearest], unit)}</span>}
        </div>
      )}
    </div>
  );
}

export function Results({
  experiment,
  selectedId,
  template,
  draft,
  onDraft,
  onSelect,
  candidateActions,
  setup,
  disabled = false,
}: {
  experiment: Experiment;
  selectedId: string;
  template?: Template;
  setup?: React.ReactNode;
  disabled?: boolean;
  draft: Record<string, number>;
  onDraft: (values: Record<string, number>) => void;
  onSelect: (id: string) => void;
  candidateActions?: React.ReactNode;
}) {
  const [scenarioId, setScenarioId] = useState("");
  const [signalName, setSignalName] = useState("");
  const [showBaseline, setShowBaseline] = useState(true);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const { locale } = useAppContext();
  const zh = locale === 'zh-CN';
  const text = (en: string, zhText: string) => zh ? zhText : en;
  const { scenarios, scenario, baseline, selected, series } = responseComparison(experiment, selectedId, scenarioId);
  const hasTrials = experiment.trials.length > 0;
  const hasResponses = experiment.trials.some(trial => trial.phase === "search" && trial.observation?.series.length);
  const signal = series.find((item) => item.name === signalName) ?? series[0];
  const candidate = experiment.candidates.find((item) => item.id === selectedId);
  const saved = candidate?.parameters ?? experiment.parameters;
  const names = [...(template?.parameters.map(field => field.name) ?? []), ...Object.keys(experiment.searchSpace)]
    .filter((name, index, all) => name in experiment.searchSpace && all.indexOf(name) === index);
  const dirty = names.some((name) => Math.abs((draft[name] ?? NaN) - (saved[name] ?? NaN)) > 1e-9);
  const candidateLabel = `${candidate?.label ?? text('Candidate', '候选')}${dirty ? text(' (saved run)', '（已保存的运行）') : ''}`;
  const verified = Boolean(experiment.lockedCandidateId && experiment.verificationOperationId);
  const phase = verified ? "verification" : "search";
  const focusId = verified ? experiment.lockedCandidateId! : selectedId;
  const concepts = checkConcepts(experiment, focusId, phase);
  const summary = verdictSummary(concepts, experiment.scenarios.filter((item) => item.role === phase).length);
  const suggestion = experiment.lockedCandidateId ? null : suggestedDraft(experiment.templateId, saved, experiment.searchSpace, concepts);
  const rows = verificationRows(experiment);
  const units = verificationUnits(template);
  const issues = concepts.filter(concept => concept.verdict !== "PASS");
  const passes = concepts.filter(concept => concept.verdict === "PASS");
  const focusedCheck = concepts.find(concept => concept.name === focused);
  const finalChecks = new Map<string, Check[]>();
  for (const check of experiment.report?.checks ?? []) {
    const scenario = rows.find(({ scenario }) => check.name === scenario.label || check.name.startsWith(`${scenario.label} / `))?.scenario.label;
    const group = scenario ?? "Other checks";
    const name = !scenario ? check.name : check.name === scenario ? "Scenario evidence" : check.name.slice(scenario.length + 3);
    const checks = finalChecks.get(group) ?? [];
    checks.push({ ...check, name });
    finalChecks.set(group, checks);
  }
  const metrics = worstMetrics(experiment, selectedId);
  const isFilter = experiment.templateId === "active-filter";
  const model = experiment.templateId === "robust-pid"
    ? `G(s) = ${numeric(scenario?.parameters.gain ?? 1)} / (s² + ${numeric(2 * (scenario?.parameters.damping ?? 1))}s + 1)`
    : "G(s) = 1 / (s + 1)";
  const fixed = Object.entries(experiment.parameters).filter(([name]) => !names.includes(name));


  function focusConcept(concept: Concept) {
    setFocused(concept.name);
    if (!concept.chartScenarioId) return;
    setScenarioId(concept.chartScenarioId);
    if (concept.signal) setSignalName(concept.signal);
  }

  function renderCheck(concept: Concept) {
    const unit = units.get(concept.name);
    return <React.Fragment key={concept.name}>
      <ListRow className="check-row" current={focused === concept.name} title={concept.name} onOpen={() => focusConcept(concept)}
        trailing={<Badge tone={verdictTone(concept.verdict)}>{concept.verdict}</Badge>}
        meta={(concept.actual != null || concept.limit != null) ? <small className="check-values">
          {concept.actual != null && <strong>{checkValue(concept.actual, unit)}</strong>}
          {concept.actual != null && concept.limit != null && " · "}
          {concept.limit != null && text(`Limit ${checkValue(concept.limit, unit)}`, `上限 ${checkValue(concept.limit, unit)}`)}
        </small> : undefined} />
      {focusedCheck === concept && <p className="check-message">
        {concept.message}
        {concept.scenarioId && !concept.chartScenarioId && text(' Final scenario evidence appears in the report.', ' 最终工况的证据在报告中。')}
      </p>}
    </React.Fragment>;
  }

  return (
    <>
      <Split key={hasTrials ? "results" : "setup"} className="workbench" data-preparing={!hasTrials || undefined} storageKey={hasTrials ? "control-lab.results.panes" : "control-lab.setup.panes"} collapseBelow={hasTrials ? 1080 : 760}>
        <SplitPane as="section" id="model" className="model-panel panel" size={setup ? 420 : 300} min={280} resizeLabel={text('Resize model setup', '调整模型设置宽度')}>
          <ContentPane id="control-model" label={text('Model and setup', '模型与设置')} as="div" surface="workspace" inset="compact" scroll="pane" header={<LibraryHeader density="compact" title={text('Model and setup', '模型与设置')} />}>
          {!isFilter && <Card tone="apricot" variant="soft" className="model-expression">{model}</Card>}
          <p className="muted">{isFilter ? text('Equal R/C, idealized op-amp', '等电阻等电容，理想运放') : text('Continuous SISO, unit feedback', '连续单输入单输出，单位反馈')}</p>
          {names.map((name) => {
            const field = template?.parameters.find((item) => item.name === name);
            const range = experiment.searchSpace[name];
            const value = draft[name];
            const slider = Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : range.min;
            return (
              <div className="param" key={name}>
                <div className="param-head">
                  <label htmlFor={`${name}-value`}>{fieldLabel(field?.label ?? name, locale)}{field?.unit && ` (${field.unit})`}</label>
                  <Input disabled={disabled} id={`${name}-value`} type="number" inputMode="decimal"
                    min={range.min} max={range.max} step={field?.step ?? "any"}
                    value={Number.isFinite(value) ? value : ""}
                    onChange={(event) => onDraft({ [name]: event.target.valueAsNumber })} />
                </div>
                <Slider disabled={disabled} aria-label={`${fieldLabel(field?.label ?? name, locale)} slider${field?.unit ? ` (${field.unit})` : ""}`} min={range.min} max={range.max} step={field?.step ?? "any"}
                  value={slider} onChange={(event) => onDraft({ [name]: event.target.valueAsNumber })} />
                <div className="slider-bounds"><span>{numeric(range.min)}</span><span>{numeric(range.max)}</span></div>
              </div>
            );
          })}
          {!setup && <dl className="facts">
            {fixed.map(([name, value]) => {
              const field = template?.parameters.find((item) => item.name === name);
              return <React.Fragment key={name}><dt>{fieldLabel(field?.label ?? name, locale)}</dt><dd>{numeric(value)}{field?.unit ? ` ${field.unit}` : ""}</dd></React.Fragment>;
            })}
            <dt>{text('Search cases', '搜索工况')}</dt><dd>{experiment.scenarios.filter((item) => item.role === "search").length}</dd>
            <dt>{text('Final cases', '最终工况')}</dt><dd>{rows.length}</dd>
          </dl>}
          <Button type="button" onClick={() => setPolicyOpen(true)}>{text('View verification policy', '查看核验策略')}</Button>
          </ContentPane>
        </SplitPane>
        <SplitPane as="section" id="response" className="response-panel panel" min={300}>
          <ContentPane id="control-response" label={setup ? text('Specification', '规格') : text('Response analysis', '响应分析')} as="div" surface="workspace" inset="compact" scroll="pane"
            header={<LibraryHeader density="compact" title={setup ? text('Specification', '规格') : text('Response analysis', '响应分析')} />}
            toolbar={!setup && hasResponses ? <Select label={text('Response scenario', '响应工况')} value={scenario?.id ?? ""} onChange={setScenarioId}
              options={scenarios.map(item => ({ value: item.id, label: item.label }))} /> : undefined}>
          {setup ?? <>
          {signal ? <Tabs value={signal.name} onValueChange={setSignalName}>
            <TabsList aria-label={text('Response signal', '响应信号')}>{series.map(item => <TabsTrigger key={item.name} value={item.name}>{signalLabel(item.name)}</TabsTrigger>)}</TabsList>
            {series.map(item => <TabsContent key={item.name} value={item.name}>
              <Curve {...item} candidateLabel={candidateLabel} showBaseline={showBaseline} target={chartTarget(experiment.templateId, item.name)} />
            </TabsContent>)}
          </Tabs> : <EmptyState heading={experiment.status === 'running' ? text('Simulation running', '仿真运行中') : selected?.status === 'failed' ? text('Simulation failed', '仿真失败') : selected?.status === 'cancelled' ? text('Simulation cancelled', '仿真已取消') : hasTrials ? text('No response for this scenario', '此工况没有响应') : text('Ready for the first response', '可以开始第一次响应')}
            description={experiment.status !== 'running' && hasTrials ? text('Review execution evidence below. Missing observations do not establish a pass.', '请查看下方的执行证据。缺少观测不能算作通过。') : undefined} />}
          {signal && <div className="curve-legend">
            {signal.baseline && <label className="baseline-toggle"><Checkbox checked={showBaseline} onCheckedChange={value => setShowBaseline(value === true)} /> {text('Baseline', '基线')}</label>}
            {signal.candidate && <span className="candidate-key">{candidateLabel}</span>}
            {signal && chartTarget(experiment.templateId, signal.name) != null && <span className="target-key">{text('Target', '目标')}</span>}
          </div>}
          {metrics.some(item => item.value != null) && <div className="run-summary">
            {metrics.map((item) => <div key={item.label}><strong>{numeric(item.value)}</strong><span>{item.label}</span></div>)}
          </div>}
          {selected?.error && <Feedback kind="error" variant="block">{selected.error}</Feedback>}
          {baseline?.error && baseline !== selected && <Feedback kind="error" variant="block">{text('Baseline', '基线')}: {baseline.error}</Feedback>}
          </>}
          </ContentPane>
        </SplitPane>
        {hasTrials && <SplitPane as="section" id="verification" className="verification-panel panel" size={300} min={260} resizeLabel={text('Resize verification', '调整核验宽度')}>
          <ContentPane id="control-verification" label={verified ? text('Final verification', '最终核验') : text('Search checks', '搜索检查')} as="div" surface="reading" inset="compact" scroll="pane"
            header={<InspectorHeader title={verified ? text('Final verification', '最终核验') : text('Search checks', '搜索检查')} status={<div className={`verdict-header status ${summary.verdict}`}><strong>{summary.title}</strong><span>{summary.detail}</span></div>} actions={candidateActions} />}>
          {summary.verdict !== "NOT_RUN" && issues.length > 0 && <div className="verify-list">{issues.map(renderCheck)}</div>}
          {verified && <Table label={text('Final scenario coverage', '最终工况覆盖')} density="compact" rows={rows} rowId={row => row.scenario.id} columns={[
            { id: 'scenario', header: text('Final scenario', '最终工况'), cell: row => row.scenario.label },
            { id: 'state', header: text('Evidence', '证据'), cell: row => <Badge tone={verdictTone(row.trial ? row.verdict : 'NOT_RUN')}>{row.trial ? `${row.trial.status} · ${row.verdict}` : text('Not run', '未运行')}</Badge> },
          ]}/>}
          {passes.length > 0 && <Disclosure variant="inline" summary={text('Passing checks', '已通过的检查')}>
            <div className="verify-list">{passes.map(renderCheck)}</div>
          </Disclosure>}
          {finalChecks.size > 0 && <Button variant="link" className="final-report-trigger" onClick={() => setReportOpen(true)}>{text('Final report checks', '最终报告检查')}</Button>}
          {suggestion?.values && <ContentSection id="control-suggestion" title={text('Suggested draft', '建议草案')} actions={<Button type="button" onClick={() => suggestion.values && onDraft(suggestion.values)}>{text('Use proposal', '采用建议')}</Button>}>
            <p>{suggestion.message}</p>
            <p>{names.map((name) => `${name} ${numeric(suggestion.values?.[name])}`).join(", ")}</p>
          </ContentSection>}
          </ContentPane>
        </SplitPane>}
      </Split>
      {experiment.candidates.length > 0 && <section className="candidate-panel panel">
        <LibraryHeader density="compact" title={text('Candidates', '候选')} subtitle={text(`${experiment.candidates.length} / ${experiment.candidateBudget} slots`, `${experiment.candidates.length} / ${experiment.candidateBudget} 个名额`)} />
        <RadioGroup aria-label={text('Selected candidate', '所选候选')} value={selectedId} onValueChange={onSelect}>
            <Table label={text('Candidates', '候选')} density="compact" rows={experiment.candidates} rowId={item => item.id} columns={[
              { id: 'candidate', header: text('Candidate', '候选'), size: 200, cell: item => <label className="candidate-option"><RadioGroupItem value={item.id} />{item.label}{experiment.lockedCandidateId === item.id ? text(' (locked)', '（已锁定）') : ''}</label> },
              { id: 'parameters', header: names.length ? names.join(' / ') : text('Parameters', '参数'), cell: item => names.length ? names.map(name => numeric(item.parameters[name])).join(' / ') : text('Fixed controller', '固定控制器') },
              ...worstMetrics(experiment, '').map((metric, index) => ({ metric, index }))
                .filter(({ index }) => experiment.candidates.some(item => worstMetrics(experiment, item.id)[index]?.value != null))
                .map(({ metric, index }) => ({ id: metric.label, header: metric.label, meta: { align: 'end' as const }, cell: (item: Experiment['candidates'][number]) => numeric(worstMetrics(experiment, item.id)[index]?.value) })),
              { id: 'verdict', header: text('Search verdict', '搜索结论'), cell: item => <Badge tone={verdictTone(item.verdict)}>{item.verdict === 'NOT_RUN' ? text('Not run', '未运行') : item.verdict}</Badge> },
            ]} />
        </RadioGroup>
        {hasTrials ? null : candidateActions}
      </section>}
      {reportOpen && finalChecks.size > 0 && <Dialog title={text('Final report checks', '最终报告检查')} closeLabel={text('Close final report', '关闭最终报告')} size="lg" onClose={() => setReportOpen(false)}>
        {[...finalChecks].map(([scenario, checks], index) => <ContentSection key={scenario} id={`control-final-${index}`} title={scenario}>
          <Checks label={`${scenario} verification checks`} checks={checks} units={units}/>
        </ContentSection>)}
      </Dialog>}
      {policyOpen && <Dialog title={text('Verification policy', '核验策略')} closeLabel={text('Close verification policy', '关闭核验策略')} onClose={() => setPolicyOpen(false)}>

        <Card tone="blue" variant="soft"><p>{text('Every listed condition uses the frozen criteria. A completed simulation is not a verified design.', '所列条件都使用已冻结的规格。仿真完成不等于设计已核验。')}</p></Card>
        {template?.criteria.map((field) => (
          <div className="meta-row" key={field.name}><span>{field.label}</span><strong>{numeric(experiment.criteria[field.name])}{field.unit ? ` ${field.unit}` : ""}</strong></div>
        ))}
        <ContentSection id="control-policy-scenarios" title={text('Scenarios', '工况')}>
        <ul>
          {experiment.scenarios.map((item) => (
            <li key={item.id}>{item.label} — {item.role}{Object.entries(item.parameters).map(([key, value]) => ` · ${key} ${numeric(value)}`).join("")}</li>
          ))}
        </ul>
        </ContentSection>
        <ContentSection id="control-policy-limits" title={text('Limitations', '限制')}>
        {experiment.limitations.map((text) => <p key={text}>{text}</p>)}
        </ContentSection>
        <Disclosure variant="inline" summary={<>{text('Specification hash and raw policy', '规格摘要与原始策略')}</>}>

          <pre>{JSON.stringify({ specHash: experiment.specHash, candidateBudget: experiment.candidateBudget, parameters: experiment.parameters, criteria: experiment.criteria, scenarios: experiment.scenarios }, null, 2)}</pre>
        </Disclosure>
      </Dialog>}
    </>
  );
}

export function Evidence({ experiment, linkedTrialId }: { experiment: Experiment; linkedTrialId?: string }) {
  const [trialId, setTrialId] = useState(linkedTrialId ?? '');
  const [rawOpen, setRawOpen] = useState(false);
  const evidencePanel = useRef<HTMLElement>(null);
  const { locale } = useAppContext();
  const text = (en: string, zhText: string) => locale === 'zh-CN' ? zhText : en;
  useEffect(() => {
    if (linkedTrialId) evidencePanel.current?.scrollIntoView({ block: 'start' });
  }, [linkedTrialId]);
  const trial = experiment.trials.find(item => item.id === trialId) ?? experiment.trials.at(-1);
  if (!trial) return null;
  return <section ref={evidencePanel} className="evidence-panel" aria-label={text('Execution evidence', '执行证据')}>
    <LibraryHeader density="compact" title={text('Evidence', '证据')} subtitle={text(`${experiment.trials.length} trials`, `${experiment.trials.length} 次试次`)} />
    <p className="muted">{text('Simulation evidence only; not physical validation.', '只有仿真证据，不是物理验证。')}</p>
    <RadioGroup aria-label={text('Selected evidence', '所选证据')} value={trial.id} onValueChange={setTrialId}>
      <Table label={text('Execution evidence', '执行证据')} density="compact" rows={experiment.trials} rowId={item => item.id} columns={[
        { id: 'trial', header: text('Trial', '试次'), size: 200, cell: item => <label className="candidate-option"><RadioGroupItem value={item.id}/>{experiment.candidates.find(candidate => candidate.id === item.candidateId)?.label ?? item.candidateId}</label> },
        { id: 'scenario', header: text('Scenario', '工况'), size: 200, cell: item => experiment.scenarios.find(scenario => scenario.id === item.scenarioId)?.label ?? item.scenarioId },
        { id: 'phase', header: text('Phase', '阶段'), cell: item => item.phase },
        { id: 'execution', header: text('Execution', '执行'), cell: item => item.status },
        { id: 'verdict', header: text('Verification', '核验'), cell: item => item.report ? <Badge tone={verdictTone(item.report.verdict)}>{item.report.verdict}</Badge> : text('No check report', '没有检查报告') },
      ]}/>
    </RadioGroup>
    <div className="evidence-detail">
      <ContentSection id="control-evidence-trial" title={`${experiment.scenarios.find(item => item.id === trial.scenarioId)?.label ?? trial.scenarioId} · ${trial.phase}`} actions={<Button onClick={() => setRawOpen(true)}>{text('Raw evidence / hash', '原始证据 / 摘要')}</Button>}>
      {trial.error && <Feedback kind="error" variant="block">{trial.error}</Feedback>}
      {trial.observation && <p className="muted">{trial.observation.engine} {trial.observation.engineVersion} · {text('observation', '观测')} {trial.observation.id}</p>}
      {trial.observation?.diagnostics.map((message, index) => <Feedback key={index} kind="warning">{message}</Feedback>)}
      {trial.report ? <Checks checks={trial.report.checks}/> : <Feedback>{text('No check report is available for this trial.', '这次试次没有检查报告。')}</Feedback>}
      </ContentSection>
    </div>
    {rawOpen && <Dialog title={text('Raw execution evidence', '原始执行证据')} closeLabel={text('Close raw evidence', '关闭原始证据')} size="lg" onClose={() => setRawOpen(false)}><p>{text('Specification hash:', '规格摘要：')} {experiment.specHash}</p><pre>{JSON.stringify(trial, null, 2)}</pre></Dialog>}
  </section>;
}
