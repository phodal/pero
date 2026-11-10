"""Versioned conversation receipt for one saved Control Lab candidate.

This reads a store record and returns a bounded chart/table projection.
It does not solve, lock, start, or cancel. A saved report is shown only when
a fresh check of the current parameters binds the same observation.
"""
import json
import math

from .experiments import Candidate, ExperimentSpec, Invalid, digest, input_digest, template
from .verification import Observation, verify_observation

VERIFIER = 'control-lab-verifier-v1'
KIND = 'pero.control-conversation.v1'
SCOPE = ('Search scenarios of this frozen specification only. '
         'A check applies only to its own input digest. '
         'Final verification and other candidates are separate versions.')
MAX_POINTS = 16
MAX_RECEIPT_BYTES = 12000


def project_candidate(record, candidate_id, engine_available):
    if not isinstance(candidate_id, str) or not candidate_id.strip() or len(candidate_id) > 128:
        raise Invalid('A candidate id is required')
    if not isinstance(engine_available, bool):
        raise Invalid('Engine availability must be explicit')
    spec = ExperimentSpec.restore(record)
    saved = next((item for item in record.get('candidates', []) if item.get('id') == candidate_id), None)
    if not isinstance(saved, dict) or not isinstance(saved.get('parameters'), dict):
        raise Invalid('Candidate not found')
    parameters = {key: float(value) for key, value in saved['parameters'].items()}
    candidate = Candidate(saved['id'], saved.get('label') or saved['id'], tuple(sorted(parameters.items())))
    engine = template(spec.template_id).engine
    scenarios, checks, rejected, plotted, versions = [], [], [], None, []
    for scenario in spec.scenarios:
        if scenario.role != 'search':
            continue
        bound = _bind(record, spec, candidate, scenario, engine_available)
        bound['scenario']['detail'] = bound['scenario']['detail'][:500]
        version = bound['scenario'].pop('engineVersion', None)
        if version:
            versions.append(version)
        scenarios.append(bound['scenario'])
        rejected.extend(bound['rejected'])
        if bound['chart'] and (plotted is None or _nominal(scenario.id) and not _nominal(plotted['scenario']['id'])):
            plotted = bound
    if plotted:
        checks.extend(plotted['checks'])
    for bound_scenario in scenarios:
        if plotted and bound_scenario['id'] == plotted['scenario']['id']:
            continue
        checks.append(_summary_row(bound_scenario))
    status = _overall([item['status'] for item in scenarios])
    identity = {'specHash': spec.hash, 'candidateId': candidate.id, 'parameters': dict(candidate.parameters),
                'scenarios': [{key: item[key] for key in ('id', 'status', 'inputDigest', 'observationId', 'reportId')} for item in scenarios]}
    version = digest(identity)
    citation = f"control-lab:{record['id']}@{version}"
    method = (f"{engine}{' ' + ', '.join(sorted(set(versions))) if versions else ''}; verifier {VERIFIER}. "
              'Checks are the independent Hurwitz test and the frozen finite-window criteria on this candidate. '
              'They are not device acceptance and do not transfer to other parameter values.')
    curve = _fit_curve(plotted['chart'] if plotted else None)
    shown = ', '.join(f'{key}={json.dumps(value)}' for key, value in sorted(parameters.items()) if key in ('kp', 'ki', 'kd', 'n', 'r', 'c', 'gain'))
    explanation = ' '.join(part for part in (
        f"{template(spec.template_id).title} · {candidate.label}. Parameters {shown}.",
        f"Status {status}. Citation {citation}.",
        SCOPE, method,
        f"{len(rejected)} saved report(s) do not apply to this input and are not shown as its result." if rejected else '',
        'The inline curve is omitted so this receipt stays inside the conversation result. The observation id remains the result reference.'
        if plotted and plotted['chart'] and curve is None else '',
    ) if part)
    receipt = {
        'kind': KIND, 'version': version, 'citation': citation, 'experimentId': record['id'], 'specHash': spec.hash,
        'candidateId': candidate.id, 'title': f"{template(spec.template_id).title} · {candidate.label}",
        'parameters': dict(candidate.parameters), 'status': status, 'inheritedCheck': False, 'method': method,
        'scope': SCOPE, 'explanation': explanation, 'curve': curve, 'checks': checks, 'scenarios': scenarios,
        'notApplicable': rejected, 'links': _links(record['id'], plotted),
    }
    encoded = json.dumps(receipt, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
    if len(encoded.encode()) > MAX_RECEIPT_BYTES:
        raise Invalid('Conversation receipt exceeds the inline result limit')
    return receipt


def _bind(record, spec, candidate, scenario, engine_available):
    expected = input_digest(spec, candidate, scenario)
    trials = [trial for trial in record.get('trials', []) if trial.get('candidateId') == candidate.id
              and trial.get('scenarioId') == scenario.id and trial.get('phase') == 'search']
    current = trials[-1] if trials else None
    scenario_row = {'id': scenario.id, 'label': scenario.label, 'status': 'unchecked', 'inputDigest': expected,
                    'observationId': None, 'reportId': None, 'engineVersion': None, 'detail': ''}
    if current is None:
        scenario_row['status'] = 'unavailable' if not engine_available else 'unchecked'
        scenario_row['detail'] = 'Solver is not available.' if scenario_row['status'] == 'unavailable' else 'No saved attempt for these parameters.'
        return {'scenario': scenario_row, 'checks': [], 'rejected': [], 'chart': None}
    error = current.get('error') or ''
    observation = current.get('observation') if isinstance(current.get('observation'), dict) else None
    stored = current.get('report') if isinstance(current.get('report'), dict) else None
    if observation is None:
        unavailable = 'EngineUnavailable' in error or (not engine_available and current.get('status') == 'failed')
        scenario_row['status'] = 'unavailable' if unavailable else 'failed' if current.get('status') == 'failed' else 'unchecked'
        scenario_row['detail'] = error or {'unavailable': 'Solver is not available.', 'failed': 'The solver attempt failed.', 'unchecked': 'No completed observation is saved.'}[scenario_row['status']]
        rejected = [_rejected(stored, None, 'No observation matches the current parameters, so this saved report does not apply.')] if stored and stored.get('id') else []
        return {'scenario': scenario_row, 'checks': [], 'rejected': rejected, 'chart': None}
    try:
        observed = Observation.parse(observation)
    except (Invalid, ValueError, KeyError, TypeError) as error:
        scenario_row['status'] = 'failed'
        scenario_row['detail'] = f'Saved observation could not be read: {error}'
        return {'scenario': scenario_row, 'checks': [], 'rejected': [], 'chart': None}
    if observed.input_digest != expected:
        scenario_row['status'] = 'unchecked'
        scenario_row['detail'] = 'The saved observation belongs to a different input.'
        rejected = [_rejected(stored, observed.input_digest, 'Saved check is bound to a different input and does not apply to the current parameters.')] if stored and stored.get('id') else []
        return {'scenario': scenario_row, 'checks': [], 'rejected': rejected, 'chart': None}
    fresh = verify_observation(spec, candidate.id, observed, scenario, candidate).to_dict()
    if fresh.get('verifierVersion') != VERIFIER:
        raise Invalid('Verifier version is not the Control Lab checker')
    rejected = []
    if stored and stored.get('id') and stored.get('id') != fresh['id']:
        rejected.append(_rejected(stored, observed.input_digest, 'Stored report does not match a fresh check of this observation.'))
    status = {'PASS': 'pass', 'FAIL': 'check_failed', 'INCONCLUSIVE': 'inconclusive'}[fresh['verdict']]
    scenario_row.update(status=status, observationId=observed.id, reportId=fresh['id'], engineVersion=observed.engine_version,
                        detail=f'{len(fresh["checks"])} checks on this input.')
    rows = [_check_row(scenario.label, check, fresh['id'], expected) for check in fresh['checks']]
    return {'scenario': scenario_row, 'checks': rows, 'rejected': rejected, 'chart': _chart(observed, scenario, candidate, current.get('id'))}


def _check_row(label, check, report_id, digest_value):
    return {'scenario': label, 'name': check['name'], 'verdict': check['verdict'], 'actual': _number(check.get('actual')),
            'limit': _number(check.get('limit')), 'unit': _unit(check['name']), 'message': str(check.get('message') or '')[:240],
            'reportId': report_id, 'inputDigest': digest_value}


def _summary_row(scenario):
    verdict = {'pass': 'PASS', 'check_failed': 'FAIL', 'inconclusive': 'INCONCLUSIVE', 'unchecked': 'NOT_CHECKED',
               'unavailable': 'SOLVER_UNAVAILABLE', 'failed': 'COMPUTATION_FAILED'}[scenario['status']]
    return {'scenario': scenario['label'], 'name': 'Scenario result', 'verdict': verdict, 'actual': None, 'limit': None,
            'unit': '', 'message': scenario['detail'][:240], 'reportId': scenario['reportId'], 'inputDigest': scenario['inputDigest']}


def _overall(statuses):
    if not statuses:
        raise Invalid('This template has no search scenario to project')
    if any(status == 'failed' for status in statuses):
        return 'failed'
    if any(status == 'unavailable' for status in statuses):
        return 'unavailable'
    if any(status == 'unchecked' for status in statuses):
        return 'unchecked'
    if any(status == 'check_failed' for status in statuses):
        return 'check_failed'
    if any(status == 'inconclusive' for status in statuses):
        return 'inconclusive'
    if all(status == 'pass' for status in statuses):
        return 'pass'
    raise Invalid('Search scenario status is not a known check state')


def _chart(observation, scenario, candidate, trial_id):
    series = next((item for item in observation.series if item.name == 'reference'), observation.series[0] if observation.series else None)
    if series is None or len(series.x) < 2:
        return None
    indexes = _indexes(len(series.x), MAX_POINTS)
    rows, seen = [], set()
    for index in indexes:
        label = _token(series.x[index])
        key = (label, series.name)
        if key in seen:
            continue
        seen.add(key)
        rows.append({'t': label, 'y': series.y[index], 'signal': series.name})
    if len(rows) < 2:
        return None
    document = {'schemaVersion': 1, 'title': f'{candidate.label} · {scenario.label}',
                'chart': {'type': 'line', 'x': 't', 'y': 'y', 'series': 'signal', 'xLabel': f't ({series.x_unit or "s"})', 'yLabel': f'{series.name} ({series.unit or "1"})'},
                'rows': rows,
                'source': {'label': f'observation {observation.id}', 'caveats': [
                    'Plotted values are saved samples from this observation. Omitted samples are not drawn as zero.',
                    'The curve is not a new solve and is not device acceptance.']}}
    return {'observationId': observation.id, 'inputDigest': observation.input_digest, 'trialId': trial_id, 'signal': series.name,
            'xUnit': series.x_unit or 's', 'yUnit': series.unit or '1', 'sampleCount': len(series.x), 'displayed': len(rows), 'document': document}


def _fit_curve(curve):
    if curve is None:
        return None
    probe = {'document': curve['document']}
    if len(json.dumps(probe, allow_nan=False).encode()) <= 8000:
        return curve
    return None


def _links(experiment_id, plotted):
    trial_id = plotted['chart']['trialId'] if plotted and plotted.get('chart') and plotted['chart'].get('trialId') else None
    if not isinstance(trial_id, str) or not trial_id:
        return []
    return [{'label': 'Open the saved trial', 'location': f'experiment/{experiment_id}/trial/{trial_id}'}]


def _rejected(report, digest_value, reason):
    return {'reportId': report.get('id'), 'inputDigest': digest_value, 'reason': reason}


def _nominal(identity):
    return identity.startswith('nominal')


def _indexes(length, limit):
    if length <= limit:
        return list(range(length))
    stride = (length - 1) / (limit - 1)
    chosen = []
    for step in range(limit):
        index = min(length - 1, round(step * stride))
        if not chosen or chosen[-1] != index:
            chosen.append(index)
    if chosen[-1] != length - 1:
        chosen.append(length - 1)
    return chosen


def _token(value):
    return format(float(value), '.16g')


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return value


def _unit(name):
    for suffix, unit in (('Target settling time', 's'), ('Final-window target error', '1'), ('Target overshoot', 'fraction'),
                         ('Peak absolute control effort', '1'), ('Plant-input disturbance final residual', '1'),
                         ('Gain margin', 'dB'), ('Phase margin', 'deg'), ('Passband gain relative error', '1'),
                         ('Passband peaking', 'dB'), ('Cutoff relative error', '1'), ('Independent analytic golden', '1')):
        if name == suffix or name.endswith(suffix):
            return unit
    return ''
