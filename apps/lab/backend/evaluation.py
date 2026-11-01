"""Independent checks against frozen criteria, never agent-declared success."""
from dataclasses import asdict, dataclass
from domain import EvaluationCriteria, Invalid, LabState, WELL_IDS, number, object_fields

LIMITATIONS = (
    'Simulation only; no physical or biological validity.',
    'Dye fractions use an illustrative volume-weighted model, not PyLabRobot physics.',
    'Imported measurements are user supplied and not independently calibrated.',
)


@dataclass(frozen=True)
class Measurement:
    well: str
    value: float
    unit: str = 'fraction'

    def to_dict(self):
        return asdict(self)


@dataclass(frozen=True)
class Observation:
    origin: str
    source: str
    measurements: tuple[Measurement, ...]

    def to_dict(self):
        return {'origin': self.origin, 'source': self.source,
                'measurements': [m.to_dict() for m in self.measurements]}


def parse_measurements(raw) -> tuple[Measurement, ...]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= 96:
        raise Invalid('measurements', 'Provide 1–96 measurement rows')
    result = []
    seen = set()
    for row in raw:
        row = object_fields(row, ('well', 'value', 'unit'), ('well', 'value', 'unit'))
        if not isinstance(row['well'], str) or row['well'] not in WELL_IDS or row['well'] in seen:
            raise Invalid('measurements', 'Measurement wells must be unique A1–H12 identities')
        if row['unit'] != 'fraction':
            raise Invalid('units', 'Measurement unit must be fraction (0–1), not percent')
        result.append(Measurement(row['well'], number(row['value'], 'measurement value', 0, 1)))
        seen.add(row['well'])
    return tuple(result)


def parse_observation(raw) -> Observation:
    raw = object_fields(raw, ('origin', 'source', 'measurements'), ('origin', 'source', 'measurements'))
    if raw['origin'] not in ('synthetic', 'imported'):
        raise Invalid('origin', 'Only synthetic or imported observations are supported; no device path exists')
    if not isinstance(raw['source'], str) or not 1 <= len(raw['source'].strip()) <= 500:
        raise Invalid('source', 'Observation source must contain 1–500 characters')
    return Observation(raw['origin'], raw['source'].strip(), parse_measurements(raw['measurements']))


@dataclass(frozen=True)
class Check:
    name: str
    verdict: str
    actual: float | None
    limit: float | None
    message: str


@dataclass(frozen=True)
class Verification:
    verdict: str
    checks: tuple[Check, ...]
    absolute_error: float | None
    limitations: tuple[str, ...] = LIMITATIONS

    def to_dict(self):
        return {'verdict': self.verdict, 'checks': [asdict(c) for c in self.checks],
                'absolute_error': self.absolute_error, 'limitations': list(self.limitations)}


def evaluate(criteria: EvaluationCriteria, observation: Observation | None,
             final_state: LabState | None, execution_status: str) -> Verification:
    checks = []
    completed = execution_status == 'completed' and final_state is not None
    checks.append(Check('execution', 'PASS' if completed else 'INCONCLUSIVE', None, None,
                        'Execution completed' if completed else 'No completed execution evidence'))
    volume = final_state.well(criteria.target_well).volume_ul if completed else None
    checks.append(Check('target_volume_ul', 'INCONCLUSIVE' if volume is None else
                        ('PASS' if abs(volume - criteria.target_volume_ul) <= criteria.volume_tolerance_ul + 1e-9 else 'FAIL'),
                        volume, criteria.target_volume_ul, f'Tolerance ±{criteria.volume_tolerance_ul:g} µL'))
    measurement = next((m for m in observation.measurements if m.well == criteria.target_well), None) if observation else None
    error = abs(measurement.value - criteria.target_fraction) if measurement else None
    checks.append(Check('observed_fraction', 'INCONCLUSIVE' if error is None else
                        ('PASS' if error <= criteria.tolerance + 1e-12 else 'FAIL'),
                        measurement.value if measurement else None, criteria.target_fraction,
                        f'Tolerance ±{criteria.tolerance:g} fraction; ' +
                        (f'{observation.origin}: {observation.source}' if observation else 'No observation attached')))
    verdicts = {check.verdict for check in checks}
    verdict = 'FAIL' if 'FAIL' in verdicts else ('INCONCLUSIVE' if 'INCONCLUSIVE' in verdicts else 'PASS')
    return Verification(verdict, tuple(checks), error)
