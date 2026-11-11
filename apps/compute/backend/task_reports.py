"""An imported Task/Run observation, not a scheduler or a scientific verifier."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from hashlib import sha256
import json
import math
from pathlib import Path


@dataclass(frozen=True)
class ReportRow:
    experiment: str
    task: str
    run: str
    worker: str
    state: str
    verification: str
    reason: str
    hostname: str
    result_sha256: str
    result_path: str
    content: str | None
    elapsed_s: float | None
    c_rate: float
    temperature_k: float
    record: str


@dataclass(frozen=True)
class TaskReport:
    raw: str
    batch: str
    name: str
    observed_at: str
    method_sha256: str
    rows: tuple[ReportRow, ...]

    @classmethod
    def parse(cls, value):
        if not isinstance(value, dict) or value.get('schema') != 'pero.pybamm-report.v1':
            raise ValueError('Choose a report produced by the PyBaMM collect command')
        if value.get('denominator') != 6 or not isinstance(value.get('rows'), list) or len(value['rows']) != 6:
            raise ValueError('A report must retain all six experiments')
        observed = value.get('observed_at', '')
        if not isinstance(observed, str) or datetime.fromisoformat(observed).tzinfo is None:
            raise ValueError('Report observation time must include its timezone')
        def text(item, key, required=False):
            found = item.get(key, '')
            if not isinstance(found, str) or (required and not found):
                raise ValueError(f'Invalid report {key}')
            return found
        rows = []
        method = value.get('method')
        if not isinstance(method, dict) or not isinstance(method.get('experiments'), list):
            raise ValueError('Frozen experiment inputs are missing')
        inputs = {text(item, 'id', True): item for item in method['experiments'] if isinstance(item, dict)}
        details = value.get('details')
        if len(inputs) != 6 or not isinstance(details, dict):
            raise ValueError('Six frozen inputs and retained Run records are required')
        for item in value['rows']:
            if not isinstance(item, dict):
                raise ValueError('Invalid report row')
            state, verification = text(item, 'state'), text(item, 'verification')
            if state not in ('draft', 'queued', 'running', 'cancel_requested', 'succeeded', 'failed', 'cancelled', 'reconcile', 'missing', 'unavailable'):
                raise ValueError('Unknown recorded Run state')
            if verification not in ('consistent', 'needs_review', 'missing', 'not_checked'):
                raise ValueError('Unknown recorded verification state')
            if verification == 'consistent' and state != 'succeeded':
                raise ValueError('An unfinished Run cannot be reported as consistent')
            experiment, content, elapsed = text(item, 'experiment', True), None, None
            if experiment not in inputs:
                raise ValueError('Result row has no frozen input')
            condition = inputs[experiment]
            if not all(isinstance(condition.get(key), (int, float)) and not isinstance(condition[key], bool)
                       and math.isfinite(condition[key]) and condition[key] > 0 for key in ('c_rate', 'temperature_k')):
                raise ValueError('Invalid frozen input conditions')
            detail = details.get(experiment, {})
            if not isinstance(detail, dict) or not isinstance(detail.get('events', []), list):
                raise ValueError('Invalid retained Run record')
            if any(not isinstance(event, dict) or (event.get('data') is not None and not isinstance(event['data'], dict))
                   for event in detail.get('events', [])):
                raise ValueError('Run events and non-null event data must be objects')
            digest = text(item, 'result_sha256')
            if verification == 'consistent' and not digest:
                raise ValueError('A consistent result must retain its original bytes')
            if digest:
                for event in detail.get('events', []):
                    data = event.get('data') if isinstance(event, dict) else None
                    block = data.get('content') if isinstance(data, dict) else None
                    message = block.get('text') if isinstance(block, dict) else None
                    if not isinstance(message, str) or not message.startswith('PERO_PYBAMM_RESULT '):
                        continue
                    envelope = json.loads(message.removeprefix('PERO_PYBAMM_RESULT '))
                    if not isinstance(envelope, dict):
                        raise ValueError('Invalid result envelope')
                    if envelope.get('sha256') == digest:
                        candidate = envelope.get('content')
                        if not isinstance(candidate, str) or sha256(candidate.encode()).hexdigest() != digest:
                            raise ValueError('Result bytes do not match the recorded digest')
                        content = candidate
                        result = json.loads(content)
                        if not isinstance(result, dict):
                            raise ValueError('Invalid result document')
                        elapsed = result.get('elapsed_s')
                        if not isinstance(elapsed, (int, float)) or isinstance(elapsed, bool) or not math.isfinite(elapsed) or elapsed < 0:
                            raise ValueError('Invalid measured solve time')
                if content is None:
                    raise ValueError('Recorded result bytes are missing')
            rows.append(ReportRow(experiment, text(item, 'task'), text(item, 'run'), text(item, 'worker'),
                                  state, verification, text(item, 'reason'), text(item, 'hostname'), digest,
                                  text(item, 'result_path'), content, elapsed, condition['c_rate'], condition['temperature_k'],
                                  json.dumps(detail, ensure_ascii=False, allow_nan=False)))
        if len({row.experiment for row in rows}) != 6:
            raise ValueError('Experiment identities must be unique')
        return cls(json.dumps(value, ensure_ascii=False, allow_nan=False), text(value, 'batch', True),
                   text(value, 'name', True), observed, text(value, 'method_sha256', True), tuple(rows))

    def view(self):
        return {**asdict(self), 'consistent': sum(row.verification == 'consistent' for row in self.rows)}


def read_report(directory):
    path = Path(directory) / 'task-report.json'
    return TaskReport.parse(json.loads(path.read_text())).view() if path.exists() else None


def save_report(directory, report: TaskReport):
    path = Path(directory) / 'task-report.json'
    temporary = path.with_suffix('.pending')
    temporary.write_text(report.raw, encoding='utf-8')
    temporary.replace(path)
    return report.view()
