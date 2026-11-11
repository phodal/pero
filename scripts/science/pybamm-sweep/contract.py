"""Frozen method values. Execution, files and HTTP belong to callers."""
from dataclasses import asdict, dataclass
import hashlib
import json
import math


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass(frozen=True)
class Experiment:
    id: str
    c_rate: float
    temperature_k: float


@dataclass(frozen=True)
class Method:
    method_id: str
    python: str
    model: str
    parameter_set: str
    thermal: str
    initial_soc: float
    capacity_ah: float
    duration_s: int
    sample_period_s: int
    mesh_points: int
    solver: str
    solver_rtol: float
    solver_atol: float
    comparison_atol_v: float
    comparison_rtol: float
    current_atol_a: float
    capacity_atol_ah: float
    experiments: tuple[Experiment, ...]

    @classmethod
    def parse(cls, value):
        raw = dict(value)
        raw['experiments'] = tuple(Experiment(**item) for item in raw['experiments'])
        method = cls(**raw)
        if (len(method.experiments) != 6 or len({e.id for e in method.experiments}) != 6
                or method.model != 'DFN' or method.solver != 'IDAKLU'
                or method.duration_s <= 0 or method.sample_period_s <= 0
                or method.duration_s % method.sample_period_s):
            raise ValueError('Unsupported frozen method')
        return method

    def experiment(self, identity: str) -> Experiment:
        for experiment in self.experiments:
            if experiment.id == identity:
                return experiment
        raise ValueError('Unknown experiment; only the frozen six are executable')

    @property
    def times(self) -> tuple[float, ...]:
        return tuple(range(0, self.duration_s + 1, self.sample_period_s))


@dataclass(frozen=True)
class Environment:
    python: str
    packages: tuple[tuple[str, str], ...]
    threads: int = 1

    @property
    def sha256(self) -> str:
        return digest(encoded(asdict(self)))


@dataclass(frozen=True)
class MethodIdentity:
    method: Method
    sha256: str
    environment: Environment

@dataclass(frozen=True)
class Result:
    experiment: Experiment
    method_id: str
    method_sha256: str
    environment: Environment
    hostname: str
    platform: str
    architecture: str
    elapsed_s: float
    termination: str
    time_s: tuple[float, ...]
    voltage_v: tuple[float, ...]
    current_a: tuple[float, ...]
    discharge_capacity_ah: tuple[float, ...]

    @classmethod
    def parse(cls, raw):
        raw = dict(raw)
        raw['experiment'] = Experiment(**raw['experiment'])
        env = raw['environment']
        raw['environment'] = Environment(env['python'], tuple(tuple(p) for p in env['packages']), env['threads'])
        for name in ('time_s', 'voltage_v', 'current_a', 'discharge_capacity_ah'):
            raw[name] = tuple(raw[name])
            if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in raw[name]):
                raise ValueError(f'Non-finite/non-numeric {name}')
        result = cls(**raw)
        if not math.isfinite(result.elapsed_s) or result.elapsed_s < 0:
            raise ValueError('Invalid elapsed seconds')
        return result
