import React, { useState } from "react";
import type { Experiment, Report, Series, Template } from "./types";
import {
  curvePath,
  signalLabel,
  failedCheckGroups,
  numeric,
  responseComparison,
  plotArea,
  verificationRows,
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
function Curve({
  name,
  unit,
  baseline,
  candidate,
}: {
  name: string;
  unit: string;
  baseline?: Series;
  candidate?: Series;
}) {
  const original = [baseline, candidate].filter(Boolean) as Series[];
  const logarithmic =
    original.length > 0 &&
    original.every(
      (series) => series.xUnit === "Hz" && series.x.every((x) => x > 0),
    );
  if (logarithmic) {
    if (baseline) baseline = { ...baseline, x: baseline.x.map(Math.log10) };
    if (candidate) candidate = { ...candidate, x: candidate.x.map(Math.log10) };
  }
  const all = [baseline, candidate].filter(Boolean) as Series[];
  const points = all.flatMap((series) =>
    series.x
      .map((x, i) => [x, series.y[i]])
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
  );
  if (!points.length) return <p>No finite observations for {signalLabel(name)}.</p>;
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const bounds: [number, number, number, number] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  return (
    <figure>
      <figcaption>
        {signalLabel(name)}
        {unit && ` (${unit})`}
      </figcaption>
      <svg
        className="chart"
        viewBox="0 0 560 240"
        role="img"
        aria-label={`${signalLabel(name)}: dashed baseline and solid candidate`}
      >
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line key={fraction} x1={plotArea.left} x2={plotArea.right}
            y1={plotArea.top + (plotArea.bottom - plotArea.top) * fraction}
            y2={plotArea.top + (plotArea.bottom - plotArea.top) * fraction}
            strokeDasharray="3 4" />
        ))}
        <line
          x1={plotArea.left}
          y1={plotArea.bottom}
          x2={plotArea.right}
          y2={plotArea.bottom}
        />
        <line
          x1={plotArea.left}
          y1={plotArea.top}
          x2={plotArea.left}
          y2={plotArea.bottom}
        />
        {baseline && (
          <path
            d={curvePath(baseline, bounds)}
            stroke="var(--pero-data-orange-line, #b86a18)"
            strokeDasharray="6 4"
            fill="none"
            strokeWidth="2"
          />
        )}
        {candidate && (
          <path
            d={curvePath(candidate, bounds)}
            stroke="var(--pero-action)"
            fill="none"
            strokeWidth="2"
          />
        )}
        <text x={plotArea.left} y="222">
          {numeric(logarithmic ? 10 ** bounds[0] : bounds[0])}
        </text>
        <text
          x={(plotArea.left + plotArea.right) / 2}
          y="236"
          textAnchor="middle"
        >
          {logarithmic
            ? "Frequency (Hz, log scale)"
            : candidate?.xUnit === "s" || baseline?.xUnit === "s"
              ? "Time (s)"
              : (candidate?.xUnit ?? baseline?.xUnit ?? "x")}
        </text>
        <text x={plotArea.right} y="222" textAnchor="end">
          {numeric(logarithmic ? 10 ** bounds[1] : bounds[1])}
        </text>
        <text x={plotArea.left - 4} y={plotArea.top} textAnchor="end">
          {numeric(bounds[3])}
        </text>
        <text x={plotArea.left - 4} y={plotArea.bottom} textAnchor="end">
          {numeric(bounds[2])}
        </text>
      </svg>
    </figure>
  );
}
export function Results({ experiment, selectedId, template }: { experiment: Experiment; selectedId: string; template?: Template }) {
  const [scenarioId, setScenarioId] = useState("");
  const [signalName, setSignalName] = useState("");
  const { scenarios, scenario, selected, series } = responseComparison(experiment, selectedId, scenarioId);
  const signal = series.find((item) => item.name === signalName) ?? series[0];
  const rows = verificationRows(experiment);
  const candidate = experiment.candidates.find((item) => item.id === selectedId);
  const parameters = candidate?.parameters ?? experiment.parameters;
  const model = experiment.templateId === "robust-pid"
    ? `G(s) = ${numeric(scenario?.parameters.gain ?? 1)} / (s² + ${numeric(2 * (scenario?.parameters.damping ?? 1))}s + 1)`
    : experiment.templateId === "p-golden" || experiment.templateId === "pi-golden"
      ? "G(s) = 1 / (s + 1)" : "Sallen–Key low-pass";

  return (
    <div className="workbench">
      <section className="model-panel panel">
        <h2>Model &amp; setup</h2>
        <div className="model-expression">{model}</div>
        <p className="muted">{experiment.templateId === "active-filter" ? "Equal R/C, idealized op-amp" : "Continuous SISO"}</p>
        <h3>{candidate?.label ?? "Initial parameters"}</h3>
        <dl className="facts">
          {Object.entries(parameters).map(([name, value]) => {
            const field = template?.parameters.find((item) => item.name === name);
            return <React.Fragment key={name}><dt>{field?.label ?? name.replaceAll("_", " ")}</dt><dd>{numeric(value)}{field?.unit && ` ${field.unit}`}</dd></React.Fragment>;
          })}
        </dl>
        <details>
          <summary>Specification and policy</summary>
          <pre>{JSON.stringify({ specHash: experiment.specHash, candidateBudget: experiment.candidateBudget,
            parameters: experiment.parameters, criteria: experiment.criteria, scenarios: experiment.scenarios }, null, 2)}</pre>
        </details>
      </section>
      <section className="response-panel panel">
        <div className="panel-heading"><h2>Response analysis</h2>
          <select aria-label="Response scenario" value={scenario?.id ?? ""} onChange={(event) => setScenarioId(event.target.value)}>
            {scenarios.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        {series.length > 0 && <div className="signal-tabs" role="group" aria-label="Response signal">
          {series.map((item) => <button key={item.name} aria-pressed={signal?.name === item.name}
            onClick={() => setSignalName(item.name)}>{signalLabel(item.name)}</button>)}
        </div>}
        {signal ? <><Curve {...signal} /><div className="curve-legend">
          {signal.baseline && <span className="baseline-key">Baseline (dashed)</span>}
          {signal.candidate && <span className="candidate-key">Selected candidate</span>}
        </div></> : <div className="chart-empty"><h3>No response yet</h3><p>Run bounded search to compare candidates.</p></div>}
        {selected?.error && <p className="error" role="alert">{selected.error}</p>}
        {selected?.report && <details className="search-checks"><summary>Selected search checks: {selected.report.verdict}</summary><Checks report={selected.report} /></details>}
      </section>
      <section className="verification-panel panel">
        <h2>Independent verification</h2>
        <p>{experiment.lockedCandidateId
          ? `Locked candidate: ${experiment.candidates.find((item) => item.id === experiment.lockedCandidateId)?.label ?? experiment.lockedCandidateId}`
          : "Not locked"}</p>
        {experiment.lockedCandidateId && selectedId !== experiment.lockedCandidateId && <p className="muted" role="status">Different from selected response</p>}
        <p className={`status ${experiment.report?.verdict ?? "INCONCLUSIVE"}`}>{experiment.report?.verdict ?? "INCONCLUSIVE"}</p>
        <p className="muted">{rows.filter((row) => row.verdict === "PASS").length} / {rows.length} final scenarios passed</p>
        <div className="table-scroll"><table>
          <thead><tr><th>Scenario</th><th>Result</th></tr></thead>
          <tbody>{rows.map(({ scenario, trial, verdict }) => <tr key={scenario.id}>
            <td>{scenario.label}<small className="execution-state">{trial?.status ?? "Not run"}</small></td>
            <td><span className={`status ${verdict}`}>{verdict}</span>
              {trial?.error && <p className="error">{trial.error}</p>}
              {trial?.report && <details><summary>Checks</summary><Checks report={trial.report} /></details>}
            </td>
          </tr>)}</tbody>
        </table></div>
        {failedCheckGroups(experiment).map(({ name, failures }) => (
          <div className="failed-check" key={name}>
            <strong>{name}</strong><span className="status FAIL">FAIL</span>
            <small>{failures[0].scenario}</small><span>{numeric(failures[0].check.actual)} / limit {numeric(failures[0].check.limit)}</span>
            <details className="check-message"><summary>{failures.length} failed {failures.length === 1 ? "scenario" : "scenarios"}</summary>
              {failures.map(({ scenario, check }, index) => <p key={index}><strong>{scenario}</strong>: {numeric(check.actual)} / limit {numeric(check.limit)}. {check.message}</p>)}
            </details>
          </div>
        ))}
        {experiment.report && <details><summary>Final report checks</summary><Checks report={experiment.report} /></details>}
      </section>
    </div>
  );
}
export function Evidence({ experiment }: { experiment: Experiment }) {
  return <details className="evidence-panel">
    <summary>Evidence ({experiment.trials.length} trials)</summary>
    <p className="muted">Simulation evidence only; not physical validation.</p>
    <details><summary>Scope and limitations</summary>{experiment.limitations.map((text, i) => <p key={i}>{text}</p>)}</details>
    {experiment.trials.map((trial) => <details key={trial.id}>
      <summary>{experiment.candidates.find((c) => c.id === trial.candidateId)?.label ?? trial.candidateId} / {trial.scenarioId} / {trial.phase}: {trial.status}, {trial.report?.verdict ?? "INCONCLUSIVE"}</summary>
      {trial.error && <p className="error">{trial.error}</p>}<pre>{JSON.stringify(trial, null, 2)}</pre>
    </details>)}
  </details>;
}
