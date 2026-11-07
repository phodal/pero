"""Read execution receipts an owner already wrote. This module does not submit,
observe, or cancel a cluster job, and it does not scan a workspace for outputs.
"""
from dataclasses import dataclass
import json
from pathlib import Path

STATES = {
    'PENDING', 'RUNNING', 'COMPLETING', 'CONFIGURING', 'SUSPENDED', 'COMPLETED',
    'CANCELLED', 'FAILED', 'TIMEOUT', 'NODE_FAIL', 'OUT_OF_MEMORY', 'BOOT_FAIL',
    'DEADLINE', 'PREEMPTED', 'UNKNOWN',
}
LIMIT = 64 * 1024


@dataclass(frozen=True)
class ExecutionRead:
    executions: tuple
    status: str
    error: str = ''


def read_executions(directory):
    root = Path(directory) / 'executions'
    if not root.exists():
        return ExecutionRead((), 'none')
    if not root.is_dir() or root.is_symlink():
        return ExecutionRead((), 'unreadable', 'Execution receipts are not a directory')
    base = root.resolve()
    found = []
    for path in sorted(root.iterdir(), key=lambda item: item.name):
        if path.name.startswith('.'):
            continue
        if path.is_symlink() or not path.is_file() or path.suffix != '.json':
            return ExecutionRead((), 'unreadable', f'Unexpected receipt entry {path.name}')
        resolved = path.resolve()
        if not resolved.is_relative_to(base) or resolved.stat().st_size > LIMIT:
            return ExecutionRead((), 'unreadable', f'Receipt {path.name} is outside the receipt directory or too large')
        try:
            found.append(parse_receipt(json.loads(resolved.read_text(encoding='utf-8'))))
        except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as error:
            return ExecutionRead((), 'unreadable', f'Receipt {path.name}: {error}')
    identities = [
        ('batch', item['operation'], item['cluster'], item['jobId'], item['submitTime'])
        if item['jobId'] is not None else ('process', item['operation'], item['host'], item['started'], item['payloadSha256'])
        for item in found
    ]
    if len(set(identities)) != len(identities):
        return ExecutionRead((), 'unreadable', 'Two receipts record the same operation, cluster, job and submit time')
    found.sort(key=lambda item: (item['submitTime'], item['jobId'], item['operation']), reverse=True)
    return ExecutionRead(tuple(found), 'recorded' if found else 'none')


def parse_receipt(value):
    if not isinstance(value, dict):
        raise ValueError('A receipt must be an object')
    if 'submission' in value or 'job_id' in value:
        return _batch(value)
    return _process(value)


def _batch(value):
    if 'submission' in value:
        allowed = {'submission', 'states', 'nodes', 'start_time', 'end_time', 'entry', 'logs', 'outputs', 'snapshot'}
        _reject_unknown(value, allowed)
        job = _submission(value['submission'])
        states = value.get('states')
        if not isinstance(states, list) or not all(isinstance(item, str) and item in STATES for item in states):
            raise ValueError('Scheduler states are not a recorded batch observation')
        nodes = _text(value.get('nodes', ''), 'nodes', 1024)
        start, end = _optional_time(value.get('start_time'), 'start_time'), _optional_time(value.get('end_time'), 'end_time')
        wall = end - start if start is not None and end is not None and end >= start else None
        if start is not None and end is not None and end < start:
            raise ValueError('Recorded scheduler end is before its start')
        job['scheduler'] = {'states': states, 'nodes': nodes, 'startTime': start, 'endTime': end, 'wallSeconds': wall}
    else:
        job = _submission(value)
        job['scheduler'] = None
    return job


def _process(value):
    _reject_unknown(value, {'operation', 'host', 'payload', 'started', 'ended', 'exit_code', 'unconfirmed', 'entry', 'snapshot', 'logs', 'outputs'})
    started = _count(value.get('started'), 'started', 2**64 - 1)
    ended = _optional_time(value.get('ended'), 'ended')
    if ended is not None and ended < started:
        raise ValueError('Recorded process end is before its start')
    exit_code = value.get('exit_code')
    if exit_code is not None and (isinstance(exit_code, bool) or not isinstance(exit_code, int) or not 0 <= exit_code <= 255):
        raise ValueError('Invalid exit_code')
    unconfirmed = value.get('unconfirmed', False)
    if not isinstance(unconfirmed, bool):
        raise ValueError('Invalid unconfirmed')
    if unconfirmed and (exit_code is not None or ended is not None):
        raise ValueError('An unconfirmed process stop has no exit or end')
    return {
        'operation': _identity(value.get('operation'), 'operation'),
        'cluster': None,
        'jobId': None,
        'submitTime': started,
        'host': _identity(value.get('host'), 'host'),
        'started': started,
        'ended': ended,
        'exitCode': exit_code,
        'unconfirmed': unconfirmed,
        'wallMilliseconds': None if unconfirmed or ended is None else ended - started,
        'constraints': None,
        'payloadSha256': _digest(value.get('payload'), 'payload'),
        'scheduler': None,
        'entry': _optional_text(value.get('entry'), 'entry', 2000),
        'logs': _paths(value.get('logs', []), 'logs', 8),
        'outputs': _outputs(value.get('outputs', [])),
        'snapshotSha256': _optional_digest(value.get('snapshot'), 'snapshot'),
    }


