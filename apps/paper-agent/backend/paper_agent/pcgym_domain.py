"""PC-Gym Table 6 research values. No network, process, storage or model calls.

An upstream-code rerun is NOT a confirmation of the paper's unresolved metric.
"""
from dataclasses import asdict, dataclass
import hashlib
import json
import math
from typing import Literal

PAPER = 'arxiv:2410.22093v4'
PAPER_URL = 'https://arxiv.org/html/2410.22093v4#S6.SS3'
UPSTREAM = 'https://github.com/MaximilianB2/pc-gym'
COMMIT = 'fbfb36bf84b494cd157cff88292e1fd1b864cee5'
POLICIES = ('base', 'shaped', 'oracle')
REPORTED = (('base', 0.0727), ('shaped', 0.0003), ('oracle', 0.0))
REQUIRED_PACKAGES = ('numpy', 'scipy', 'torch', 'gymnasium', 'stable-baselines3',
                     'casadi', 'do-mpc', 'jax', 'equinox', 'diffrax')
SCHEMA = 'pero.pcgym.reproduction.v1'


class Invalid(ValueError):
    """A named domain refusal; callers must not convert it into success."""
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def canonical(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def fields(value, required, optional=()):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional) or set(required) - set(value):
        raise Invalid('schema', f'Expected fields {sorted(required)}; optional {sorted(optional)}')
    return value


def identifier(value, name):
    if not isinstance(value, str) or len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
        raise Invalid('identity', f'{name} must be a lowercase SHA-256 identity')
    return value


def integer(value, name, low, high):
    if type(value) is not int or not low <= value <= high:
        raise Invalid('integer', f'{name} must be an integer in [{low}, {high}]')
    return value


