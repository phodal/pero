"""Explicitly submit or inspect the fixed list through existing Task/Run HTTP APIs."""
import argparse
from dataclasses import asdict, replace
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from bundle import ROOT, load_identity
from check import read_results
from dispatch import Batch, Binding, Observation, Row, summarize


class ControlPlane:
    def __init__(self, origin, token):
        parsed = urlparse(origin)
        if (parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('127.0.0.1', 'localhost', '::1'))
                or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
            raise ValueError('Use a control-plane HTTPS origin or explicit loopback HTTP')
        self.origin, self.token = origin.rstrip('/'), token

    def request(self, path, value=None, key=''):
        headers = {'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'}
        if key:
            headers['Idempotency-Key'] = key
        request = Request(self.origin + path, headers=headers,
                          data=None if value is None else json.dumps(value).encode())
        with urlopen(request, timeout=20) as response:
            return json.load(response)


def save(path: Path, value):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    temp.replace(path)


def submit(api: ControlPlane, batch: Batch, path: Path) -> Batch:
    items = list(batch.items)
    for index, item in enumerate(items):
        key = batch.key + '-' + item.experiment
        task = api.request('/api/v1/tasks', batch.spec(item), key + '-create')
        run = api.request(f'/api/v1/tasks/{task["id"]}/dispatch', {'worker_id': item.worker}, key + '-run')
        items[index] = replace(item, task=task['id'], run=run['id'])
        batch = replace(batch, items=tuple(items))
        save(path, asdict(batch))
    return batch


def collect(api: ControlPlane, batch: Batch, reference_path: Path):
    identity = load_identity()
    references = read_results(reference_path)
    rows, details = [], {}
    for item in batch.items:
        if not item.task:
            rows.append(Row(item.experiment, '', '', item.worker, 0, 'missing', 'missing', 'Not submitted'))
            continue
        try:
            detail = api.request('/api/v1/tasks/' + item.task)
        except (URLError, TimeoutError) as error:
            reason = f'HTTP {error.code}' if isinstance(error, HTTPError) else 'Control plane unavailable'
            rows.append(Row(item.experiment, item.task, item.run, item.worker, 0, 'unavailable', 'missing', reason))
            continue
        details[item.experiment] = detail
        rows.append(summarize(item, Observation.parse(detail), references.get(item.experiment), identity))
    return {'schema': 'pero.pybamm-report.v1', 'observed_at': datetime.now(timezone.utc).isoformat(),
            'name': batch.name, 'origin': batch.origin, 'method': asdict(identity.method),
            'method_sha256': identity.sha256, 'bindings': [asdict(item) for item in batch.items],
            'batch': batch.key, 'denominator': 6, 'rows': [asdict(row) for row in rows],
            'consistent': sum(row.verification == 'consistent' for row in rows),
            'machine_acceptance': 'not_assessed', 'scientific_acceptance': 'not_assessed', 'details': details}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prepare = commands.add_parser('prepare')
    prepare.add_argument('plan', type=Path)
    prepare.add_argument('--name', required=True)
    prepare.add_argument('--origin', required=True)
    prepare.add_argument('--project', required=True)
    prepare.add_argument('--workspace', required=True)
    prepare.add_argument('--agent', default='pybamm-sweep-v1')
    prepare.add_argument('--workers', nargs=2, required=True)
    for name in ('submit', 'collect', 'cancel'):
        sub = commands.add_parser(name)
        sub.add_argument('plan', type=Path)
        if name == 'collect':
            sub.add_argument('report', type=Path)
            sub.add_argument('--reference', type=Path, default=ROOT / 'reference.jsonl')
        if name == 'cancel':
            sub.add_argument('experiment')
    args = parser.parse_args()
    identity = load_identity()
    if args.command == 'prepare':
        batch = Batch(args.name, args.origin.rstrip('/'), args.project, args.workspace, args.agent, identity.sha256,
                      tuple(Binding(e.id, args.workers[i % 2]) for i, e in enumerate(identity.method.experiments)))
        Batch.parse(asdict(batch), identity)
        ControlPlane(batch.origin, '')
        with args.plan.open('x') as stream:
            stream.write(json.dumps(asdict(batch), indent=2) + '\n')
    else:
        batch = Batch.parse(json.loads(args.plan.read_text()), identity)
        api = ControlPlane(batch.origin, os.environ['SWEEP_OPERATOR_TOKEN'])
        if args.command == 'submit':
            submit(api, batch, args.plan)
        elif args.command == 'collect':
            report = collect(api, batch, args.reference)
            save(args.report, report)
            print(json.dumps({key: value for key, value in report.items() if key != 'details'}, indent=2))
        else:
            item = next(item for item in batch.items if item.experiment == args.experiment)
            print(json.dumps(api.request('/api/v1/tasks/' + item.task + '/cancel', {})))
