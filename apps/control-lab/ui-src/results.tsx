import React, { useEffect, useRef, useState } from "react";
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
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Check</th>
            <th>Verdict</th>
            <th>Actual</th>
            <th>Limit</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {report.checks.map((check, index) => (
            <tr key={index}>
              <td>{check.name}</td>
              <td className={`status ${check.verdict}`}>{check.verdict}</td>
              <td>{numeric(check.actual)}</td>
              <td>{numeric(check.limit)}</td>
              <td>{check.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
}: {
  experiment: Experiment;
  selectedId: string;
  template?: Template;
  draft: Record<string, number>;
  onDraft: (values: Record<string, number>) => void;
  onSelect: (id: string) => void;
}) {
  const [scenarioId, setScenarioId] = useState("");
  const [signalName, setSignalName] = useState("");
  const [showBaseline, setShowBaseline] = useState(true);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { scenarios, scenario, selected, series } = responseComparison(experiment, selectedId, scenarioId);
  const signal = series.find((item) => item.name === signalName) ?? series[0];
  const candidate = experiment.candidates.find((item) => item.id === selectedId);
  const saved = candidate?.parameters ?? experiment.parameters;
  const names = Object.keys(experiment.searchSpace);
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
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (policyOpen && !dialog.open) dialog.showModal();
    if (!policyOpen && dialog.open) dialog.close();
  }, [policyOpen]);

  function focusConcept(concept: Concept) {
    setFocused(concept.name);
    if (!concept.chartScenarioId) return;
    setScenarioId(concept.chartScenarioId);
    if (concept.signal) setSignalName(concept.signal);
  }

  return (
    <>
      <div className="workbench">
        <section className="model-panel panel">
          <h2>Model and setup</h2>
          <div className="model-expression">{model}</div>
          <p className="muted">{experiment.templateId === "active-filter" ? "Equal R/C, idealized op-amp" : "Continuous SISO, unit feedback"}</p>
          {dirty && <p className="draft-label" role="status">Draft. The chart still shows the saved candidate.</p>}
          {names.map((name) => {
            const field = template?.parameters.find((item) => item.name === name);
            const range = experiment.searchSpace[name];
            const value = draft[name];
            const slider = Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : range.min;
            return (
              <div className="param" key={name}>
                <div className="param-head">
                  <label htmlFor={`${name}-value`}>{field?.label ?? name}</label>
                  <input id={`${name}-value`} type="number" inputMode="decimal" aria-label={field?.label ?? name}
                    min={range.min} max={range.max} step={field?.step ?? "any"}
                    value={Number.isFinite(value) ? value : ""}
                    onChange={(event) => onDraft({ [name]: event.target.valueAsNumber })} />
                </div>
                <input type="range" aria-label={`${field?.label ?? name} slider`} min={range.min} max={range.max} step={field?.step ?? "any"}
                  value={slider} onChange={(event) => onDraft({ [name]: event.target.valueAsNumber })} />
                <div className="slider-bounds"><span>{numeric(range.min)}</span><span>{numeric(range.max)}{field?.unit ? ` ${field.unit}` : ""}</span></div>
              </div>
            );
          })}
          <dl className="facts">
            {fixed.map(([name, value]) => {
              const field = template?.parameters.find((item) => item.name === name);
              return <React.Fragment key={name}><dt>{field?.label ?? name}</dt><dd>{numeric(value)}{field?.unit ? ` ${field.unit}` : ""}</dd></React.Fragment>;
            })}
            <dt>Search cases</dt><dd>{experiment.scenarios.filter((item) => item.role === "search").length}</dd>
            <dt>Final cases</dt><dd>{rows.length}</dd>
          </dl>
          <button type="button" onClick={() => setPolicyOpen(true)}>View verification policy</button>
        </section>
        <section className="response-panel panel">
          <div className="panel-heading">
            <h2>Response analysis</h2>
            <select aria-label="Response scenario" value={scenario?.id ?? ""} onChange={(event) => setScenarioId(event.target.value)}>
              {scenarios.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
          <p className="muted">{candidate?.label ?? "Initial parameters"}{dirty ? " · showing saved run" : ""}</p>
          {series.length > 0 && <div className="signal-tabs" role="group" aria-label="Response signal">
            {series.map((item) => <button key={item.name} type="button" aria-pressed={signal?.name === item.name}
              onClick={() => setSignalName(item.name)}>{signalLabel(item.name)}</button>)}
          </div>}
          {signal ? <Curve {...signal} showBaseline={showBaseline} target={chartTarget(experiment.templateId, signal.name)} /> : <div className="chart-empty"><h3>No response yet</h3><p>Run the draft to compare candidates.</p></div>}
          <div className="curve-legend">
            <label className="baseline-toggle"><input type="checkbox" checked={showBaseline} onChange={(event) => setShowBaseline(event.target.checked)} /> Baseline</label>
            <span className="candidate-key">Selected</span>
            {signal && chartTarget(experiment.templateId, signal.name) != null && <span className="target-key">Target</span>}
          </div>
          <div className="run-summary">
            {metrics.map((item) => <div key={item.label}><strong>{numeric(item.value)}</strong><span>{item.label}</span></div>)}
          </div>
          {selected?.error && <p className="error" role="alert">{selected.error}</p>}
          {selected?.report && <details className="search-checks"><summary>Selected search checks: {selected.report.verdict}</summary><Checks report={selected.report} /></details>}
        </section>
        <section className="verification-panel panel">
          <div className="panel-heading"><h2>Verification</h2><span className="muted">{verified ? "Final scenarios" : "Search evidence"}</span></div>
          <div className={`verdict-header status ${summary.title === "All checks passed" ? "PASS" : summary.title.includes("failed") ? "FAIL" : "INCONCLUSIVE"}`}>
            <strong>{summary.title}</strong>
            <span>{summary.detail}</span>
          </div>
          <div className="verify-list">
            {concepts.map((concept) => (
              <button type="button" key={concept.name} className={`check-row ${focused === concept.name ? "focused" : ""}`} onClick={() => focusConcept(concept)}>
                <span>{concept.name}</span>
                <small>Limit {numeric(concept.limit)}</small>
                <strong>{numeric(concept.actual)}</strong>
                <span className={`verdict-pill ${concept.verdict}`}>{concept.verdict}</span>
              </button>
            ))}
          </div>
          {focused && concepts.find((concept) => concept.name === focused) && (
            <p className="check-message">
              {concepts.find((concept) => concept.name === focused)?.message}
              {concepts.find((concept) => concept.name === focused)?.scenarioId
                && !concepts.find((concept) => concept.name === focused)?.chartScenarioId
                && " Held-out evidence is not drawn on the comparison chart."}
            </p>
          )}
          <p className="muted">Read-only policy. A check focuses a search scenario when that observation is on the chart.</p>
          {experiment.report && <details><summary>Final report checks</summary><Checks report={experiment.report} /></details>}
          <div className="suggestion">
            <div className="panel-heading"><h3>Suggested draft</h3><span className="muted">Suggested</span></div>
            <p>{suggestion.message}</p>
            {suggestion.values && (
              <div className="suggestion-actions">
                <span>{names.map((name) => `${name} ${numeric(suggestion.values?.[name])}`).join(" · ")}</span>
                <button type="button" onClick={() => suggestion.values && onDraft(suggestion.values)}>Use proposal</button>
              </div>
            )}
          </div>
        </section>
      </div>
      <section className="candidate-panel panel">
        <div className="panel-heading">
          <h2>Candidates {experiment.candidates.length}</h2>
          <span className="muted">{experiment.candidates.length} / {experiment.candidateBudget} slots</span>
        </div>
        {experiment.candidates.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>{names.length ? names.join(" / ") : "Parameters"}</th>
                  {worstMetrics(experiment, "").map((metric) => <th key={metric.label}>{metric.label}</th>)}
                  <th>Search verdict</th>
                </tr>
              </thead>
              <tbody>
                {experiment.candidates.map((item) => (
                  <tr key={item.id} className={selectedId === item.id ? "selected" : undefined} tabIndex={0} role="button"
                    aria-pressed={selectedId === item.id} aria-label={`Select ${item.label}`}
                    onClick={() => onSelect(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(item.id);
                      }
                    }}>
                    <td>{item.label}{experiment.lockedCandidateId === item.id ? " (locked)" : ""}</td>
                    <td>{names.length ? names.map((name) => numeric(item.parameters[name])).join(" / ") : "Fixed controller"}</td>
                    {worstMetrics(experiment, item.id).map((metric) => <td key={metric.label}>{numeric(metric.value)}</td>)}
                    <td><span className={`verdict-pill ${item.verdict}`}>{item.verdict}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p>No candidates yet. Run the draft to record the first one.</p>}
      </section>
      <dialog ref={dialogRef} className="policy-dialog" aria-label="Verification policy" onClose={() => setPolicyOpen(false)}>
        <div className="panel-heading"><h2>Verification policy</h2><button type="button" onClick={() => setPolicyOpen(false)}>Close</button></div>
        <p>Every listed condition uses the frozen criteria. A completed simulation is not a verified design.</p>
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
        <details>
          <summary>Specification hash and raw policy</summary>
          <pre>{JSON.stringify({ specHash: experiment.specHash, candidateBudget: experiment.candidateBudget, parameters: experiment.parameters, criteria: experiment.criteria, scenarios: experiment.scenarios }, null, 2)}</pre>
        </details>
      </dialog>
    </>
  );
}

export function Evidence({ experiment }: { experiment: Experiment }) {
  return <details className="evidence-panel">
    <summary>Evidence ({experiment.trials.length} trials)</summary>
    <p className="muted">Simulation evidence only; not physical validation.</p>
    {experiment.trials.map((trial) => <details key={trial.id}>
      <summary>{experiment.candidates.find((c) => c.id === trial.candidateId)?.label ?? trial.candidateId} / {trial.scenarioId} / {trial.phase}: {trial.status}, {trial.report?.verdict ?? "INCONCLUSIVE"}</summary>
      {trial.error && <p className="error">{trial.error}</p>}<pre>{JSON.stringify(trial, null, 2)}</pre>
    </details>)}
  </details>;
}
