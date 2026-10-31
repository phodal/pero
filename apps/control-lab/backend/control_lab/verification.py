"""Independent verification of saved observations; never calls a solver."""
from dataclasses import dataclass
import math
from .experiments import Invalid, candidates, canonical, digest, input_digest


@dataclass(frozen=True)
class Series:
    name: str
    unit: str
    x: tuple[float, ...]
    y: tuple[float, ...]
    x_unit: str = 's'

    @classmethod
    def parse(cls, value):
        x, y = tuple(value['x']), tuple(value['y'])
        if len(x) != len(y) or len(x) < 2:
            raise Invalid('Solver series has missing samples')
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in x + y):
            raise Invalid('Solver series contains non-finite samples')
        if any(b <= a for a, b in zip(x, x[1:])):
            raise Invalid('Solver sample coordinates must strictly increase')
        return cls(value['name'], value.get('unit', ''), x, y, value.get('xUnit', 's'))

    def to_dict(self):
        return dict(name=self.name, unit=self.unit, x=list(self.x), y=list(self.y), xUnit=self.x_unit)


@dataclass(frozen=True)
class Observation:
    id: str
    engine: str
    engine_version: str
    input_digest: str
    internal_stable: bool
    series: tuple[Series, ...]
    metrics: tuple[tuple[str, object], ...]
    artifacts: tuple[tuple[str, str], ...]
    diagnostics: tuple[str, ...]

    @classmethod
    def from_solver(cls, result, engine, artifacts, binding):
        series = tuple(Series.parse(s) for s in result.get('series', []))
        if not series or len({s.name for s in series}) != len(series):
            raise Invalid('Solver output has missing or duplicate series')
        if not isinstance(result.get('internalStable'), bool):
            raise Invalid('Solver did not provide internal stability evidence')
        payload = dict(inputDigest=binding, engine=engine, engineVersion=result.get('engineVersion', 'unknown'),
                       internalStable=result['internalStable'], series=[s.to_dict() for s in series],
                       metrics=result.get('metrics', {}), artifacts=artifacts,
                       diagnostics=result.get('diagnostics', []))
        canonical(payload)
        return cls(digest(payload), engine, payload['engineVersion'], binding, payload['internalStable'], series,
                   tuple(payload['metrics'].items()), tuple((a['name'], a['sha256']) for a in artifacts),
                   tuple(payload['diagnostics']))

    @classmethod
    def parse(cls, value):
        result = cls.from_solver(value, value['engine'], value.get('artifacts', []), value['inputDigest'])
        if result.id != value['id']:
            raise Invalid('Saved observation digest does not match its contents')
        return result

    def to_dict(self):
        return dict(id=self.id, inputDigest=self.input_digest, engine=self.engine, engineVersion=self.engine_version,
                    internalStable=self.internal_stable, series=[s.to_dict() for s in self.series],
                    metrics=dict(self.metrics), artifacts=[dict(name=n, sha256=h) for n, h in self.artifacts],
                    diagnostics=list(self.diagnostics))


@dataclass(frozen=True)
class Check:
    name: str
    verdict: str
    actual: float | None
    limit: float | None
    message: str

    def to_dict(self):
        return dict(name=self.name, verdict=self.verdict, actual=self.actual, limit=self.limit, message=self.message)


def upper(name, actual, limit, message=''):
    return Check(name, 'PASS' if actual <= limit else 'FAIL', float(actual), float(limit), message)


def unknown(name, message):
    return Check(name, 'INCONCLUSIVE', None, None, message)


def verdict(checks):
    if any(c.verdict == 'FAIL' for c in checks):
        return 'FAIL'
    return 'PASS' if checks and all(c.verdict == 'PASS' for c in checks) else 'INCONCLUSIVE'


@dataclass(frozen=True)
class VerificationReport:
    checks: tuple[Check, ...]
    evidence: tuple[str, ...]
    spec_hash: str
    candidate_id: str

    def to_dict(self):
        body = dict(verifierVersion='control-lab-verifier-v1', verdict=verdict(self.checks),
                    checks=[c.to_dict() for c in self.checks], evidence=list(self.evidence),
                    specHash=self.spec_hash, candidateId=self.candidate_id)
        return dict(id=digest(body), **body)


