import React from 'react';
import type { Comparison, Experiment, Trial } from './types';
import { formatNumber, stateDelta } from './presentation';

export function Timeline({ trial }: { trial: Trial | undefined }) {
  if (!trial) return <p className="empty">Propose a protocol to start recording a trial.</p>;
  return <section><h2>Execution {trial.status}</h2>
    {trial.error && <p className="error" role="alert">{trial.error}</p>}
    <p className="muted">Saved evidence only. Opening a run never executes its protocol.</p>
    {!trial.events.length && <p>No steps have executed.</p>}
    <ol className="timeline">{trial.events.map((event, i) => <li key={i}>
      <div><strong>{event.operation.op.replaceAll('_', ' ')} {event.operation.resource}</strong> {event.operation.volume_ul != null && `${event.operation.volume_ul} µL`} <span className="muted">— {event.status}</span></div>
      <p>{stateDelta(event.before, event.after)}</p>
      {event.error && <p className="error">{event.error}</p>}
      <details><summary>Step {event.index + 1} evidence</summary><pre>{JSON.stringify(event, null, 2)}</pre></details>
    </li>)}</ol>
    <details><summary>Frozen protocol and state hashes</summary><dl className="hashes"><dt>Protocol SHA-256</dt><dd>{trial.protocol_hash}</dd><dt>Initial state SHA-256</dt><dd>{trial.state_hash}</dd></dl></details>
  </section>;
}
export function Results({ experiment, trial, comparison }: { experiment: Experiment; trial: Trial | undefined; comparison: Comparison | null }) {
  const criteria = experiment.criteria, predicted = trial?.final_state?.wells.find(w => w.id === criteria.target_well);
  return <section><h2>Independent verification: {trial?.verification?.verdict ?? 'INCONCLUSIVE'}</h2>
    <p className="muted">Execution completed, verification PASS and human acceptance are separate decisions.</p>
    <div className="table-scroll"><table><thead><tr><th>Frozen criterion</th><th>Target</th><th>Model prediction</th></tr></thead><tbody>
      <tr><th>{criteria.target_well} red fraction</th><td>{criteria.target_fraction} ± {criteria.tolerance}</td><td>{formatNumber(predicted?.red_fraction)}</td></tr>
      <tr><th>{criteria.target_well} volume (µL)</th><td>{criteria.target_volume_ul} ± {criteria.volume_tolerance_ul}</td><td>{formatNumber(predicted?.volume_ul)}</td></tr>
    </tbody></table></div>
    {trial?.verification && <div className="table-scroll"><table><thead><tr><th>Check</th><th>Result</th><th>Evidence</th></tr></thead><tbody>{trial.verification.checks.map((check, i) => <tr key={i}><th>{check.name}</th><td>{check.verdict}</td><td>{check.message ?? formatNumber(check.actual)}</td></tr>)}</tbody></table></div>}
    <h2>Observations</h2>
    {!trial?.observations.length ? <p>No observations attached. Import a measurement or attach a clearly labelled synthetic fixture.</p> : trial.observations.map((observation, i) => <div className="observation" key={observation.id ?? i}>
      <strong>{observation.origin} observation</strong>{observation.measurements.map(measurement => <p key={measurement.well}>{measurement.well}: {formatNumber(measurement.value)} {measurement.unit}</p>)}<p>Source: {observation.source}</p>
      <details><summary>Provenance and original file digest</summary><pre>{JSON.stringify(observation, null, 2)}</pre></details>
    </div>)}
    {comparison && <><h2>Trial comparison</h2><p role="status">{comparison.message}</p><div className="table-scroll"><table><thead><tr><th>Trial</th><th>Parent</th><th>Absolute error</th><th>Verification</th></tr></thead><tbody>{comparison.trials.map(row => <tr key={row.trial_id}><td>{row.trial_id}</td><td>{row.parent_trial_id ?? 'Baseline'}</td><td>{formatNumber(row.absolute_error)}</td><td>{row.verdict}</td></tr>)}</tbody></table></div></>}
    {!!experiment.decisions.length && <><h2>Review decisions</h2><ul>{experiment.decisions.map((decision, i) => <li key={i}>{decision.trial_id}: {decision.decision === 'accepted' ? 'Accepted via UI' : 'Rejected via UI'} — {decision.rationale}</li>)}</ul></>}
    <details><summary>Method limitations</summary><ul>{experiment.limitations.map(item => <li key={item}>{item}</li>)}</ul></details>
  </section>;
}
