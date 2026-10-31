"""Local immutable-input ledger and one bounded calculation thread; no Agent runtime."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import threading
import uuid
import platform

from .experiments import Attempt, Candidate, ExperimentSpec, Invalid, Trial, admit_attempts, candidates, canonical, input_digest, proposal, sample_reservation, template
from .verification import Observation, aggregate, verify_observation
from . import engines


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


class ExperimentStore:
    def __init__(self, root, execute=None):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.execute = execute or engines.execute
        self.lock = threading.RLock()
        self.cancelled = threading.Event()
        self.worker = None
        self.active_id = None
        self.records = {}
        self.provenance = dict(pythonVersion=platform.python_version(),sourceHashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob('*.py')})
        for path in sorted(self.root.glob('*.json')):
            record = json.loads(path.read_text())
            spec = self.spec(record)
            if spec.hash != record['specHash']:
                raise Invalid(f'Experiment integrity check failed: {path.name}')
            self.records[record['id']] = record
            if record['status'] == 'running':
                record.update(status='failed', operation=None, error='Backend stopped before this operation completed. Saved observations remain available.')
                for trial in record['trials']:
                    if trial['status'] == 'running':
                        trial.update(status='failed', error='Backend stopped during solver execution')
                self.save(record)

    def spec(self, record):
        return ExperimentSpec.restore(record)

    def save(self, record):
        destination = self.root / (record['id'] + '.json')
        temporary = destination.with_suffix('.tmp')
        temporary.write_bytes(canonical(record))
        temporary.replace(destination)

    def get_record(self, identity):
        if identity not in self.records:
            raise Invalid('Experiment not found')
        return self.records[identity]

    def read(self, identity):
        with self.lock:
            return deepcopy(self.get_record(identity))

    def listing(self):
        with self.lock:
            keys = ('id','title','templateId','createdAt','status','report','lockedCandidateId','specHash')
            return {'experiments': [{k:r[k] for k in keys} for r in sorted(self.records.values(),key=lambda r:(r['createdAt'],r['id']),reverse=True)]}

    def create(self, data):
        spec = ExperimentSpec.parse(data)
        item = template(spec.template_id)
        record = dict(id=uuid.uuid4().hex, title=item.title, createdAt=now(), specHash=spec.hash,
                      **spec.to_dict(), status='idle', operation=None, progress=dict(completed=0,total=0),
                      error=None, candidates=[], lockedCandidateId=None, trials=[], report=None,
                      reports=[], candidateLock=None, provenance=deepcopy(self.provenance),
                      limitations=['Numerical verification is not scientific or physical-device acceptance.',
                                   'Finite observation windows do not establish asymptotic steady state.',
                                   'No arbitrary Python, netlist, remote execution, or automatic model calls.'])
        if spec.template_id == 'active-filter':
            record['limitations'].append('Idealized Sallen–Key amplifier: no supply rails, bandwidth, component noise, or real-device guarantee.')
        with self.lock:
            self.records[record['id']] = record
            self.save(record)
            return deepcopy(record)

    def lock_candidate(self, identity, candidate_id):
        with self.lock:
            record = self.get_record(identity)
            if record['status'] == 'running':
                raise Invalid('Wait for the active operation before locking a candidate')
            selected = next((c for c in record['candidates'] if c['id']==candidate_id), None)
            if not selected:
                raise Invalid('Candidate not found')
            if record['lockedCandidateId'] and record['lockedCandidateId'] != candidate_id:
                raise Invalid('Final candidate is frozen; create a new experiment to choose another')
            record['lockedCandidateId'] = candidate_id
            record['candidateLock'] = dict(candidateId=candidate_id, parameters=deepcopy(selected['parameters']),
                                           specHash=record['specHash'])
            self.save(record)
            return deepcopy(record)

    def propose(self, identity, parameters):
        with self.lock:
            record=self.get_record(identity)
            if record['status']=='running' or record['lockedCandidateId']:
                raise Invalid('Candidate proposals require an idle, unlocked experiment')
            spec=self.spec(record)
            candidate=proposal(spec,parameters)
            return self.start(identity,'evaluate',candidate_id=candidate.id,proposed_candidate=candidate)

    def start(self, identity, operation, budget=None, candidate_id=None, proposed_candidate=None):
        with self.lock:
            record = self.get_record(identity)
            if self.worker and self.worker.is_alive():
                raise Invalid('A calculation is already running; wait or cancel it first')
            spec = self.spec(record)
            added = []
            if operation in ('search', 'baseline', 'search-next'):
                if record['lockedCandidateId']:
                    raise Invalid('Candidate is locked; search requires a new experiment')
                if budget is not None and budget != spec.candidate_budget:
                    raise Invalid('Search budget is frozen in the experiment; create a new experiment to change it')
                proposed = candidates(spec, spec.candidate_budget)
                existing = {c['id'] for c in record['candidates']}
                phase = 'search'
                if operation == 'baseline':
                    baseline = next((c for c in record['candidates'] if c['id'] == 'baseline'), None)
                    if baseline is None:
                        if len(existing) >= spec.candidate_budget:
                            raise Invalid('Frozen candidate budget is exhausted')
                        baseline = proposed[0].to_dict()
                        added = [baseline]
                    chosen = [baseline]
                elif operation == 'search-next':
                    # Complete or retry one existing candidate before consuming a
                    # new slot. The frozen search scenarios remain authoritative.
                    search_scenarios = [s for s in spec.scenarios if s.role == 'search']
                    chosen = [c for c in record['candidates'] if any(
                        not any(t['candidateId'] == c['id'] and t['scenarioId'] == s.id
                                and t['status'] == 'completed' for t in record['trials'])
                        for s in search_scenarios)][:1]
                    if not chosen and len(existing) < spec.candidate_budget:
                        next_candidate = next((c for c in proposed if c.id not in existing), None)
                        if next_candidate:
                            added = [next_candidate.to_dict()]
                            chosen = list(added)
                    if not chosen:
                        raise Invalid('No remaining bounded search candidates')
                else:
                    added = [c.to_dict() for c in proposed if c.id not in existing][:spec.candidate_budget-len(existing)]
                    chosen = list(record['candidates']) + added
            elif operation == 'evaluate':
                if record['lockedCandidateId']: raise Invalid('The final candidate is frozen')
                phase='search'
                if proposed_candidate is not None:
                    if not record['candidates']:
                        added.append(candidates(spec,1)[0].to_dict())
                    if not any(c['id']==proposed_candidate.id for c in record['candidates']):
                        if len(record['candidates'])+len(added)>=spec.candidate_budget:
                            raise Invalid('Frozen candidate budget is exhausted')
                        added.append(proposed_candidate.to_dict())
                chosen=[c for c in record['candidates']+added if c['id']==candidate_id]
                if not chosen: raise Invalid('Candidate not found')
            elif operation == 'verify':
                if not record['lockedCandidateId']:
                    raise Invalid('Lock a candidate before final verification')
                phase = 'verification'
                chosen = [c for c in record['candidates'] if c['id'] == record['lockedCandidateId']]
            else:
                raise Invalid('Unknown calculation operation')
            jobs = []
            for candidate in chosen:
                for scenario in spec.scenarios:
                    if scenario.role != phase:
                        continue
                    if phase == 'search' and any(t['candidateId']==candidate['id'] and t['scenarioId']==scenario.id and t['status']=='completed' for t in record['trials']):
                        continue
                    jobs.append((deepcopy(candidate), scenario))
            # A failed, cancelled or interrupted attempt may already have
            # consumed its grid. Retain its conservative reservation across
            # retries and restarts when it has no saved observation.
            per_trial_samples=sample_reservation(template(spec.template_id).engine,dict(spec.parameters)['samples'])
            existing_samples=0
            for trial in record['trials']:
                observation=trial.get('observation')
                series=observation.get('series',[]) if isinstance(observation,dict) else []
                series=series if isinstance(series,list) else []
                actual=max((len(curve[axis]) for curve in series if isinstance(curve,dict)
                            for axis in ('x','y') if isinstance(curve.get(axis),list)),default=0)
                valid=False
                if trial['status']=='completed' and actual:
                    try:
                        Observation.parse(observation)
                        valid=True
                    except (Invalid,ValueError,TypeError,KeyError,AttributeError,OverflowError):
                        pass
                existing_samples+=actual if valid else max(actual,per_trial_samples)
            admit_attempts(spec,existing_samples,len(jobs))
            if len(record['trials'])+len(jobs)>80:
                raise Invalid('This ledger has reached its 80-attempt evidence limit; export it and create a new experiment')
            record['candidates'].extend(added)
            if not jobs:
                return deepcopy(record)
            self.cancelled = threading.Event()
            operation_id = uuid.uuid4().hex
            if phase=='verification':
                record['verificationOperationId'] = operation_id
                record['report'] = None
            self.active_id = identity
            record.update(status='running', operation=operation, error=None, progress=dict(completed=0,total=len(jobs)))
            self.save(record)
            self.worker = threading.Thread(target=self.run, args=(identity, spec, phase, jobs, self.cancelled, operation_id), daemon=False)
            self.worker.start()
            return deepcopy(record)

    def run(self, identity, spec, phase, jobs, cancelled, operation_id):
        failed = False
        try:
            for candidate, scenario in jobs:
                if cancelled.is_set():
                    break
                trial_id = uuid.uuid4().hex
                trial = Trial(trial_id, candidate['id'], scenario.id, phase, Attempt(uuid.uuid4().hex,'running',None)).to_dict()
                trial['operationId'] = operation_id
                trial['startedAt'] = now()
                trial['provenance'] = deepcopy(self.provenance)
                directory = self.root / 'artifacts' / identity / trial_id
                directory.mkdir(parents=True, exist_ok=True)
                with self.lock:
                    record = self.get_record(identity)
                    record['trials'].append(trial)
                    self.save(record)
                try:
                    result = self.execute(template(spec.template_id).engine, spec.template_id,
                                          dict(candidate['parameters']), dict(scenario.parameters), directory, cancelled)
                    limit = sample_reservation(template(spec.template_id).engine, dict(spec.parameters)['samples'])
                    if any(len(curve.get('x', [])) > limit or len(curve.get('y', [])) > limit
                           for curve in result.get('series', [])):
                        raise engines.EngineError(f'Solver output exceeds the {limit}-point evidence limit; raw output is retained')
                    artifact_refs = []
                    for path in sorted(directory.iterdir()):
                        if path.is_file():
                            artifact_refs.append(dict(name=path.name, sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
                    frozen_candidate = Candidate(candidate['id'],candidate['label'],tuple(candidate['parameters'].items()))
                    binding = input_digest(spec, frozen_candidate,scenario)
                    observation = Observation.from_solver(result, template(spec.template_id).engine, artifact_refs, binding)
                    trial.update(status='completed', observation=observation.to_dict(),
                                 report=verify_observation(spec, candidate['id'], observation, scenario, frozen_candidate).to_dict())
                except Exception as error:
                    failed = True
                    trial.update(status='cancelled' if cancelled.is_set() else 'failed', error=f'{type(error).__name__}: {error}')
                    trial['failureArtifacts'] = [dict(name=p.name,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
                                                 for p in sorted(directory.iterdir()) if p.is_file()]
                with self.lock:
                    record = self.get_record(identity)
                    trial['completedAt'] = now()
                    record['progress']['completed'] += 1
                    selected = next(c for c in record['candidates'] if c['id']==candidate['id'])
                    if phase == 'search':
                        summary = aggregate(spec, candidate['id'], record['trials'], 'search', candidate_override=Candidate(candidate['id'],candidate['label'],tuple(candidate['parameters'].items()))).to_dict()
                        selected['verdict'] = summary['verdict']
                        # Ranking is derived only from search observations, never final scenarios.
                        objective = 'Cutoff relative error' if spec.template_id == 'active-filter' else 'Target settling time'
                        selected['score'] = max((c['actual'] for c in summary['checks'] if c['name'].endswith(objective)),default=None) if summary['verdict']=='PASS' else None
                    self.save(record)
            with self.lock:
                record = self.get_record(identity)
                if phase == 'verification':
                    report = aggregate(spec, record['lockedCandidateId'], record['trials'], phase, operation_id, Candidate(candidate['id'],candidate['label'],tuple(candidate['parameters'].items()))).to_dict()
                    record['report'] = report
                    record['reports'].append(report)
                record.update(status='cancelled' if cancelled.is_set() else 'failed' if failed else 'completed', operation=None)
                if failed:
                    record['error'] = 'One or more solver attempts failed. Inspect trial errors; execution failure is not a verification PASS.'
                self.save(record)
        except Exception as error:
            with self.lock:
                record = self.get_record(identity)
                record.update(status='failed', operation=None, error=f'{type(error).__name__}: {error}')
                self.save(record)
        finally:
            with self.lock:
                self.active_id = None

    def cancel(self, identity):
        with self.lock:
            record = self.get_record(identity)
            if self.active_id == identity:
                self.cancelled.set()
            return deepcopy(record)

    def reevaluate(self, identity):
        with self.lock:
            record = self.get_record(identity)
            if record['status'] == 'running' or not record['lockedCandidateId']:
                raise Invalid('A completed operation and locked candidate are required')
            report = aggregate(self.spec(record), record['lockedCandidateId'], record['trials'], 'verification', record.get('verificationOperationId'), Candidate(record['candidateLock']['candidateId'],'Locked candidate',tuple(record['candidateLock']['parameters'].items()))).to_dict()
            record['report'] = report
            record['reports'].append(report)
            self.save(record)
            return deepcopy(record)

    def export(self, identity):
        with self.lock:
            record = deepcopy(self.get_record(identity))
            artifacts=[]
            for trial in record['trials']:
                refs=(trial.get('observation') or {}).get('artifacts',trial.get('failureArtifacts',[]))
                for reference in refs:
                    path=self.root/'artifacts'/identity/trial['id']/reference['name']
                    raw=path.read_bytes()
                    if hashlib.sha256(raw).hexdigest()!=reference['sha256']:
                        raise Invalid('A saved artifact failed its integrity check')
                    artifacts.append(dict(trialId=trial['id'],**reference,text=raw.decode('utf-8')))
            result=dict(experiment=record,artifacts=artifacts,exportProvenance=deepcopy(self.provenance))
            if len(canonical(result))>15*1024*1024:
                raise Invalid('Export exceeds the 15 MiB transport limit; local evidence is retained. Use a smaller frozen sample/candidate budget for portable exports.')
            return result

    def close(self):
        self.cancelled.set()
        if self.worker:
            self.worker.join(timeout=35)
            if self.worker.is_alive():
                raise RuntimeError('Calculation has not acknowledged cancellation')