def verify_observation(spec, candidate_id, observation, scenario, candidate_override=None):
    """Target-based metrics on persisted samples, with an explicitly finite-window verdict."""
    rules = dict(spec.criteria)
    candidate = candidate_override or next((c for c in candidates(spec,spec.candidate_budget) if c.id==candidate_id),None)
    if candidate is None or candidate.id!=candidate_id or observation.input_digest != input_digest(spec,candidate,scenario):
        return VerificationReport((unknown('Input association','Observation does not bind this frozen spec, candidate and scenario'),), (observation.id,), spec.hash,candidate_id)
    denominator = characteristic(spec.template_id, dict(candidate.parameters),dict(scenario.parameters))
    stable = hurwitz(denominator)
    saved_denominator = dict(observation.metrics).get('characteristicDenominator')
    matching = isinstance(saved_denominator,list) and len(saved_denominator)==len(denominator) and all(math.isclose(a,b,rel_tol=1e-10,abs_tol=1e-14) for a,b in zip(saved_denominator,denominator))
    checks = [Check('Internal stability', 'PASS' if stable else 'FAIL',
                    1.0 if stable else 0.0, 1.0,
                    'Independent Hurwitz check of full unreduced characteristic: '+str(denominator)),
              Check('Characteristic evidence', 'PASS' if matching and observation.internal_stable==stable else 'INCONCLUSIVE',None,None,
                    'Saved solver characteristic and stability must match the independent model calculation.')]
    data = {s.name: s for s in observation.series}
    horizon = dict(spec.parameters)['horizon']
    minimum_samples = int(dict(spec.parameters)['samples'])
    for name in (('reference',) if spec.template_id=='active-filter' else ('reference','disturbance','controlEffort')):
        curve = data.get(name)
        valid = curve and curve.x_unit=='s' and len(curve.x)>=minimum_samples and curve.x[0]<=horizon/minimum_samples and curve.x[-1]>=horizon*.999
        if valid and spec.template_id!='active-filter':
            valid = max(b-a for a,b in zip(curve.x,curve.x[1:])) <= .010000001
        if not valid:
            checks.append(unknown(f'{name} coverage','Required units, sample count or frozen observation horizon is missing.'))
    if any(c.verdict=='INCONCLUSIVE' for c in checks):
        return VerificationReport(tuple(checks),(observation.id,),spec.hash,candidate_id)
    if spec.template_id == 'active-filter':
        frequency = data.get('frequencyGain')
        tau=dict(candidate.parameters)['r']*dict(candidate.parameters)['c']*dict(scenario.parameters).get('componentScale',1)**2
        f0=1/(2*math.pi*tau)
        if not frequency or frequency.x_unit != 'Hz' or len(frequency.x)<201 or frequency.x[0]>f0/100 or frequency.x[-1]<f0*100:
            checks.append(unknown('Frequency response', 'Complete frequency data in Hz is required.'))
        else:
            gain_db = frequency.y[0]
            dc_gain = 10 ** (gain_db / 20)
            checks.append(upper('Passband gain relative error', abs(dc_gain/rules['passbandGainTarget'] - 1), rules['gainTolerance'],
                                'Low-frequency observed gain; finite frequency window.'))
            checks.append(upper('Passband peaking', max(frequency.y) - gain_db, rules['peakingMax']))
            level = gain_db - 10 * math.log10(2)
            crossing = next((i for i in range(1, len(frequency.x))
                             if frequency.y[i-1] >= level > frequency.y[i]), None)
            if crossing is None:
                checks.append(unknown('Cutoff relative error', '−3 dB crossing is outside the saved frequency window.'))
            else:
                i = crossing
                fraction = (level-frequency.y[i-1])/(frequency.y[i]-frequency.y[i-1])
                cutoff = math.exp(math.log(frequency.x[i-1]) + fraction * math.log(frequency.x[i]/frequency.x[i-1]))
                checks.append(upper('Cutoff relative error', abs(cutoff/rules['cutoffTarget']-1), rules['cutoffTolerance'],
                                    f'Observed −3 dB cutoff {cutoff:.9g} Hz; log-frequency interpolation.'))
    else:
        reference, disturbance = data.get('reference'), data.get('disturbance')
        if reference is None:
            checks.append(unknown('Reference response', 'Reference samples are missing.'))
        else:
            checks.append(upper('Target overshoot', max(0, max(reference.y)-1), rules['overshootMax'], 'Maximum on the frozen ≤0.01 s grid; target is 1, not the run’s own final value.'))
            tolerance = rules['settlingBand']
            errors = [abs(v-1) for v in reference.y]
            # Require an entire final 10% window in band, not a single last point.
            tail_start = reference.x[-1] * .9
            tail = [e for t, e in zip(reference.x, errors) if t >= tail_start]
            checks.append(upper('Final-window target error', max(tail), rules['steadyErrorMax'],
                                'Observed last 10% of window only; not an asymptotic steady-state claim.'))
            outside = [i for i, e in enumerate(errors) if e > tolerance]
            if outside and outside[-1] >= len(errors)-2:
                checks.append(unknown('Target settling time', 'Response has not demonstrably settled in the finite window.'))
            else:
                settling = reference.x[outside[-1]+1] if outside else reference.x[0]
                if settling > tail_start:
                    checks.append(unknown('Target settling time', 'Insufficient post-settling observation window.'))
                else:
                    checks.append(upper('Target settling time', settling, rules['settlingMax'],
                                        'First entry after the last band violation; remains in target band to window end.'))
            if spec.template_id in ('p-golden', 'pi-golden'):
                expected = [(0.5*(1-math.exp(-2*t)) if spec.template_id == 'p-golden' else 1-math.exp(-t)) for t in reference.x]
                checks.append(upper('Independent analytic golden', max(abs(a-b) for a,b in zip(reference.y,expected)), 1e-7))
        effort = data.get('controlEffort')
        checks.append(upper('Peak absolute control effort', max(abs(y) for y in effort.y),rules['controlEffortMax']) if effort else unknown('Control effort','Control effort samples missing'))
        if disturbance is None:
            checks.append(unknown('Plant-input disturbance rejection', 'Disturbance samples are missing.'))
        else:
            tail = [abs(y) for t,y in zip(disturbance.x,disturbance.y) if t >= .9*disturbance.x[-1]]
            checks.append(upper('Plant-input disturbance final residual', max(tail), rules['disturbanceMax'],
                                'Unit step injected at plant input at t=0; finite final-window residual.'))
    return VerificationReport(tuple(checks), (observation.id,), spec.hash, candidate_id)


