"""Immutable experiment concepts and deterministic bounded candidate generation."""
from dataclasses import dataclass, field
import hashlib
import json
import math
import re


MAX_EVIDENCE_SAMPLES = 40000


def sample_reservation(engine, samples):
    """Upper bound per accepted observation, not a promise about solver output."""
    # ngspice uses adaptive transient times and also emits a 301-point AC
    # table. Keep all returned points or reject the attempt; never truncate.
    samples = int(samples)
    return max(1000, 2 * samples) if engine == 'ngspice' else samples


class Invalid(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


@dataclass(frozen=True)
class Parameter:
    name: str
    label: str
    value: float
    minimum: float
    maximum: float
    step: float
    unit: str = ''

    def parse(self, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise Invalid(f'{self.label} must be a finite number')
        if not self.minimum <= value <= self.maximum:
            raise Invalid(f'{self.label} must be between {self.minimum} and {self.maximum}')
        if self.name == 'samples' and value != int(value):
            raise Invalid('Samples must be an integer')
        return float(value)

    def to_dict(self):
        return dict(name=self.name, label=self.label, value=self.value, min=self.minimum,
                    max=self.maximum, step=self.step, unit=self.unit)


@dataclass(frozen=True)
class Scenario:
    id: str
    label: str
    role: str
    parameters: tuple[tuple[str, float], ...]

    def to_dict(self):
        return dict(id=self.id, label=self.label, role=self.role, parameters=dict(self.parameters))


@dataclass(frozen=True)
class Template:
    id: str
    title: str
    description: str
    engine: str
    parameters: tuple[Parameter, ...]
    criteria: tuple[Parameter, ...]
    scenarios: tuple[Scenario, ...]

    def to_dict(self):
        return dict(id=self.id, title=self.title, description=self.description, engine=self.engine,
                    parameters=[p.to_dict() for p in self.parameters], criteria=[p.to_dict() for p in self.criteria],
                    scenarios=[s.to_dict() for s in self.scenarios])


def scenario(identity, role, label=None, **parameters):
    return Scenario(identity, label or identity.replace('-', ' ').title(), role, tuple(sorted(parameters.items())))


# Search is the comparison the chart may draw. Final verification repeats a
# subset under different scenario identities, so those trials are not the
# search observations and must not be plotted as the interactive comparison.
CONTROL_SCENARIOS = (
    scenario('nominal', 'search', 'Nominal', gain=1, damping=1),
    scenario('gain-low', 'search', 'Plant gain -20%', gain=.8, damping=1),
    scenario('gain-high', 'search', 'Plant gain +20%', gain=1.2, damping=1),
    scenario('damping-low', 'search', 'Damping -20%', gain=1, damping=.8),
    scenario('damping-high', 'search', 'Damping +20%', gain=1, damping=1.2),
    scenario('nominal-final', 'verification', 'Nominal final', gain=1, damping=1),
    scenario('damping-low-final', 'verification', 'Damping -20% final', gain=1, damping=.8),
)
CONTROL_PARAMETERS = (
    Parameter('kp', 'Proportional gain', 2, 0, 8, .1),
    Parameter('ki', 'Integral gain', 1, 0, 5, .1),
    Parameter('kd', 'Derivative gain', .3, 0, 2, .1),
    Parameter('n', 'Derivative filter pole', 12, 12, 12, 1, 'rad/s'),
    Parameter('horizon', 'Observation window', 10, 2, 50, 1, 's'),
    Parameter('samples', 'Samples', 1001, 101, 5001, 100),
)
CONTROL_CRITERIA = (
    Parameter('overshootMax', 'Maximum target overshoot', .1, 0, 2, .01, 'fraction'),
    Parameter('settlingMax', 'Maximum target settling time', 5, .1, 60, .1, 's'),
    Parameter('steadyErrorMax', 'Maximum target error', .01, .001, .5, .001),
    Parameter('settlingBand', 'Target settling band', .02, .001, .5, .001),
    Parameter('controlEffortMax', 'Maximum absolute control effort', 20, .1, 1000, .1),
    Parameter('disturbanceMax', 'Maximum final disturbance residual', .03, .001, 1, .001),
)
MARGIN_CRITERIA = (
    Parameter('gainMarginMin', 'Minimum gain margin', 6, 0, 80, .5, 'dB'),
    Parameter('phaseMarginMin', 'Minimum phase margin', 30, 0, 180, 1, 'deg'),
)
TEMPLATES = (
    Template('robust-pid', 'Robust filtered PID',
             'Continuous SISO plant 1/(s² + 2ζs + 1). Filtered derivative N=12. Search compares nominal and ±20% gain and damping. Final verification repeats nominal and damping -20% as separate trials.',
             'python-control', CONTROL_PARAMETERS, CONTROL_CRITERIA + MARGIN_CRITERIA, CONTROL_SCENARIOS),
    Template('p-golden', 'P controller · analytic golden',
             'G=1/(s+1), P=1. Reference response 0.5(1-exp(-2t)); unit-target steady error intentionally fails.',
             'python-control', tuple(p for p in CONTROL_PARAMETERS if p.name in ('horizon', 'samples')),
             CONTROL_CRITERIA, (scenario('nominal-search', 'search'), scenario('nominal-final', 'verification'))),
    Template('pi-golden', 'PI controller · analytic golden',
             'G=1/(s+1), PI=1+1/s. Reference response 1-exp(-t).',
             'python-control', tuple(p for p in CONTROL_PARAMETERS if p.name in ('horizon', 'samples')),
             CONTROL_CRITERIA, (scenario('nominal-search', 'search'), scenario('nominal-final', 'verification'))),
    Template('active-filter', 'Sallen–Key active low-pass',
             'Second-order equal-R/equal-C Sallen–Key low-pass with an idealized op-amp. Not a physical-device guarantee.',
             'ngspice', (
                 Parameter('r', 'Resistance', 1000, 100, 10000, 100, 'Ω'),
                 Parameter('c', 'Capacitance', 1e-7, 1e-9, 1e-5, 1e-8, 'F'),
                 Parameter('gain', 'Amplifier gain', 1.586, 1, 2.8, .01),
                 Parameter('horizon', 'Observation window', .005, .001, .1, .001, 's'),
                 Parameter('samples', 'Samples', 1001, 101, 5001, 100),
             ), (
                 Parameter('cutoffTarget', 'Target −3 dB cutoff', 1591.5494309, 10, 50000, 10, 'Hz'),
                 Parameter('cutoffTolerance', 'Cutoff relative tolerance', .2, .01, .9, .01),
                 Parameter('passbandGainTarget', 'Target DC gain', 1.586, 1, 2.8, .01),
                 Parameter('gainTolerance', 'DC gain relative tolerance', .05, .001, .5, .01),
                 Parameter('peakingMax', 'Maximum passband peaking', 1, 0, 12, .1, 'dB'),
             ), (
                 scenario('nominal-search', 'search', componentScale=1),
                 scenario('nominal-final', 'verification', componentScale=1),
                 scenario('components-low-final', 'verification', componentScale=.97),
                 scenario('components-high-final', 'verification', componentScale=1.03),
             )),
)


def template(identity):
    for item in TEMPLATES:
        if item.id == identity:
            return item
    raise Invalid('Unknown experiment template')


def values(fields, supplied):
    if not isinstance(supplied, dict) or set(supplied) - {p.name for p in fields}:
        raise Invalid('Unknown parameter or invalid parameter object')
    return tuple((p.name, p.parse(supplied.get(p.name, p.value))) for p in fields)


@dataclass(frozen=True)
class ExperimentSpec:
    template_id: str
    parameters: tuple[tuple[str, float], ...]
    criteria: tuple[tuple[str, float], ...]
    scenarios: tuple[Scenario, ...]
    candidate_budget: int = 8
    method_version: str = 'control-lab-v1'
    search_space: tuple[tuple[str, float, float], ...] = ()

    @classmethod
    def parse(cls, data):
        if not isinstance(data, dict) or set(data) - {'templateId', 'parameters', 'criteria', 'candidateBudget'}:
            raise Invalid('Invalid experiment request')
        item = template(data.get('templateId'))
        # Five robust-PID search cases plus two final trials, at the default
        # 1001-point grid, exceed 40000 evidence points above 7 candidates.
        budget = data.get('candidateBudget', 6)
        if isinstance(budget, bool) or not isinstance(budget, int) or not 1 <= budget <= 30:
            raise Invalid('Candidate budget must be an integer from 1 to 30')
        parameters = values(item.parameters, data.get('parameters', {}))
        parsed = dict(parameters)
        search_count=sum(s.role=='search' for s in item.scenarios)
        final_count=sum(s.role=='verification' for s in item.scenarios)
        effective_budget=1 if item.id in ('p-golden','pi-golden') else budget
        if (effective_budget*search_count+final_count)*sample_reservation(item.engine, parsed['samples']) > MAX_EVIDENCE_SAMPLES:
            raise Invalid('The frozen search and final-verification plan exceeds 40000 evidence sample-points; reduce candidate budget or samples (shorten horizon to retain 0.01 s control resolution)')
        if item.engine == 'python-control' and parsed['horizon']/(parsed['samples']-1) > .010000001:
            raise Invalid('Control responses require a sample interval at most 0.01 s; increase samples or shorten the horizon')
        names={'kp','ki','kd'} if item.id=='robust-pid' else {'r','c','gain'} if item.id=='active-filter' else set()
        bounds=tuple((p.name,p.minimum,p.maximum) for p in item.parameters if p.name in names)
        return cls(item.id, parameters, values(item.criteria, data.get('criteria', {})), item.scenarios, budget, search_space=bounds)

    @classmethod
    def restore(cls, record):
        scenarios = tuple(Scenario(s['id'], s['label'], s['role'], tuple(sorted(s['parameters'].items()))) for s in record['scenarios'])
        return cls(record['templateId'], tuple(record['parameters'].items()), tuple(record['criteria'].items()),
                   scenarios, record['candidateBudget'], record['methodVersion'],tuple((name,limit['min'],limit['max']) for name,limit in record['searchSpace'].items()))

    def to_dict(self):
        return dict(templateId=self.template_id, parameters=dict(self.parameters), criteria=dict(self.criteria),
                    scenarios=[s.to_dict() for s in self.scenarios], searchSpace={name:dict(min=low,max=high) for name,low,high in self.search_space}, candidateBudget=self.candidate_budget, methodVersion=self.method_version)

    @property
    def hash(self):
        return digest(self.to_dict())


@dataclass(frozen=True)
class Goal:
    """One Host-approved experiment, referring to the existing frozen Spec."""
    experiment_id: str
    spec_hash: str
    max_experiments: int = field(default=1, init=False)

    def __post_init__(self):
        if not isinstance(self.experiment_id, str) or not re.fullmatch(r'[a-f0-9]{32}', self.experiment_id):
            raise Invalid('An experiment ID is required')
        if not isinstance(self.spec_hash, str) or not re.fullmatch(r'[a-f0-9]{64}', self.spec_hash):
            raise Invalid('A frozen specification hash is required')

    def require_record(self, record):
        if (record['id'] != self.experiment_id or record['specHash'] != self.spec_hash
                or ExperimentSpec.restore(record).hash != self.spec_hash):
            raise Invalid('The approved goal does not match the frozen specification')


@dataclass(frozen=True)
class Candidate:
    id: str
    label: str
    parameters: tuple[tuple[str, float], ...]

    def to_dict(self):
        return dict(id=self.id, label=self.label, parameters=dict(self.parameters), score=None, verdict='NOT_RUN')


def candidates(spec, budget):
    if isinstance(budget, bool) or not isinstance(budget, int) or not 1 <= budget <= 30:
        raise Invalid('Candidate budget must be an integer from 1 to 30')
    base = dict(spec.parameters)
    result = [Candidate('baseline', 'Baseline', spec.parameters)]
    if spec.template_id in ('p-golden', 'pi-golden'):
        return tuple(result)
    fields = {name:(low,high) for name,low,high in spec.search_space}
    names = ('kp', 'ki', 'kd') if spec.template_id == 'robust-pid' else ('r', 'c', 'gain')
    # Fixed low-discrepancy exploration: bounded, replayable and independent of final scenarios.
    for i in range(1, budget):
        proposal = dict(base)
        for j, name in enumerate(names):
            fraction = ((i * (j * 6 + 7)) % 29) / 28
            factor = .45 + 1.1 * fraction
            low,high = fields[name]
            proposal[name] = min(high, max(low, base[name] * factor))
        result.append(Candidate(f'candidate-{i:02d}', f'Candidate {i}', tuple(proposal.items())))
    return tuple(result)


@dataclass(frozen=True)
class Attempt:
    id: str
    status: str
    error: str | None


@dataclass(frozen=True)
class Trial:
    id: str
    candidate_id: str
    scenario_id: str
    phase: str
    attempt: Attempt

    def to_dict(self):
        return dict(id=self.id, candidateId=self.candidate_id, scenarioId=self.scenario_id,
                    phase=self.phase, status=self.attempt.status, error=self.attempt.error,
                    attemptId=self.attempt.id, observation=None, report=None)


def input_digest(spec, candidate, scenario):
    return digest(dict(specHash=spec.hash, candidateId=candidate.id, parameters=dict(candidate.parameters), scenario=scenario.to_dict()))


def proposal(spec, supplied):
    names={'kp','ki','kd'} if spec.template_id=='robust-pid' else {'r','c','gain'} if spec.template_id=='active-filter' else set()
    if not isinstance(supplied,dict) or not supplied or set(supplied)-names:
        raise Invalid('Candidate proposal may change only this template’s controller or component values')
    parameters=dict(spec.parameters)
    fields={name:(low,high) for name,low,high in spec.search_space}
    for name,value in supplied.items():
        low,high=fields[name]
        parameters[name]=Parameter(name,name,parameters[name],low,high,0).parse(value)
    identity='proposal-'+digest(parameters)[:16]
    return Candidate(identity,'Agent/user proposal',tuple(parameters.items()))


def admit_attempts(spec, existing_samples, new_attempts):
    required=existing_samples+new_attempts*sample_reservation(template(spec.template_id).engine, dict(spec.parameters)['samples'])
    if required>MAX_EVIDENCE_SAMPLES:
        raise Invalid('This experiment has reached its 40000 evidence sample-point budget; export it and create a new experiment rather than growing an unreadable ledger')
