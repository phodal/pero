import React from "react";
import { useAppContext } from "@pero/app-sdk";
import type { Comparison, Run, Value, Verification } from "./types";
import type { Message } from "./messages";
import { RunPlots } from "./plots";
import { propertyLabel } from "./labels";

type Translate = (key: Message) => string;

export function number(value: Value | number[] | undefined): string {
  if (value == null) return "—";
  if (Array.isArray(value)) return value.map(item => number(item)).join(" – ");
  return typeof value === "number" ? value !== 0 && (Math.abs(value) < 0.001 || Math.abs(value) >= 1e6) ? value.toExponential(3) : value.toLocaleString(undefined, { maximumSignificantDigits: 6 }) : String(value);
}

export function Status({ value, t }: { value: string | null | undefined; t: Translate }) {
  const known = ["pass", "fail", "incomplete", "running", "completed", "failed", "cancelled", "interrupted", "pending"];
  const label = value && known.includes(value) ? t(value as Message) : value || t("pending");
  return <span className={`status status-${value || "pending"}`}>{label}</span>;
}

export function Facts({ values }: { values: Record<string, Value> }) {
  const chinese = useAppContext().locale === "zh-CN";
  return <dl className="facts">{Object.entries(values).map(([key, value]) => <React.Fragment key={key}>
    <dt>{propertyLabel(key, chinese)}</dt><dd>{number(value)}</dd>
  </React.Fragment>)}</dl>;
}