def _submission(value):
    if not isinstance(value, dict):
        raise ValueError('Submission receipt must be an object')
    allowed = {'operation', 'cluster', 'constraints', 'payload', 'job_id', 'submit_time', 'entry', 'logs', 'outputs', 'snapshot'}
    _reject_unknown(value, allowed)
    constraints = value.get('constraints')
    if not isinstance(constraints, dict):
        raise ValueError('Requested constraints are missing')
    _reject_unknown(constraints, {'partition', 'cpus', 'memory_mib', 'walltime_seconds'})
    cpus, memory, wall = _count(constraints.get('cpus'), 'cpus', 65535), _count(constraints.get('memory_mib'), 'memory_mib', 2**32 - 1), _count(constraints.get('walltime_seconds'), 'walltime_seconds', 2**32 - 1)
    return {
        'operation': _identity(value.get('operation'), 'operation'),
        'cluster': _identity(value.get('cluster'), 'cluster'),
        'jobId': _count(value.get('job_id'), 'job_id', 2**64 - 1),
        'submitTime': _count(value.get('submit_time'), 'submit_time', 2**64 - 1),
        'constraints': {
            'partition': _identity(constraints.get('partition'), 'partition'),
            'cpus': cpus, 'memoryMib': memory, 'walltimeSeconds': wall,
        },
        'payloadSha256': _digest(value.get('payload'), 'payload'),
        'entry': _optional_text(value.get('entry'), 'entry', 2000),
        'logs': _paths(value.get('logs', []), 'logs', 8),
        'outputs': _outputs(value.get('outputs', [])),
        'snapshotSha256': _optional_digest(value.get('snapshot'), 'snapshot'),
        'host': None,
        'started': None,
        'ended': None,
        'exitCode': None,
        'unconfirmed': False,
        'wallMilliseconds': None,
    }


def _reject_unknown(value, allowed):
    unknown = set(value) - allowed
    if unknown:
        raise ValueError(f'Unexpected receipt field {sorted(unknown)[0]}')


def _identity(value, name):
    if not isinstance(value, str) or not 1 <= len(value) <= 128 or any(not (char.isalnum() or char in '-_.:') for char in value):
        raise ValueError(f'Invalid {name}')
    return value


def _digest(value, name):
    if not isinstance(value, str) or len(value) != 64 or any(char not in '0123456789abcdef' for char in value):
        raise ValueError(f'Invalid {name}')
    return value


def _optional_digest(value, name):
    if value is None:
        return None
    return _digest(value, name)


def _count(value, name, maximum):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise ValueError(f'Invalid {name}')
    return value


def _optional_time(value, name):
    if value is None:
        return None
    return _count(value, name, 2**64 - 1)


def _text(value, name, maximum):
    if not isinstance(value, str) or len(value) > maximum or any(ord(char) < 32 for char in value):
        raise ValueError(f'Invalid {name}')
    return value


def _optional_text(value, name, maximum):
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > maximum or any(ord(char) < 32 and char not in '\n\t' for char in value):
        raise ValueError(f'Invalid {name}')
    return value


def _paths(value, name, maximum):
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError(f'Invalid {name}')
    return [_relative(item, name) for item in value]


def _outputs(value):
    if not isinstance(value, list) or len(value) > 32:
        raise ValueError('Invalid outputs')
    found = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError('Invalid outputs')
        _reject_unknown(item, {'path', 'sha256'})
        found.append({'path': _relative(item.get('path'), 'outputs'), 'sha256': _digest(item.get('sha256'), 'outputs')})
    return found


def _relative(value, name):
    if not isinstance(value, str) or not value or len(value) > 1024 or '\\' in value or value.startswith('/') or any(ord(char) < 32 for char in value):
        raise ValueError(f'Invalid {name}')
    parts = Path(value).parts
    if any(part in ('', '.', '..') for part in parts):
        raise ValueError(f'Invalid {name}')
    return '/'.join(parts)
