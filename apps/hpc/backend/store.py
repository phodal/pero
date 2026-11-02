"""Durable App benchmark evidence and supervised local operations, separate from Compute."""
from dataclasses import replace
from datetime import datetime, timezone
import hashlib
import csv
import math
import io
import json
import os
from pathlib import Path
import threading
import time
import uuid
import zipfile

from domain import Artifact, Benchmark, BenchmarkExecution, Invalid, Property, comparison
import executor


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def catalog():
    root = executor.BENCHMARK_ROOT
    locals_ = []
    for definition_path in executor.DEFINITIONS:
        if not definition_path.is_file():
            continue
        definition = json.loads(definition_path.read_text())
        digest = hashlib.sha256()
        for path in sorted(root.iterdir()):
            if path.is_file() and path.suffix == '.py':
                digest.update(path.name.encode() + b'\0' + path.read_bytes())
        digest.update(definition_path.read_bytes())
        digest.update(Path(__file__).with_name('reframe_settings.py').read_bytes())
        parameters = {key: ', '.join(str(item) for item in value) if isinstance(value, list) else value
                      for key, value in definition['spec'].items()}
        locals_.append(Benchmark(definition['id'], definition['name'], definition['version'],
                                definition['description'], 'local-reference', True, None, digest.hexdigest(),
                                Property.admit(dict(runner='ReFrame', runnerVersion=executor.REQUIRED_REFRAME,
                                                    scheduler='local', ranks=1)),
                                Property.admit(parameters), Property.admit(definition['thresholds'])))
    planned = json.loads((root.parent / 'poiseuille' / 'benchmark.json').read_text())
    unavailable = Benchmark(planned['id'], planned['name'], planned['version'],
                            'Hagen–Poiseuille Re=100 with a real multi-rank Slurm allocation',
                            planned['executionKind'], False, planned['reason'], 'unavailable',
                            Property.admit(dict(scheduler='Slurm', solver='OpenFOAM')),
                            Property.admit(planned['spec']), Property.admit(planned['thresholds']))
    return tuple(locals_) + (unavailable,)


