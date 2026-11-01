"""Frozen PC-Gym research contracts. Pure values; no network, clock, or solver."""
from dataclasses import asdict, dataclass
from enum import Enum
import hashlib
import json
import math
import re

PAPER = 'arxiv:2410.22093v4'
COMMIT = 'fbfb36bf84b494cd157cff88292e1fd1b864cee5'
CASE = 'pcgym-cstr-table6-v1'
POLICIES = ('base', 'shaped', 'oracle')
REPORTED = (0.0727, 0.0003, 0.0)


class ReproductionError(ValueError):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False,
                      allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def fields(value, required, optional=()):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional) or set(required) - set(value):
        raise ReproductionError('schema', f'Expected fields: {", ".join(required)}')
    return value


def identity(value):
    if not isinstance(value, str) or not re.fullmatch('[a-f0-9]{64}', value):
        raise ReproductionError('identity', 'Expected an existing immutable record ID')
    return value


def integer(value, name, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ReproductionError('integer', f'{name} must be an integer in [{low}, {high}]')
    return value


class Grain(str, Enum):
    EPISODE = 'episode-any'
    SAMPLE = 'sample-fraction'


@dataclass(frozen=True)
class ResearchClaim:
    paper_id: str
    document_id: str
    file_digest: str
    page_text_digest: str
    annotation_id: str | None = None
    paper_version: str = PAPER
    page: int = 20
    lower_kelvin: float = 321.0
    upper_kelvin: float = 327.0
    reported: tuple[float, ...] = REPORTED

    @property
    def id(self):
        return digest(self.to_dict())

    def to_dict(self):
        result = asdict(self)
        result['reported'] = list(self.reported)
        return result

    @classmethod
    def from_document(cls, paper_id, document_id, file_digest, first_page, page_text, annotation_id=None):
        identity(paper_id); identity(document_id)
        if annotation_id is not None:
            identity(annotation_id)
        if not isinstance(file_digest, str) or not re.fullmatch('(sha256:)?[a-f0-9]{64}', file_digest):
            raise ReproductionError('source_digest', 'A saved PDF byte digest is required')
        if '2410.22093v4' not in re.sub(r'\s+', '', first_page):
            raise ReproductionError('paper_version', 'This case requires the saved arXiv v4 PDF')
        compact = re.sub(r'\s+', '', page_text).lower()
        # Verify the row/value associations, not just the presence of three numbers.
        for marker in ('table6', 'basereward0.0727', 'shapedreward0.0003', 'oracle0.0000', 'episodes', 'trajectory'):
            if marker not in compact:
                raise ReproductionError('claim_source', 'Table 6 / Eq. 37 cannot be located on saved PDF page 20')
        return cls(paper_id, document_id, file_digest,
                   hashlib.sha256(page_text.encode('utf-8')).hexdigest(), annotation_id)

    @classmethod
    def restore(cls, value):
        value = dict(value)
        value['reported'] = tuple(value['reported'])
        claim = cls(**value)
        if claim.paper_version != PAPER or claim.page != 20 or claim.reported != REPORTED:
            raise ReproductionError('claim_changed', 'Case identity or reported values were changed')
        if (claim.lower_kelvin, claim.upper_kelvin) != (321.0, 327.0):
            raise ReproductionError('claim_changed', 'Paper constraint bounds were changed')
        return claim


@dataclass(frozen=True)
class Environment:
    python: str
    packages: tuple[tuple[str, str], ...]
    source_commit: str
    source_digest: str
    available: bool
    reasons: tuple[str, ...] = ()

    @property
    def id(self):
        return digest(asdict(self))

    def to_dict(self):
        return {**asdict(self), 'id': self.id}

    @classmethod
    def restore(cls, value):
        data = {k: v for k, v in value.items() if k != 'id'}
        data['packages'] = tuple(tuple(p) for p in data['packages'])
        data['reasons'] = tuple(data['reasons'])
        env = cls(**data)
        if value.get('id') != env.id:
            raise ReproductionError('environment_digest', 'Environment snapshot was changed')
        return env


@dataclass(frozen=True)
class ReproductionSpec:
    claim: ResearchClaim
    audit_id: str
    environment: Environment
    profile: str
    seed: int
    include_oracle: bool
    max_seconds: int
    schema: str = 'pero.paper-reproduction.v1'
    case_id: str = CASE
    code_commit: str = COMMIT
    samples_per_episode: int = 60
    horizon_minutes: float = 26.0
    include_initial_state: bool = True
    policy_revision: str = 'equation35-rerun-v1'
    observation_kind: str = 'denormalized-noisy-observation; oracle-model-state'
    sample_interval_minutes: float = 26.0 / 60.0
    transitions_per_episode: int = 59
    last_action_applied: bool = False

    @property
    def training_steps(self):
        return 25000 if self.profile == 'audited-rerun' else 128

    @property
    def episodes(self):
        return 50 if self.profile == 'audited-rerun' else 2

    @property
    def id(self):
        return digest(self.to_dict())

    @classmethod
    def prepare(cls, claim, audit_id, environment, value):
        fields(value, ('profile', 'seed', 'includeOracle', 'maxSeconds'))
        if value['profile'] not in ('audited-rerun', 'integration-smoke'):
            raise ReproductionError('profile', 'Choose audited-rerun or integration-smoke')
        seed = integer(value['seed'], 'seed', 0, 2**31 - 1)
        timeout = integer(value['maxSeconds'], 'maxSeconds', 30, 7200)
        if type(value['includeOracle']) is not bool:
            raise ReproductionError('oracle', 'includeOracle must be a boolean')
        return cls(claim, identity(audit_id), environment, value['profile'], seed,
                   value['includeOracle'], timeout)

    def to_dict(self):
        result = asdict(self)
        result.update(claim=self.claim.to_dict(), environment=self.environment.to_dict(),
                      training_steps=self.training_steps, episodes=self.episodes)
        return result

    @classmethod
    def restore(cls, value):
        spec = cls.prepare(ResearchClaim.restore(value['claim']), value['audit_id'],
                           Environment.restore(value['environment']),
                           dict(profile=value['profile'], seed=value['seed'],
                                includeOracle=value['include_oracle'], maxSeconds=value['max_seconds']))
        if canonical(spec.to_dict()) != canonical(value):
            raise ReproductionError('spec_changed', 'Frozen reproduction specification was changed')
        return spec

    def require_environment(self, observed):
        if not observed.available:
            raise ReproductionError('environment_unavailable', '; '.join(observed.reasons), 409)
        if observed.id != self.environment.id:
            raise ReproductionError('environment_changed', 'Prepare a new spec for the changed environment', 409)


@dataclass(frozen=True)
class Trajectory:
    policy: str
    episode: int
    seed: int
    temperature_kelvin: tuple[float, ...]
    concentration: tuple[float, ...]
    coolant_kelvin: tuple[float, ...]

    @classmethod
    def parse(cls, value, spec):
        fields(value, ('policy', 'episode', 'seed', 'temperature_kelvin', 'concentration', 'coolant_kelvin'))
        if value['policy'] not in POLICIES:
            raise ReproductionError('policy', 'Unknown policy')
        episode = integer(value['episode'], 'episode', 0, spec.episodes - 1)
        expected_seed = spec.seed + 1000 + episode
        if value['seed'] != expected_seed or type(value['seed']) is not int:
            raise ReproductionError('seed', 'Evaluation seed does not match the frozen schedule')
        series = []
        for key in ('temperature_kelvin', 'concentration', 'coolant_kelvin'):
            values = value[key]
            if not isinstance(values, (tuple, list)) or len(values) != spec.samples_per_episode:
                raise ReproductionError('coverage', 'Every episode must contain all 60 recorded states/actions')
            if any(type(x) not in (int, float) or not math.isfinite(x) for x in values):
                raise ReproductionError('nonfinite', 'Non-finite or nonnumeric samples cannot be scored')
            series.append(tuple(float(x) for x in values))
        if not all(250 < x < 500 for x in series[0]):
            raise ReproductionError('units', 'Temperature must be Kelvin, not Celsius or normalized observations')
        return cls(value['policy'], episode, expected_seed, *series)

    def to_dict(self):
        return asdict(self)


@dataclass(frozen=True)
class MetricResult:
    grain: str
    numerator: int
    denominator: int
    value: float


def violation_metrics(traces, lower=321.0, upper=327.0):
    """Independent raw-trace checks; never read reward or a solver's metric."""
    if not traces or any(not row for row in traces):
        raise ReproductionError('empty_evidence', 'No complete temperature trajectories')
    if any(type(x) not in (int, float) or not math.isfinite(x) for row in traces for x in row):
        raise ReproductionError('nonfinite', 'Invalid temperature sample')
    flags = tuple(tuple(x < lower or x > upper for x in row) for row in traces)
    bad_episodes = sum(any(row) for row in flags)
    bad_samples = sum(sum(row) for row in flags)
    samples = sum(map(len, flags))
    return (MetricResult(Grain.EPISODE.value, bad_episodes, len(flags), bad_episodes / len(flags)),
            MetricResult(Grain.SAMPLE.value, bad_samples, samples, bad_samples / samples))


def verify(spec, trajectories, execution_status, origin):
    """Report arithmetic, coverage, comparability and acceptance separately."""
    seen = set()
    for trace in trajectories:
        key = (trace.policy, trace.episode)
        if key in seen:
            raise ReproductionError('duplicate_episode', 'Repeated episodes cannot increase the denominator')
        seen.add(key)
    rows = []
    for policy, reported in zip(POLICIES, REPORTED):
        selected = sorted((t for t in trajectories if t.policy == policy), key=lambda t: t.episode)
        metrics = violation_metrics(tuple(t.temperature_kelvin for t in selected)) if selected else ()
        complete = len(selected) == spec.episodes
        rows.append(dict(policy=policy, reported=reported, received_episodes=len(selected),
                         expected_episodes=spec.episodes, coverage='complete' if complete else 'incomplete',
                         metrics=[asdict(m) for m in metrics],
                         differences={m.grain: m.value - reported for m in metrics},
                         table6_comparison='INCONCLUSIVE'))
    completed = execution_status == 'succeeded' and all(r['coverage'] == 'complete' for r in rows)
    return dict(schema='pero.paper-verification.v1', spec_id=spec.id,
                verifier='pcgym-independent-counts-v1', source_origin=origin,
                execution_status=execution_status,
                coverage_check='PASS' if completed else 'INCONCLUSIVE',
                arithmetic_check='PASS' if trajectories else 'NOT_RUN',
                paper_comparison='INCONCLUSIVE', scientific_acceptance='unverified', rows=rows,
                limitations=[
                    'Equation 37 is episode-level; the inspected code averages samples. This ambiguity is unresolved.',
                    'This is an explicitly revised, seeded rerun, not the original policies or Table 6 evaluation data.',
                    'The frozen upstream commit is later than the paper; exact paper-code correspondence is unproven.',
                    'A zero count in sampled simulation is not a physical safety guarantee.',
                    *( ['Integration smoke is not paper-level reproduction.'] if spec.profile == 'integration-smoke' else []),
                    *( ['Imported/fixture outputs are not authenticated execution receipts.'] if origin != 'local-pcgym' else []),
                ])
