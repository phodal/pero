import React from 'react';
import { ContentSection, Disclosure, Table } from '@pero/app-sdk/ui';
import type { Comparison, Experiment, Trial } from './types';
import { formatNumber, stateDelta, checkLabel, trialLabel } from './presentation';

export function Timeline({ trial }: { trial: Trial | undefined }) {
  if (!trial) return <p className="empty">Save a candidate to start a trial.</p>;
  return <ContentSection id="lab-execution" title={`Execution ${trial.status}`}>
    {trial.error && <p className="error" role="alert">{trial.error}</p>}
    {!trial.events.length && <p>No steps have executed.</p>}
    <ol className="timeline">{trial.events.map((event, i) => <li key={i}>
      <div><strong>{event.operation.op.replaceAll('_', ' ')} {event.operation.resource}</strong> {event.operation.volume_ul != null && `${event.operation.volume_ul} µL`} <span className="muted">— {event.status}</span></div>
      <p>{stateDelta(event.before, event.after)}</p>
      {event.error && <p className="error">{event.error}</p>}
      <Disclosure variant="inline" summary={<>Step {event.index + 1} evidence</>}><pre>{JSON.stringify(event, null, 2)}</pre></Disclosure>
    </li>)}</ol>
    <Disclosure variant="inline" summary={<>Frozen protocol and state hashes</>}><dl className="hashes"><dt>Protocol SHA-256</dt><dd>{trial.protocol_hash}</dd><dt>Initial state SHA-256</dt><dd>{trial.state_hash}</dd></dl></Disclosure>
  </ContentSection>;
}
export function Results({ experiment, trial, comparison }: { experiment: Experiment; trial: Trial | undefined; comparison: Comparison | null }) {
  const criteria = experiment.criteria, predicted = trial?.final_state?.wells.find(w => w.id === criteria.target_well);
  return <><ContentSection id="lab-verification" title={`Independent verification: ${trial?.verification?.verdict ?? 'INCONCLUSIVE'}`}>
    <Table label="Frozen criteria" density="compact" className="table-scroll"><thead><tr><th>Frozen criterion</th><th>Target</th><th>Model prediction</th></tr></thead><tbody>
      <tr><th>{criteria.target_well} red fraction</th><td>{criteria.target_fraction} ± {criteria.tolerance}</td><td>{formatNumber(predicted?.red_fraction)}</td></tr>
      <tr><th>{criteria.target_well} volume (µL)</th><td>{criteria.target_volume_ul} ± {criteria.volume_tolerance_ul}</td><td>{formatNumber(predicted?.volume_ul)}</td></tr>
    </tbody></Table>
    {trial?.verification && <Table label="Verification checks" density="compact" className="table-scroll" tableClassName="checks-table"><thead><tr><th>Check</th><th>Result</th><th>Evidence</th></tr></thead><tbody>{trial.verification.checks.map((check, i) => <tr key={i}><th>{checkLabel(check.name)}</th><td>{check.verdict}</td><td>{check.message ?? formatNumber(check.actual)}</td></tr>)}</tbody></Table>}
    </ContentSection>
    <ContentSection id="lab-observations" title="Observations">
    {!trial?.observations.length ? <p>No observations attached.</p> : trial.observations.map((observation, i) => <div className="observation" key={observation.id ?? i}>
      <strong>{observation.origin} observation</strong>{observation.measurements.map(measurement => <p key={measurement.well}>{measurement.well}: {formatNumber(measurement.value)} {measurement.unit}</p>)}<p>Source: {observation.source}</p>
      <Disclosure variant="inline" summary={<>Provenance and original file digest</>}><pre>{JSON.stringify(observation, null, 2)}</pre></Disclosure>
    </div>)}
    </ContentSection>
    {comparison && <ContentSection id="lab-comparison" title="Trial comparison"><p role="status">{comparison.message}</p><Table label="Trial comparison" density="compact" className="table-scroll" tableClassName="comparison-table"><thead><tr><th>Trial</th><th>Parent</th><th>Absolute error</th><th>Verification</th></tr></thead><tbody>{comparison.trials.map(row => <tr key={row.trial_id}><td title={row.trial_id}>{trialLabel(experiment.trials, row.trial_id)}</td><td title={row.parent_trial_id ?? undefined}>{row.parent_trial_id ? trialLabel(experiment.trials, row.parent_trial_id) : '—'}</td><td>{formatNumber(row.absolute_error)}</td><td>{row.verdict}</td></tr>)}</tbody></Table></ContentSection>}
    {!!experiment.decisions.length && <ContentSection id="lab-decisions" title="Review decisions"><ul>{experiment.decisions.map((decision, i) => <li key={i}>{decision.trial_id}: {decision.decision === 'accepted' ? 'Accepted via UI' : 'Rejected via UI'} — {decision.rationale}</li>)}</ul></ContentSection>}
    <Disclosure variant="inline" summary={<>Method limitations</>}><ul>{experiment.limitations.map(item => <li key={item}>{item}</li>)}</ul></Disclosure>
  </>;
}