def aggregate(spec, candidate_id, trials, phase, operation_id=None, candidate_override=None):
    expected = [s for s in spec.scenarios if s.role == phase]
    checks, evidence = [], []
    for scenario in expected:
        matching = [t for t in trials if t['candidateId'] == candidate_id and t['scenarioId'] == scenario.id and t['phase'] == phase and (operation_id is None or t.get('operationId')==operation_id)]
        current = matching[-1] if matching else None
        if not current or current['status'] != 'completed' or not current.get('observation'):
            reason = current.get('error') if current else 'Scenario was not executed'
            checks.append(unknown(scenario.label, reason or 'No completed observation'))
            continue
        observed = Observation.parse(current['observation'])
        report = verify_observation(spec, candidate_id, observed, scenario, candidate_override)
        evidence.extend(report.evidence)
        checks.extend(Check(f'{scenario.label} / {c.name}', c.verdict, c.actual, c.limit, c.message) for c in report.checks)
    return VerificationReport(tuple(checks), tuple(evidence), spec.hash, candidate_id)


def multiply(a,b):
    result=[0.0]*(len(a)+len(b)-1)
    for i,x in enumerate(a):
        for j,y in enumerate(b): result[i+j]+=x*y
    return result


def characteristic(model,parameters,scenario):
    if model=='active-filter':
        tau=parameters['r']*parameters['c']*scenario.get('componentScale',1)**2
        return [tau*tau,(3-parameters['gain'])*tau,1.0]
    if model=='p-golden': return [1.0,2.0]
    if model=='pi-golden': return [1.0,2.0,1.0]
    kp,ki,kd,n=(parameters[k] for k in ('kp','ki','kd','n'))
    if ki and kd: cden,cnum=[1,n,0],[kp+kd*n,kp*n+ki,ki*n]
    elif ki: cden,cnum=[1,0],[kp,ki]
    elif kd: cden,cnum=[1,n],[kp+kd*n,kp*n]
    else: cden,cnum=[1],[kp]
    result=multiply([1,2*scenario.get('damping',1),1],cden)
    offset=len(result)-len(cnum)
    for i,value in enumerate(cnum): result[offset+i]+=scenario.get('gain',1)*value
    return result


def hurwitz(coefficients):
    """Strict stability for the supported degrees 1..4; equality is not stable."""
    a=[x/coefficients[0] for x in coefficients]
    if any(x<=0 for x in a): return False
    if len(a)<=3: return True
    if len(a)==4: return a[1]*a[2]>a[3]
    if len(a)==5: return a[1]*a[2]>a[3] and a[1]*a[2]*a[3]>a[3]*a[3]+a[1]*a[1]*a[4]
    return False
