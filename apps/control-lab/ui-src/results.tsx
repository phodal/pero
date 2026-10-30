import React from "react";
import type { Experiment, Report, Series } from "./types";
import {
  curvePath,
  numeric,
  pairedSeries,
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
  if (!points.length) return <p>No finite observations for {name}.</p>;
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
        {name}
        {unit && ` (${unit})`}
      </figcaption>
      <svg
        className="chart"
        viewBox="0 0 560 240"
        role="img"
        aria-label={`${name}: dashed baseline and solid candidate`}
      >
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
            stroke="var(--pero-text-muted)"
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
export function Results({
  experiment,
  selectedId,
}: {
  experiment: Experiment;
  selectedId: string;
}) {
  const baselineId = experiment.candidates[0]?.id;
  const rows = verificationRows(experiment);
  return (
    <>
      <section>
        <h2>Baseline and candidate</h2>
        <p className="muted">
          Dashed: baseline. Solid: selected candidate. Curves are recorded
          engine observations.
        </p>
        {experiment.scenarios
          .filter((s) => s.role === "search")
          .map((scenario) => {
            const baseline = experiment.trials
              .filter(
                (t) =>
                  t.candidateId === baselineId && t.scenarioId === scenario.id,
              )
              .at(-1);
            const selected = experiment.trials
              .filter(
                (t) =>
                  t.candidateId === selectedId && t.scenarioId === scenario.id,
              )
              .at(-1);
            return (
              <div key={scenario.id}>
                <h3>{scenario.label}</h3>
                {!baseline?.observation && !selected?.observation ? (
                  <p className="muted">
                    No observation recorded.
                    {selected?.error && ` ${selected.error}`}
                  </p>
                ) : (
                  <div className="charts">
                    {pairedSeries(baseline, selected).map((series) => (
                      <Curve key={series.name} {...series} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
      </section>
      <section>
        <h2>Independent verification</h2>
        <p>
          <span
            className={`status ${experiment.report?.verdict ?? "INCONCLUSIVE"}`}
          >
            {experiment.report?.verdict ?? "INCONCLUSIVE"}
          </span>{" "}
          — {rows.filter((row) => row.verdict === "PASS").length} /{" "}
          {rows.length} final scenarios passed.
        </p>
        <p className="muted">
          Execution completed does not mean engineering PASS. Missing, failed
          and cancelled trials remain in the denominator.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Execution</th>
                <th>Verdict</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ scenario, trial, verdict }) => (
                <tr key={scenario.id}>
                  <td>{scenario.label}</td>
                  <td>{trial?.status ?? "Not run"}</td>
                  <td className={`status ${verdict}`}>{verdict}</td>
                  <td>
                    {trial?.error ??
                      (trial?.report ? (
                        <details>
                          <summary>Checks</summary>
                          <Checks report={trial.report} />
                        </details>
                      ) : (
                        "No verified observation"
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {experiment.report && (
          <details>
            <summary>Final report checks</summary>
            <Checks report={experiment.report} />
          </details>
        )}
      </section>
      <section>
        <h2>Evidence</h2>
        {experiment.limitations.map((text, i) => (
          <p className="notice" key={i}>
            {text}
          </p>
        ))}
        <p>
          {experiment.trials.length} recorded trials;{" "}
          {experiment.trials.filter((t) => t.status !== "completed").length}{" "}
          failed or cancelled.
        </p>
        {experiment.trials.map((trial) => (
          <details key={trial.id}>
            <summary>
              {experiment.candidates.find((c) => c.id === trial.candidateId)
                ?.label ?? trial.candidateId}{" "}
              / {trial.scenarioId} / {trial.phase}: {trial.status},{" "}
              {trial.report?.verdict ?? "INCONCLUSIVE"}
            </summary>
            {trial.error && <p className="error">{trial.error}</p>}
            <pre>{JSON.stringify(trial, null, 2)}</pre>
          </details>
        ))}
      </section>
    </>
  );
}
