"""Create one frozen Control Lab experiment from a saved Notebook binding."""
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import re

from .experiments import ExperimentSpec, Invalid, canonical, digest, template


def identifier(value, pattern):
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


@dataclass(frozen=True)
class NotebookExperiment:
    identity: str
    inputs_digest: str
    spec: ExperimentSpec

    @classmethod
    def parse(cls, inputs):
        if (not isinstance(inputs, dict) or set(inputs) != {'submissionId', 'horizon', 'samples'}
                or not identifier(inputs['submissionId'], r'[a-f0-9]{32}')):
            raise Invalid('Choose one saved Notebook experiment binding')
        parameters = {}
        for name in ('horizon', 'samples'):
            pin = inputs[name]
            if (not isinstance(pin, dict) or set(pin) != {'procedureId', 'parameterId', 'version', 'value'}
                    or any(not identifier(pin[key], r'[A-Za-z0-9_-]{1,128}') for key in ('procedureId', 'parameterId'))
                    or type(pin['version']) is not int or not 1 <= pin['version'] <= 2147483647
                    or not isinstance(pin['value'], str) or len(pin['value']) > 128
                    or not identifier(pin['value'], r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?')):
                raise Invalid('Invalid saved Notebook parameter')
            try:
                value = Decimal(pin['value'])
            except InvalidOperation as error:
                raise Invalid('Invalid saved Notebook parameter') from error
            if name == 'samples' and value != value.to_integral_value():
                raise Invalid('Samples must be an integer')
            parameters[name] = float(value)
        spec = ExperimentSpec.parse({'templateId': 'pi-golden', 'parameters': parameters})
        return cls(inputs['submissionId'], digest(inputs), spec)


def projection(inputs, store=None):
    submission = NotebookExperiment.parse(inputs)
    view = {'title': template(submission.spec.template_id).title, 'fields': [
        {'label': 'Observation window', 'value': f"{inputs['horizon']['value']} s"},
        {'label': 'Samples', 'value': inputs['samples']['value']},
    ], 'columns': [], 'rows': [], 'notice': 'Creation saves a specification. Run and verify it in Control Lab.',
        'actions': [{'name': 'create-experiment', 'label': 'Create experiment', 'params': {}}]}
    record = store.notebook_experiment(submission, create=False) if store else None
    trials = [trial for trial in (record or {}).get('trials', [])
              if trial['phase'] == 'verification' and trial['status'] == 'completed' and trial.get('report')]
    if trials:
        # Same canonical bytes as the existing export route; no solver or verifier is rerun.
        exported = store.export(submission.identity)
        export_hash = digest(exported)
        results = []
        for trial in reversed(exported['experiment']['trials']):
            if trial['phase'] != 'verification' or trial['status'] != 'completed' or not trial.get('report'):
                continue
            report, observation = trial['report'], trial['observation']
            source = {'app': 'control-lab', 'kind': 'verification-report', 'id': record['id'], 'version': report['id'],
                      'locator': f"pero-app-location://control-lab/main/experiment/{record['id']}/trial/{trial['id']}"}
            checks = [{**check, **{name: None if check[name] is None else canonical(check[name]).decode('utf-8')
                                  for name in ('actual', 'limit')}} for check in report['checks']]
            snapshot = {'kind': 'control-receipt', 'trialId': trial['id'], 'observationId': observation['id'],
                        'candidateId': trial['candidateId'], 'scenarioId': trial['scenarioId'], 'phase': trial['phase'],
                        'specHash': record['specHash'], 'inputDigest': observation['inputDigest'], 'reportId': report['id'],
                        'verifierVersion': report['verifierVersion'], 'verdict': report['verdict'], 'checks': checks,
                        'exportSha256': export_hash}
            result = {'id': trial['id'], 'label': f"Verification {trial['id'][:12]} · {report['verdict']} · {trial['scenarioId']}",
                      'value': {'title': record['title'], 'reference': source, 'snapshot': snapshot}}
            if len(results) < 8 and len(canonical([*results, result])) <= 48 * 1024:
                results.append(result)
        view['results'] = results
        view['notice'] = ''
        if len(results) < len(trials):
            view['notice'] += f' Showing {len(results)} of {len(trials)} trials; export in Control Lab to inspect the others.'
    return view


def operation(store, value, *, create=False):
    if (not isinstance(value, dict) or set(value) != {'operationId', 'inputs', 'params'} or value['params'] != {}
            or not identifier(value['operationId'], r'[A-Za-z0-9_-]{1,128}')):
        raise Invalid('Invalid Notebook experiment operation')
    submission = NotebookExperiment.parse(value['inputs'])
    record = store.notebook_experiment(submission, create=create)
    if record is None:
        return {'state': 'not-started'}
    receipt = {'operationId': value['operationId'], 'inputDigest': digest(value), 'status': 'completed',
               'experimentId': record['id'], 'specHash': record['specHash']}
    return receipt if create else {'state': 'completed', 'result': receipt}
