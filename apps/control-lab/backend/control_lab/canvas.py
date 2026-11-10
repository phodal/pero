"""Create one frozen Control Lab experiment from a saved Notebook binding."""
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import re

from .experiments import ExperimentSpec, Invalid, digest, template


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


def projection(inputs):
    submission = NotebookExperiment.parse(inputs)
    return {'title': template(submission.spec.template_id).title, 'fields': [
        {'label': 'Observation window', 'value': f"{inputs['horizon']['value']} s"},
        {'label': 'Samples', 'value': inputs['samples']['value']},
    ], 'columns': [], 'rows': [], 'notice': 'Creation saves a specification. Run and verify it in Control Lab.',
        'actions': [{'name': 'create-experiment', 'label': 'Create experiment', 'params': {}}]}


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