class BenchmarkStore:
    def __init__(self, root, runtime=None, run_executor=None):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.runtime = runtime or executor.Runtime.inspect()
        self.run_executor = run_executor or executor.execute
        self.benchmarks = catalog()
        self.records = {}
        self.workers = {}
        self.cancelled = {}
        for path in sorted(self.root.glob('*.json')):
            record = BenchmarkExecution.restore(json.loads(path.read_text()))
            self.records[record.id] = record
            if record.operation:
                self.save(record.interrupt(now()))

    def save(self, record):
        path = self.root / (record.id + '.json')
        pending = path.with_suffix('.pending')
        with pending.open('wb') as file:
            file.write(canonical(record.view()))
            file.flush()
            os.fsync(file.fileno())
        pending.replace(path)
        self.records[record.id] = record

    def get(self, identity):
        if not isinstance(identity, str) or identity not in self.records:
            raise Invalid('Benchmark execution not found')
        return self.records[identity]

    def read(self, identity):
        with self.lock:
            return self.get(identity).view()

    def state(self):
        with self.lock:
            return dict(benchmarks=[item.view() for item in self.benchmarks],
                        runs=[item.view() for item in sorted(self.records.values(),
                                                            key=lambda item: (item.created_at, item.id), reverse=True)],
                        runtime=self.runtime.view())

    def create(self, benchmark_id):
        with self.lock:
            benchmark = next((item for item in self.benchmarks if item.id == benchmark_id), None)
            if benchmark is None:
                raise Invalid('Benchmark not found')
            record = BenchmarkExecution.start(benchmark, uuid.uuid4().hex, now(), self.runtime.version)
            if not self.runtime.available:
                raise Invalid(self.runtime.message)
            if any(item.operation for item in self.records.values()):
                raise Invalid('A local operation is active; wait or cancel it first')
            directory = self.root / 'runs' / record.id
            directory.mkdir(parents=True)
            self.save(record)
            self.start_worker(record, directory)
            return record.view()

    def start_worker(self, record, directory):
        cancelled = threading.Event()
        self.cancelled[record.id] = cancelled
        worker = threading.Thread(target=self.work, args=(record, directory, cancelled), daemon=True)
        self.workers[record.id] = worker
        worker.start()

    def artifacts(self, directory):
        result = []
        for path in sorted(directory.rglob('*')):
            relative = path.relative_to(directory)
            if path.is_file() and not path.is_symlink() and '__pycache__' not in relative.parts:
                if 'reframe' in relative.parts and path.suffix not in ('.out', '.err', '.sh'):
                    continue
                body = path.read_bytes()
                result.append(Artifact(relative.as_posix(), len(body), hashlib.sha256(body).hexdigest()))
        return tuple(result)

    def work(self, original, directory, cancelled):
        started = time.monotonic()
        try:
            if original.operation == 'run':
                code = self.run_executor(self.runtime, directory, cancelled, original.benchmark_id)
                report = executor.read_verification(directory)
                log = (directory / 'reframe.log').read_text(errors='replace')[-128000:] if (directory / 'reframe.log').is_file() else ''
                finished = original.finish(code, round(time.monotonic() - started, 6), now(), report,
                                           self.artifacts(directory), log, cancelled.is_set())
            else:
                report = executor.verify(self.runtime, directory, cancelled)
                finished = replace(original, operation=None, updated_at=now(), verification=report,
                                   artifacts=self.artifacts(directory), error=None)
            with self.lock:
                self.save(finished)
        except (OSError, ValueError, KeyError, TypeError) as error:
            with self.lock:
                current = self.get(original.id)
                log = (directory / 'reframe.log').read_text(errors='replace')[-128000:] if (directory / 'reframe.log').is_file() else ''
                self.save(replace(current, status='failed' if original.operation == 'run' else current.status,
                                  operation=None, updated_at=now(), error=str(error), logs=log,
                                  artifacts=self.artifacts(directory)))

    def verify(self, identity):
        with self.lock:
            record = self.get(identity).begin_verification(now())
            self.save(record)
            self.start_worker(record, self.root / 'runs' / record.id)
            return record.view()

    def cancel(self, identity):
        with self.lock:
            record = self.get(identity)
            if record.operation:
                self.cancelled[identity].set()
            return record.view()

    def compare(self, identities):
        if not isinstance(identities, list) or len(set(identities)) != len(identities):
            raise Invalid('Supply distinct execution IDs')
        with self.lock:
            return comparison(tuple(self.get(identity) for identity in identities)).view()

    def evidence(self, record):
        directory = self.root / 'runs' / record.id
        contents = {}
        for item in record.artifacts:
            body = (directory / item.name).read_bytes()
            if hashlib.sha256(body).hexdigest() != item.sha256:
                raise Invalid('Saved evidence changed; verify it again before viewing or exporting: ' + item.name)
            contents[item.name] = body
        return contents

    def series(self, identity):
        with self.lock:
            record = self.get(identity)
            if record.operation or not record.verification or record.verification.status not in ('pass', 'fail'):
                raise Invalid('Complete independent verification before plotting numerical evidence')
            contents = self.evidence(record)
            result = json.loads(contents['bundle/result.json'])
            intervals = result['runs'][-1]['intervals']
            rows = csv.DictReader(io.StringIO(contents[f'bundle/raw/samples-{intervals}.csv'].decode()))
            points = [(float(row['x']), float(row['value'])) for row in rows]
            if not points or not all(math.isfinite(x) and math.isfinite(y) for x, y in points):
                raise Invalid('Finite numerical samples are required')
            stride = max(1, math.ceil((len(points) - 1) / 256))
            sampled = points[::stride]
            if sampled[-1] != points[-1]:
                sampled.append(points[-1])
            return dict(runId=record.id, intervals=intervals, sampleCount=len(points),
                        points=[dict(x=x, value=y) for x, y in sampled])

    def export(self, identity):
        with self.lock:
            record = self.get(identity)
            if record.operation:
                raise Invalid('Wait for the active operation before exporting its evidence')
            directory = self.root / 'runs' / record.id
            contents = list(self.evidence(record).items())
            contents.append(('execution.json', canonical(record.view())))
            manifest = dict(schemaVersion=1, executionKind='local-reference', specDigest=record.spec_digest,
                            files={name: hashlib.sha256(body).hexdigest() for name, body in contents},
                            recheck='python3 bundle/verify.py bundle --write',
                            scope='Local single-process CPU numerical reference; no Slurm or MPI evidence')
            output = io.BytesIO()
            with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
                for name, body in contents:
                    archive.writestr(name, body)
                archive.writestr('export-manifest.json', canonical(manifest))
            return output.getvalue()

    def close(self):
        with self.lock:
            for signal in self.cancelled.values():
                signal.set()
            workers = tuple(self.workers.values())
        for worker in workers:
            worker.join(timeout=5)
