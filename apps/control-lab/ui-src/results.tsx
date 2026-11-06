import { Disclosure, Badge, Button, Card, Checkbox, Dialog, EmptyState, Feedback, Input, Select, RadioGroup, RadioGroupItem, Slider, Table, Tabs, TabsContent, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
import React, { useState } from "react";
import { Split, SplitPane } from "@pero/app-sdk/ui";
import type { Experiment, Report, Series, Template } from "./types";
import {
  chartTarget,
  checkConcepts,
  curvePath,
  signalLabel,
  numeric,
  responseComparison,
  plotArea,
  suggestedDraft,
  verdictSummary,
  verificationRows,
  worstMetrics,
  type Concept,
} from "./presentation";

export function Checks({ report }: { report: Report }) {
  return <Table label="Verification checks" density="compact" rows={report.checks.map((check, index) => ({ ...check, key: String(index) }))} rowId={row => row.key} columns={[
    { id: 'name', header: 'Check', cell: row => row.name },
    { id: 'verdict', header: 'Verdict', cell: row => <Badge tone={verdictTone(row.verdict)}>{row.verdict}</Badge> },
    { id: 'actual', header: 'Actual', size: 90, meta: { align: 'end' }, cell: row => numeric(row.actual) },
    { id: 'limit', header: 'Limit', size: 90, meta: { align: 'end' }, cell: row => numeric(row.limit) },
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
  showBaseline,
  target,
}: {
  name: string;
  unit: string;
  baseline?: Series;
  candidate?: Series;
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
        aria-label={`${signalLabel(name)}: dashed baseline and solid candidate`}
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
          {showBaseline && baseline && <span>Baseline {numeric(baseline.y[nearest])}</span>}
          {candidate && <span>Selected {numeric(candidate.y[nearest])}</span>}
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
}) {
  const [scenarioId, setScenarioId] = useState("");
  const [signalName, setSignalName] = useState("");
  const [showBaseline, setShowBaseline] = useState(true);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const { scenarios, scenario, baseline, selected, series } = responseComparison(experiment, selectedId, scenarioId);
  const hasTrials = experiment.trials.length > 0;
  const hasResponses = experiment.trials.some(trial => trial.phase === "search" && trial.observation?.series.length);
  const signal = series.find((item) => item.name === signalName) ?? series[0];
  const candidate = experiment.candidates.find((item) => item.id === selectedId);
  const saved = candidate?.parameters ?? experiment.parameters;
  const names = [...(template?.parameters.map(field => field.name) ?? []), ...Object.keys(experiment.searchSpace)]
    .filter((name, index, all) => name in experiment.searchSpace && all.indexOf(name) === index);
  const dirty = names.some((name) => Math.abs((draft[name] ?? NaN) - (saved[name] ?? NaN)) > 1e-9);
  const verified = Boolean(experiment.lockedCandidateId && experiment.verificationOperationId);
  const phase = verified ? "verification" : "search";
  const focusId = verified ? experiment.lockedCandidateId! : selectedId;
  const concepts = checkConcepts(experiment, focusId, phase);
  const summary = verdictSummary(concepts, experiment.scenarios.filter((item) => item.role === phase).length);
  const suggestion = experiment.lockedCandidateId
    ? { values: null, message: "The final candidate is locked. Review the evidence. This is not acceptance." }
    : suggestedDraft(experiment.templateId, saved, experiment.searchSpace, concepts);
  const rows = verificationRows(experiment);
  const metrics = worstMetrics(experiment, selectedId);
  const model = experiment.templateId === "robust-pid"
    ? `G(s) = ${numeric(scenario?.parameters.gain ?? 1)} / (s² + ${numeric(2 * (scenario?.parameters.damping ?? 1))}s + 1)`
    : experiment.templateId === "p-golden" || experiment.templateId === "pi-golden"
      ? "G(s) = 1 / (s + 1)" : "Sallen–Key low-pass";
  const fixed = Object.entries(experiment.parameters).filter(([name]) => !names.includes(name));


  function focusConcept(concept: Concept) {
    setFocused(concept.name);
    if (!concept.chartScenarioId) return;
    setScenarioId(concept.chartScenarioId);
    if (concept.signal) setSignalName(concept.signal);
  }

  return (
    <>
      <Split key={hasTrials ? "results" : "setup"} className="workbench" data-preparing={!hasTrials || undefined} storageKey={hasTrials ? "control-lab.results.panes" : "control-lab.setup.panes"} collapseBelow={hasTrials ? 1080 : 760}>
        <SplitPane as="section" id="model" className="model-panel panel" size={setup ? 420 : 300} min={280} resizeLabel="Resize model setup">
          <h2>Model and setup</h2>
          <Card tone="apricot" variant="soft" className="model-expression">{model}</Card>
          <p className="muted">{experiment.templateId === "active-filter" ? "Equal R/C, idealized op-amp" : "Continuous SISO, unit feedback"}</p>
          {dirty && <Feedback kind="warning" variant="block">Draft. The chart still shows the saved candidate.</Feedback>}
          {names.map((name) => {
            const field = template?.parameters.find((item) => item.name === name);
            const range = experiment.searchSpace[name];
            const value = draft[name];
            const slider = Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : range.min;
            return (
              <div className="param" key={name}>
                <div className="param-head">
                  <label htmlFor={`${name}-value`}>{field?.label ?? name}</label>
                  <Input disabled={disabled} id={`${name}-value`} type="number" inputMode="decimal" aria-label={field?.label ?? name}
                    min={range.min} max={range.max} step={field?.step ?? "any"}
                    value={Number.isFinite(value) ? value : ""}
                    onChange={(event) => onDraft({ [name]: event.target.valueAsNumber })} />
                </div>
                <Slider disabled={disabled} aria-label={`${field?.label ?? name} slider`} min={range.min} max={range.max} step={field?.step ?? "any"}
                  value={slider} onChange={(event) => onDraft({ [name]: event.target.valueAsNumber })} />
                <div className="slider-bounds"><span>{numeric(range.min)}</span><span>{numeric(range.max)}{field?.unit ? ` ${field.unit}` : ""}</span></div>
              </div>
            );
          })}
          {!setup && <dl className="facts">
            {fixed.map(([name, value]) => {
              const field = template?.parameters.find((item) => item.name === name);
              return <React.Fragment key={name}><dt>{field?.label ?? name}</dt><dd>{numeric(value)}{field?.unit ? ` ${field.unit}` : ""}</dd></React.Fragment>;
            })}
            <dt>Search cases</dt><dd>{experiment.scenarios.filter((item) => item.role === "search").length}</dd>
            <dt>Final cases</dt><dd>{rows.length}</dd>
          </dl>}
          <Button type="button" onClick={() => setPolicyOpen(true)}>View verification policy</Button>
        </SplitPane>
        <SplitPane as="section" id="response" className="response-panel panel" min={300}>
          {setup ?? <>
          <div className="panel-heading">
            <h2>Response analysis</h2>
            {hasResponses && <Select label="Response scenario" value={scenario?.id ?? ""} onChange={setScenarioId}
              options={scenarios.map(item => ({ value: item.id, label: item.label }))}/>}
          </div>
          {candidate && <p className="muted">{candidate.label}{dirty ? " (saved run)" : ""}</p>}
          {signal ? <Tabs value={signal.name} onValueChange={setSignalName}>
            <TabsList aria-label="Response signal">{series.map(item => <TabsTrigger key={item.name} value={item.name}>{signalLabel(item.name)}</TabsTrigger>)}</TabsList>
            {series.map(item => <TabsContent key={item.name} value={item.name}>
              <Curve {...item} showBaseline={showBaseline} target={chartTarget(experiment.templateId, item.name)} />
            </TabsContent>)}
          </Tabs> : <EmptyState heading={experiment.status === 'running' ? 'Simulation running' : selected?.status === 'failed' ? 'Simulation failed' : selected?.status === 'cancelled' ? 'Simulation cancelled' : hasTrials ? 'No response for this scenario' : 'Ready for the first response'}
            description={experiment.status === 'running' ? 'Completed observations will appear here.' : hasTrials ? 'Review execution evidence below. Missing observations do not establish a pass.' : 'Review the parameters and acceptance criteria, then choose Run experiment.'} />}
          {signal && <div className="curve-legend">
            {signal.baseline && <label className="baseline-toggle"><Checkbox checked={showBaseline} onCheckedChange={value => setShowBaseline(value === true)} /> Baseline</label>}
            {signal.candidate && <span className="candidate-key">Selected</span>}
            {signal && chartTarget(experiment.templateId, signal.name) != null && <span className="target-key">Target</span>}
          </div>}
          {metrics.some(item => item.value != null) && <div className="run-summary">
            {metrics.map((item) => <div key={item.label}><strong>{numeric(item.value)}</strong><span>{item.label}</span></div>)}
          </div>}
          {selected?.error && <Feedback kind="error" variant="block">{selected.error}</Feedback>}
          {baseline?.error && baseline !== selected && <Feedback kind="error" variant="block">Baseline: {baseline.error}</Feedback>}
          {!hasTrials && <Card variant="soft" className="preflight-summary"><strong>Not yet verified</strong><p>{scenarios.length} search scenarios · {rows.length} final scenarios</p><p>{setup ? "Acceptance criteria remain editable until the specification is frozen." : "The acceptance criteria are frozen for this experiment."} A completed simulation is not a verified design.</p></Card>}
          </>}
        </SplitPane>
        {hasTrials && <SplitPane as="section" id="verification" className="verification-panel panel" size={300} min={260} resizeLabel="Resize verification">
          <div className="panel-heading"><h2>Verification</h2><span className="muted">{verified ? "Final scenarios" : "Search evidence"}</span></div>
          <div className={`verdict-header status ${summary.verdict}`}>
            <strong>{summary.title}</strong>
            <span>{summary.detail}</span>
          </div>
          {summary.verdict !== "NOT_RUN" && <div className="verify-list">
            {concepts.map((concept) => (
              <Button variant="ghost" aria-pressed={focused === concept.name} type="button" key={concept.name} className={`check-row ${focused === concept.name ? "focused" : ""}`} onClick={() => focusConcept(concept)}>
                <span>{concept.name}</span>
                {concept.limit != null && <small>Limit {numeric(concept.limit)}</small>}
                {concept.actual != null && <strong>{numeric(concept.actual)}</strong>}
                <Badge tone={verdictTone(concept.verdict)}>{concept.verdict}</Badge>
              </Button>
            ))}
          </div>}
          {focused && concepts.find((concept) => concept.name === focused) && (
            <p className="check-message">
              {concepts.find((concept) => concept.name === focused)?.message}
              {concepts.find((concept) => concept.name === focused)?.scenarioId
                && !concepts.find((concept) => concept.name === focused)?.chartScenarioId
                && " Held-out evidence is not drawn on the comparison chart."}
            </p>
          )}
          <p className="muted">Read-only policy. A check focuses a search scenario when that observation is on the chart.</p>
          {verified && <Table label="Final scenario coverage" density="compact" rows={rows} rowId={row => row.scenario.id} columns={[
            { id: 'scenario', header: 'Final scenario', cell: row => row.scenario.label },
            { id: 'state', header: 'Evidence', cell: row => <Badge tone={verdictTone(row.trial ? row.verdict : 'NOT_RUN')}>{row.trial ? `${row.trial.status} · ${row.verdict}` : 'Not run'}</Badge> },
          ]}/>}
          {experiment.report && <Checks report={experiment.report} />}
          <div className="suggestion">
            <div className="panel-heading"><h3>Suggested draft</h3><span className="muted">Suggested</span></div>
            <p>{suggestion.message}</p>
            {suggestion.values && (
              <div className="suggestion-actions">
                <span>{names.map((name) => `${name} ${numeric(suggestion.values?.[name])}`).join(", ")}</span>
                <Button type="button" onClick={() => suggestion.values && onDraft(suggestion.values)}>Use proposal</Button>
              </div>
            )}
          </div>
        </SplitPane>}
      </Split>
      {experiment.candidates.length > 0 && <section className="candidate-panel panel">
        <div className="panel-heading">
          <h2>Candidates {experiment.candidates.length}</h2>
          <span className="muted">{experiment.candidates.length} / {experiment.candidateBudget} slots</span>
        </div>
        {experiment.candidates.length ? (
          <RadioGroup aria-label="Selected candidate" value={selectedId} onValueChange={onSelect}>
            <Table label="Candidates" density="compact" rows={experiment.candidates} rowId={item => item.id} columns={[
              { id: 'candidate', header: 'Candidate', size: 200, cell: item => <label className="candidate-option"><RadioGroupItem value={item.id} />{item.label}{experiment.lockedCandidateId === item.id ? ' (locked)' : ''}</label> },
              { id: 'parameters', header: names.length ? names.join(' / ') : 'Parameters', cell: item => names.length ? names.map(name => numeric(item.parameters[name])).join(' / ') : 'Fixed controller' },
              ...worstMetrics(experiment, '').map((metric, index) => ({ metric, index }))
                .filter(({ index }) => experiment.candidates.some(item => worstMetrics(experiment, item.id)[index]?.value != null))
                .map(({ metric, index }) => ({ id: metric.label, header: metric.label, meta: { align: 'end' as const }, cell: (item: Experiment['candidates'][number]) => numeric(worstMetrics(experiment, item.id)[index]?.value) })),
              { id: 'verdict', header: 'Search verdict', cell: item => <Badge tone={verdictTone(item.verdict)}>{item.verdict === 'NOT_RUN' ? 'Not run' : item.verdict}</Badge> },
            ]} />
          </RadioGroup>
        ) : <EmptyState heading="No candidates yet" description="Run the draft to record the first one." />}
      </section>}
      {policyOpen && <Dialog title="Verification policy" closeLabel="Close verification policy" onClose={() => setPolicyOpen(false)}>

        <Card tone="blue" variant="soft"><p>Every listed condition uses the frozen criteria. A completed simulation is not a verified design.</p></Card>
        {template?.criteria.map((field) => (
          <div className="meta-row" key={field.name}><span>{field.label}</span><strong>{numeric(experiment.criteria[field.name])}{field.unit ? ` ${field.unit}` : ""}</strong></div>
        ))}
        <h3>Scenarios</h3>
        <ul>
          {experiment.scenarios.map((item) => (
            <li key={item.id}>{item.label} — {item.role}{Object.entries(item.parameters).map(([key, value]) => ` · ${key} ${numeric(value)}`).join("")}</li>
          ))}
        </ul>
        <h3>Limitations</h3>
        {experiment.limitations.map((text) => <p key={text}>{text}</p>)}
        <Disclosure variant="inline" summary={<>Specification hash and raw policy</>}>

          <pre>{JSON.stringify({ specHash: experiment.specHash, candidateBudget: experiment.candidateBudget, parameters: experiment.parameters, criteria: experiment.criteria, scenarios: experiment.scenarios }, null, 2)}</pre>
        </Disclosure>
      </Dialog>}
    </>
  );
}

export function Evidence({ experiment }: { experiment: Experiment }) {
  const [trialId, setTrialId] = useState('');
  const [rawOpen, setRawOpen] = useState(false);
  const trial = experiment.trials.find(item => item.id === trialId) ?? experiment.trials.at(-1);
  if (!trial) return null;
  return <section className="evidence-panel" aria-label="Execution evidence">
    <h2>Evidence · {experiment.trials.length} trials</h2>
    <p className="muted">Simulation evidence only; not physical validation. Execution status and verification verdict are separate.</p>
    <RadioGroup aria-label="Selected evidence" value={trial.id} onValueChange={setTrialId}>
      <Table label="Execution evidence" density="compact" rows={experiment.trials} rowId={item => item.id} columns={[
        { id: 'trial', header: 'Trial', size: 200, cell: item => <label className="candidate-option"><RadioGroupItem value={item.id}/>{experiment.candidates.find(candidate => candidate.id === item.candidateId)?.label ?? item.candidateId}</label> },
        { id: 'scenario', header: 'Scenario', size: 200, cell: item => experiment.scenarios.find(scenario => scenario.id === item.scenarioId)?.label ?? item.scenarioId },
        { id: 'phase', header: 'Phase', cell: item => item.phase },
        { id: 'execution', header: 'Execution', cell: item => item.status },
        { id: 'verdict', header: 'Verification', cell: item => item.report ? <Badge tone={verdictTone(item.report.verdict)}>{item.report.verdict}</Badge> : 'No check report' },
      ]}/>
    </RadioGroup>
    <div className="evidence-detail">
      <div className="panel-heading"><h3>{experiment.scenarios.find(item => item.id === trial.scenarioId)?.label ?? trial.scenarioId} · {trial.phase}</h3><Button onClick={() => setRawOpen(true)}>Raw evidence / hash</Button></div>
      {trial.error && <Feedback kind="error" variant="block">{trial.error}</Feedback>}
      {trial.observation && <p className="muted">{trial.observation.engine} {trial.observation.engineVersion} · observation {trial.observation.id}</p>}
      {trial.observation?.diagnostics.map((message, index) => <Feedback key={index} kind="warning">{message}</Feedback>)}
      {trial.report ? <Checks report={trial.report}/> : <Feedback>No check report is available for this trial.</Feedback>}
    </div>
    {rawOpen && <Dialog title="Raw execution evidence" closeLabel="Close raw evidence" size="lg" onClose={() => setRawOpen(false)}><p>Specification hash: {experiment.specHash}</p><pre>{JSON.stringify(trial, null, 2)}</pre></Dialog>}
  </section>;
}
