"""Benchmark evidence values. These are App records, not Compute Task/Run state."""
from dataclasses import dataclass, replace
import math


class Invalid(ValueError):
    pass


Scalar = str | int | float | bool | None


@dataclass(frozen=True)
class Property:
    name: str
    value: Scalar

    @staticmethod
    def admit(values):
        if not isinstance(values, dict):
            raise Invalid('Expected named scalar values')
        result = []
        for key, value in values.items():
            if not isinstance(key, str) or not isinstance(value, (str, int, float, bool, type(None))):
                raise Invalid('Expected named scalar values')
            if isinstance(value, float) and not math.isfinite(value):
                raise Invalid('Non-finite report value')
            result.append(Property(key, value))
        return tuple(result)


def properties(values):
    return {item.name: item.value for item in values}


@dataclass(frozen=True)
class Benchmark:
    id: str
    name: str
    version: str
    description: str
    execution_kind: str
    available: bool
    unavailable_reason: str | None
    spec_digest: str
    environment: tuple[Property, ...] = ()
    parameters: tuple[Property, ...] = ()
    criteria: tuple[Property, ...] = ()

    def view(self):
        return dict(id=self.id, name=self.name, version=self.version, description=self.description,
                    executionKind=self.execution_kind, available=self.available,
                    unavailableReason=self.unavailable_reason, specDigest=self.spec_digest,
                    environment=properties(self.environment), parameters=properties(self.parameters),
                    criteria=properties(self.criteria))


@dataclass(frozen=True)
class Check:
    id: str
    label: str
    passed: bool
    value: Scalar
    threshold: Scalar | tuple[float, ...]

    def view(self):
        return dict(id=self.id, label=self.label, passed=self.passed, value=self.value,
                    threshold=list(self.threshold) if isinstance(self.threshold, tuple) else self.threshold)


@dataclass(frozen=True)
class Verification:
    status: str
    metrics: tuple[Property, ...]
    thresholds: tuple[Property, ...]
    errors: tuple[str, ...]
    checks: tuple[Check, ...] = ()

    @staticmethod
    def admit(value):
        if not isinstance(value, dict) or value.get('schemaVersion') != 1:
            raise Invalid('Unsupported independent checker report')
        if value.get('status') not in ('pass', 'fail', 'incomplete'):
            raise Invalid('Unknown independent checker status')
        errors = value.get('errors', [])
        if not isinstance(errors, list) or not all(isinstance(error, str) for error in errors):
            raise Invalid('Invalid checker errors')
        checks = []
        for item in value.get('checks', []):
            value_field = Property.admit({'value': item.get('value')})[0].value
            threshold = item.get('threshold')
            if isinstance(threshold, list):
                if not all(type(number) in (int, float) and math.isfinite(number) for number in threshold):
                    raise Invalid('Invalid checker range')
                threshold = tuple(threshold)
            else:
                threshold = Property.admit({'threshold': threshold})[0].value
            if not isinstance(item.get('passed'), bool):
                raise Invalid('Invalid checker decision')
            checks.append(Check(str(item['id']), str(item['label']), item['passed'],
                                value_field, threshold))
        return Verification(value['status'], Property.admit(value.get('metrics', {})),
                            Property.admit(value.get('thresholds', {})), tuple(errors), tuple(checks))

    def view(self):
        return dict(schemaVersion=1, status=self.status, metrics=properties(self.metrics),
                    thresholds=properties(self.thresholds), errors=list(self.errors),
                    checks=[item.view() for item in self.checks])


@dataclass(frozen=True)
class Artifact:
    name: str
    bytes: int
    sha256: str

    def view(self):
        return dict(name=self.name, bytes=self.bytes, sha256=self.sha256)