def finite(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise Invalid('non_finite', f'{name} must be a finite number')
    return float(value)


@dataclass(frozen=True)
class MetricDefinition:
    """A rate's statistical unit and denominator are part of its identity."""
    measurement_grain: Literal['episode', 'sample']
    metric_definition: str
    numerator: str
    denominator: str
    unit: str = 'fraction'
    bounds_kelvin: tuple[float, float] = (321.0, 327.0)
    violation_predicate: str = 'T < 321 K or T > 327 K; endpoints are allowed'
    sample_grid: str = 'all registered samples, including the initial state'

    def counts(self, trace):
        low, high = self.bounds_kelvin
        mask = tuple(tuple(value < low or value > high for value in row)
                     for row in trace.temperatures)
        if self.measurement_grain == 'episode':
            return sum(any(row) for row in mask), len(mask)
        return sum(sum(row) for row in mask), sum(len(row) for row in mask)


EPISODE_METRIC = MetricDefinition(
    'episode', 'sum_i I(any_t violation(T_it)) / N',
    'episodes with at least one violating sample', 'all N registered episodes')
SAMPLE_METRIC = MetricDefinition(
    'sample', 'sum_i sum_t I(violation(T_it)) / sum_i n_i',
    'violating samples', 'all registered samples across all episodes')


@dataclass(frozen=True)
class Claim:
    paper: str = PAPER
    source_url: str = PAPER_URL
    source_locator: str = 'Section 6.3 / Equation 37 / Table 6'
    metric: MetricDefinition = EPISODE_METRIC
    implemented_metric: MetricDefinition = SAMPLE_METRIC
    metric_resolution: str = 'unresolved'
    reported: tuple[tuple[str, float], ...] = REPORTED

    def to_dict(self):
        return asdict(self)


@dataclass(frozen=True)
class PaperAnchor:
    """Optional already-observed Paper location, never guessed from a title."""
    paper_id: str
    document_id: str
    file_digest: str
    passage_id: str
    page: int

    @classmethod
    def parse(cls, raw):
        fields(raw, ('paper_id', 'document_id', 'file_digest', 'passage_id', 'page'))
        return cls(*(identifier(raw[k], k) for k in ('paper_id', 'document_id', 'file_digest', 'passage_id')),
                   integer(raw['page'], 'page', 1, 500))


@dataclass(frozen=True)
class ReproductionSpec:
    """Exactly one selected interpretation, all numerical attempts kept.

    This case deliberately has no writable tolerance or scientific PASS switch.
    Numerical distances to Table 6 are diagnostic until its grain is resolved.
    """
    seed: int
    steps: int
    episodes: int
    samples: int
    timeout_seconds: int
    packages: tuple[tuple[str, str], ...]
    source_manifest_digest: str
    python_version: str
    pipeline_digest: str
    metrics: tuple[MetricDefinition, ...] = (EPISODE_METRIC, SAMPLE_METRIC)
    anchor: PaperAnchor | None = None
    mode: str = 'adapted_upstream_rerun'
    profile: str = 'table6'
    comparison: str = 'dual_grain_unresolved'
    commit: str = COMMIT
    schema: str = SCHEMA

    @classmethod
    def create(cls, *, seed, profile, packages, source_manifest_digest,
               python_version, pipeline_digest, timeout_seconds=3600, anchor=None):
        if profile not in ('table6', 'smoke'):
            raise Invalid('profile', 'Choose table6 or smoke; smoke never establishes paper reproduction')
        seed = integer(seed, 'seed', 0, 2**31 - 1)
        timeout = integer(timeout_seconds, 'timeout_seconds', 1, 86400)
        identifier(source_manifest_digest, 'source_manifest_digest')
        identifier(pipeline_digest, 'pipeline_digest')
        if not isinstance(python_version, str) or not python_version or len(python_version) > 32:
            raise Invalid('environment', 'Freeze the exact Python version')
        if not isinstance(packages, dict) or set(packages) != set(REQUIRED_PACKAGES):
            raise Invalid('environment', 'Freeze the complete declared dependency inventory first')
        if any(not isinstance(v, str) or not 1 <= len(v) <= 100 for v in packages.values()):
            raise Invalid('environment', 'Package versions must be explicit strings')
        if anchor is not None and not isinstance(anchor, PaperAnchor):
            raise Invalid('anchor', 'Use a validated observed PaperAnchor')
        return cls(seed, 25000 if profile == 'table6' else 128,
                   50 if profile == 'table6' else 2, 60, timeout,
                   tuple(sorted(packages.items())), source_manifest_digest, python_version, pipeline_digest,
                   anchor=anchor, profile=profile)

    def payload(self):
        return asdict(self)

    @property
    def id(self):
        return digest(self.payload())

    def to_dict(self):
        return {'id': self.id, **self.payload()}

    @classmethod
    def parse(cls, raw):
        fields(raw, ('id', 'seed', 'steps', 'episodes', 'samples', 'timeout_seconds', 'packages',
                     'source_manifest_digest', 'python_version', 'pipeline_digest', 'metrics', 'anchor', 'mode', 'profile', 'comparison', 'commit', 'schema'))
        if not isinstance(raw['packages'], list) or any(not isinstance(p, list) or len(p) != 2 for p in raw['packages']):
            raise Invalid('environment', 'Expected package/version pairs')
        names = [p[0] for p in raw['packages']]
        if len(set(names)) != len(names):
            raise Invalid('environment', 'Duplicate package versions')
        spec = cls.create(seed=raw['seed'], profile=raw['profile'], packages=dict(raw['packages']),
                          source_manifest_digest=raw['source_manifest_digest'],
                          python_version=raw['python_version'], pipeline_digest=raw['pipeline_digest'],
                          timeout_seconds=raw['timeout_seconds'],
                          anchor=PaperAnchor.parse(raw['anchor']) if raw['anchor'] is not None else None)
        if raw != json.loads(canonical(spec.to_dict())):
            raise Invalid('spec_changed', 'Frozen specification differs from its declared identity or case policy')
        return spec

    def deviations(self):
        return (
            'The paper does not pin this upstream commit or a training seed.',
            'The driver deep-copies environment dictionaries to avoid the shared-dict mutation in constraint_paper.py.',
            'Evaluation uses fresh environments and explicitly seeded randomness; original streams are unavailable.',
            'The original custom_reward.py is executed unchanged, including its unresolved bound ordering.',
            'Fresh retraining does not recover the original unpublished checkpoints or raw Table 6 trajectories.',
            'Both metric grains are reported. Numerical proximity is not scientific confirmation.',
            *(() if self.profile == 'table6' else ('Smoke uses fewer training steps/episodes than the paper case.',)),
        )


@dataclass(frozen=True)
class PolicyTrace:
    policy: Literal['base', 'shaped', 'oracle']
    temperatures: tuple[tuple[float, ...], ...]  # [episode][sample], includes initial state

    @classmethod
    def parse(cls, raw, spec):
        fields(raw, ('policy', 'temperature_unit', 'temperatures', 'includes_initial_state'))
        if raw['policy'] not in POLICIES:
            raise Invalid('policy', 'Unexpected policy; preserve the whole base/shaped/oracle denominator')
        if raw['temperature_unit'] != 'K' or raw['includes_initial_state'] is not True:
            raise Invalid('units_or_grid', 'Expected Kelvin and the upstream initial-state-inclusive sample grid')
        values = raw['temperatures']
        if not isinstance(values, list) or len(values) != spec.episodes:
            raise Invalid('missing_episodes', 'All predeclared evaluation episodes must be present')
        rows = []
        for row in values:
            if not isinstance(row, list) or len(row) != spec.samples:
                raise Invalid('missing_samples', 'All predeclared samples must be present; no truncation or padding')
            rows.append(tuple(finite(v, 'temperature') for v in row))
        return cls(raw['policy'], tuple(rows))


@dataclass(frozen=True)
class Observation:
    spec_id: str
    attempt_id: str
    origin: str
    traces: tuple[PolicyTrace, ...]

    @classmethod
    def parse(cls, raw, spec):
        fields(raw, ('schema', 'spec_id', 'attempt_id', 'origin', 'policies'))
        if raw['schema'] != 'pero.pcgym.observation.v1' or raw['spec_id'] != spec.id:
            raise Invalid('wrong_spec', 'Observation does not belong to this frozen specification')
        identifier(raw['attempt_id'], 'attempt_id')
        if raw['origin'] not in ('pcgym-execution', 'imported', 'synthetic-fixture'):
            raise Invalid('origin', 'Observation origin must be explicit')
        if not isinstance(raw['policies'], list) or len(raw['policies']) != len(POLICIES):
            raise Invalid('missing_policies', 'Expected exactly base, shaped and oracle; no successful-only filtering')
        traces = tuple(PolicyTrace.parse(p, spec) for p in raw['policies'])
        if set(t.policy for t in traces) != set(POLICIES):
            raise Invalid('duplicate_policy', 'Missing or duplicate policy identity')
        return cls(spec.id, raw['attempt_id'], raw['origin'], traces)


@dataclass(frozen=True)
class MetricResult:
    policy: str
    violated_samples: int
    total_samples: int
    violated_episodes: int
    total_episodes: int
    sample_fraction: float
    episode_fraction: float
    reported: float
    sample_difference: float
    episode_difference: float
    episode_grid_compatible: bool


def evaluate(observation: Observation) -> tuple[MetricResult, ...]:
    """Independent checker: no numpy, solver, upstream reward or cached metric."""
    metrics = []
    for trace in observation.traces:
        count, total = SAMPLE_METRIC.counts(trace)
        episodes, n = EPISODE_METRIC.counts(trace)
        reference = dict(REPORTED)[trace.policy]
        # Four printed decimal places: this is quantisation, NOT an accepted tolerance.
        compatible = abs(round(reference * n) / n - reference) <= 0.00005 + 1e-12
        metrics.append(MetricResult(trace.policy, count, total, episodes, n, count / total,
                                    episodes / n, reference, count / total - reference,
                                    episodes / n - reference, compatible))
    return tuple(sorted(metrics, key=lambda m: POLICIES.index(m.policy)))


def verification(spec, observation, execution_status, receipt_matches):
    metrics = evaluate(observation)
    execution_checked = execution_status == 'completed' and receipt_matches and observation.origin == 'pcgym-execution'
    return {
        'schema': 'pero.pcgym.verification.v1',
        'spec_id': spec.id, 'attempt_id': observation.attempt_id,
        'checker_version': 'pcgym-dual-grain-v1',
        'execution_evidence': 'CONSISTENT' if execution_checked else 'UNVERIFIED',
        'numeric_recomputation': 'PASS',
        'paper_verdict': 'INCONCLUSIVE',
        'acceptance': 'unreviewed',
        'metrics': [asdict(m) for m in metrics],
        'reason': 'Equation 37 and the inspected implementation use different grains. Original experiment identity is unresolved.',
        'limitations': list(spec.deviations()) + [
            'Digests bind bytes; they do not attest an execution owner or prevent same-account tampering.',
            'A separate recomputation is not independent physical validation or an estimate of deployment safety.',
        ],
    }