function CheckReport({ report, t }: { report: Verification; t: Translate }) {
  const chinese = useAppContext().locale === "zh-CN";
  const checks = report.checks?.length ? report.checks : Object.entries(report.metrics).map(([id, value]) => ({
    id, label: id.replaceAll("_", " "), value, threshold: report.thresholds[id], passed: undefined,
  }));
  return <>
    <div className="section-heading"><h3>{t("verification")}</h3><Status value={report.status} t={t} /></div>
    <div className="table-scroll"><table className="check-table"><thead><tr>
      <th scope="col">{t("metric")}</th><th scope="col">{t("measured")}</th><th scope="col">{t("limit")}</th><th scope="col">{t("verification")}</th>
    </tr></thead><tbody>{checks.map(check => <tr key={check.id}>
      <th scope="row">{propertyLabel(check.id, chinese, check.label)}</th><td>{number(check.value)}</td><td>{number(check.threshold)}</td>
      <td>{check.passed === undefined ? "—" : <Status value={check.passed ? "pass" : "fail"} t={t} />}</td>
    </tr>)}</tbody></table></div>
    {!report.checks?.length && <details><summary>{t("criteria")}</summary><Facts values={report.thresholds} /></details>}

    {report.errors.length > 0 && <ul className="error-text">{report.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
  </>;
}

export function RunEvidence({ run, t, busy, exporting, onVerify, onCancel, onExport }: {
  run: Run; t: Translate; busy: boolean; exporting: boolean;
  onVerify(): void; onCancel(): void; onExport(): void;
}) {
  const active = run.status === "running" || Boolean(run.operation);
  return <section className="run-evidence" aria-label={t("details")}>
    <div className="section-heading">
      <dl className="run-overview"><div><dt>{t("status")}</dt><dd><Status value={run.status} t={t} /></dd></div><div><dt>{t("elapsed")}</dt><dd>{number(run.elapsedSeconds)}</dd></div></dl>
      <div className="toolbar">
        {run.status === "running" && <button disabled={busy} onClick={onCancel}>{t("cancel")}</button>}
        <button disabled={busy || active || !run.artifacts.length} onClick={onVerify}>{run.operation === "verify" ? t("verifying") : t("verify")}</button>
        <button disabled={exporting || active || !run.artifacts.length} onClick={onExport}>{exporting ? t("exporting") : t("export")}</button>
      </div>
    </div>
    {run.error && <p role="alert" className="error-text">{run.error}</p>}
    <RunPlots run={run} />
    {run.verification ? <CheckReport report={run.verification} t={t} /> : <p className="muted" role="status">{t("checkPending")}</p>}
    <details className="evidence-files"><summary>{t("artifacts")} ({run.artifacts.length})</summary>
      {run.artifacts.length ? <div className="table-scroll"><table><thead><tr><th>{t("file")}</th><th>{t("size")}</th><th>SHA-256</th></tr></thead>
        <tbody>{run.artifacts.map(file => <tr key={file.name}><td>{file.name}</td><td>{number(file.bytes)}</td><td className="digest">{file.sha256}</td></tr>)}</tbody></table></div> : <p>{t("noArtifacts")}</p>}
    </details>
    <details><summary>{t("logs")}</summary><pre className="log">{run.logs || t("noLogs")}</pre></details>
    <details><summary>{t("details")}</summary>    <dl className="run-summary">
      <div><dt>{t("created")}</dt><dd>{new Date(run.createdAt).toLocaleString()}</dd></div>
      <div><dt>{t("exit")}</dt><dd>{number(run.exitCode)}</dd></div>
      <div><dt>ReFrame</dt><dd>{run.reframeVersion || "—"}</dd></div>
    </dl>
<dl className="facts">
      <dt>{t("runId")}</dt><dd className="digest">{run.id}</dd>
      <dt>{t("digest")}</dt><dd className="digest">{run.specDigest}</dd>
    </dl></details>
  </section>;
}

export function RunTable({ runs, selectedId, chosen, t, onOpen, onChoose }: {
  runs: Run[]; selectedId: string; chosen: string[]; t: Translate;
  onOpen(run: Run): void; onChoose(run: Run, selected: boolean): void;
}) {
  return <div className="table-scroll"><table className="run-table"><thead><tr>
    <th><span className="visually-hidden">{t("chooseComparison")}</span></th><th>{t("created")}</th><th>{t("method")}</th>
    <th>{t("status")}</th><th>{t("verification")}</th><th>{t("elapsed")}</th>
  </tr></thead><tbody>{runs.map(run => <tr key={run.id} className={selectedId === run.id ? "selected" : ""}>
    <td><input type="checkbox" aria-label={`${t("chooseComparison")}: ${run.id}`} checked={chosen.includes(run.id)}
      disabled={run.status !== "completed" || Boolean(run.operation) || chosen.length >= 8 && !chosen.includes(run.id)} onChange={event => onChoose(run, event.target.checked)} /></td>
    <td><button className="text-button" aria-label={`${t("select")}: ${run.id}`} onClick={() => onOpen(run)}>{new Date(run.createdAt).toLocaleString()}</button></td>
    <td>{run.benchmarkName}</td><td><Status value={run.status} t={t} /></td><td><Status value={run.verification?.status} t={t} /></td><td>{number(run.elapsedSeconds)}</td>
  </tr>)}</tbody></table></div>;
}

export function ComparisonTable({ comparison, t }: { comparison: Comparison; t: Translate }) {
  const chinese = useAppContext().locale === "zh-CN";
  if (!comparison.comparable) return <p className="error-text" role="alert">{comparison.reason}</p>;
  const metrics = ["fineAbsoluteError", "convergenceRatio", "residualMax"].filter(key => comparison.rows.some(row => row.metrics[key] != null));
  return <>
    <div className="table-scroll"><table><thead><tr><th>{t("metric")}</th>{comparison.rows.map(row => <th key={row.runId}>{row.runId.slice(0, 8)}</th>)}</tr></thead><tbody>
      <tr><th>{t("verification")}</th>{comparison.rows.map(row => <td key={row.runId}><Status value={row.verificationStatus} t={t} /></td>)}</tr>
      <tr><th>{t("elapsed")}</th>{comparison.rows.map(row => <td key={row.runId}>{number(row.elapsedSeconds)}</td>)}</tr>
      {metrics.map(key => <tr key={key}><th>{propertyLabel(key, chinese)}</th>{comparison.rows.map(row => <td key={row.runId}>{number(row.metrics[key])}</td>)}</tr>)}
    </tbody></table></div>
    <details><summary>{t("details")}</summary><p className="digest">{comparison.specDigest}</p>{comparison.runIds.map(id => <p key={id} className="digest">{id}</p>)}</details>
  </>;
}