@dataclass(frozen=True)
class BenchmarkExecution:
    id: str
    benchmark_id: str
    benchmark_name: str
    spec_digest: str
    execution_kind: str
    status: str
    operation: str | None
    created_at: str
    updated_at: str
    reframe_version: str | None = None
    elapsed_seconds: float | None = None
    exit_code: int | None = None
    verification: Verification | None = None
    error: str | None = None
    artifacts: tuple[Artifact, ...] = ()
    logs: str = ''

    @staticmethod
    def start(benchmark, identity, timestamp, version):
        if not benchmark.available or benchmark.execution_kind != 'local-reference':
            raise Invalid(benchmark.unavailable_reason or 'Benchmark is unavailable')
        return BenchmarkExecution(identity, benchmark.id, benchmark.name, benchmark.spec_digest,
                                  benchmark.execution_kind, 'running', 'run', timestamp, timestamp,
                                  reframe_version=version)

    def finish(self, exit_code, elapsed, timestamp, verification, artifacts, logs, cancelled=False):
        status = 'cancelled' if cancelled else 'completed' if exit_code == 0 else 'failed'
        return replace(self, status=status, operation=None, updated_at=timestamp, exit_code=exit_code,
                       elapsed_seconds=elapsed, verification=verification, artifacts=artifacts,
                       logs=logs, error=None if status in ('completed', 'cancelled') else
                       'ReFrame did not complete successfully; inspect the retained log')

    def begin_verification(self, timestamp):
        if self.operation:
            raise Invalid('An operation is already active for this execution')
        return replace(self, operation='verify', updated_at=timestamp, error=None, verification=None)

    def interrupt(self, timestamp):
        if not self.operation:
            return self
        return replace(self, status='interrupted' if self.operation == 'run' else self.status,
                       operation=None, updated_at=timestamp,
                       error='The App stopped during this operation. Evidence is retained; it was not rerun.')

    def view(self):
        return dict(id=self.id, benchmarkId=self.benchmark_id, benchmarkName=self.benchmark_name,
                    specDigest=self.spec_digest, executionKind=self.execution_kind, status=self.status,
                    operation=self.operation, createdAt=self.created_at, updatedAt=self.updated_at,
                    reframeVersion=self.reframe_version, elapsedSeconds=self.elapsed_seconds,
                    exitCode=self.exit_code, verification=self.verification.view() if self.verification else None,
                    error=self.error, artifacts=[item.view() for item in self.artifacts], logs=self.logs)

    @staticmethod
    def restore(value):
        return BenchmarkExecution(value['id'], value['benchmarkId'], value['benchmarkName'],
                                  value['specDigest'], value['executionKind'], value['status'],
                                  value['operation'], value['createdAt'], value['updatedAt'],
                                  value.get('reframeVersion'), value.get('elapsedSeconds'),
                                  value.get('exitCode'), Verification.admit(value['verification'])
                                  if value.get('verification') else None, value.get('error'),
                                  tuple(Artifact(**item) for item in value.get('artifacts', [])),
                                  value.get('logs', ''))


@dataclass(frozen=True)
class BenchmarkComparison:
    executions: tuple[BenchmarkExecution, ...]
    comparable: bool
    reason: str

    def view(self):
        return dict(runIds=[item.id for item in self.executions], comparable=self.comparable,
                    specDigest=self.executions[0].spec_digest if self.comparable else None,
                    reason=self.reason,
                    rows=[dict(runId=item.id, status=item.status,
                               verificationStatus=item.verification.status if item.verification else None,
                               elapsedSeconds=item.elapsed_seconds,
                               metrics=properties(item.verification.metrics) if item.verification else {})
                          for item in self.executions])


def comparison(executions):
    if not 2 <= len(executions) <= 8:
        raise Invalid('Compare between two and eight executions')
    digests = {item.spec_digest for item in executions}
    kinds = {item.execution_kind for item in executions}
    complete = all(item.status in ('completed', 'failed') and item.operation is None
                   and item.verification and item.verification.status in ('pass', 'fail')
                   and item.verification.metrics for item in executions)
    comparable = len(digests) == 1 and len(kinds) == 1 and complete
    return BenchmarkComparison(executions, comparable,
                               'Same frozen definition and execution kind' if comparable else
                               'Comparison needs the same frozen definition, execution kind and completed numerical evidence')
