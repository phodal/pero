"""Local evidence coordination. Host owns process/session/approval; this owns lab runs."""
import asyncio
import base64
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys
import threading
import uuid

from domain import parse_criteria, parse_experiment, parse_protocol, parse_state, validate_protocol, transition_trial
from observations import import_measurements

LIMITATIONS = ['Simulation only: no physical execution authorization.',
               'Virtual dye fractions are an illustrative volume-weighted model, not optical or biological measurements.',
               'PyLabRobot checks resources and dispatches Chatterbox commands; no collision or fluid-physics guarantee.']

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()

def digest(value): return hashlib.sha256(canonical(value)).hexdigest()
def now(): return datetime.now(timezone.utc).isoformat()

def capability():
    result = {'name':'PyLabRobot Chatterbox','version':None,'available':False,'error':None,'python':sys.version.split()[0],'mode':'simulation'}
    try:
        result['version'] = importlib.metadata.version('pylabrobot')
        if sys.version_info[:2] != (3,12): raise RuntimeError('Lab requires Host-managed CPython 3.12')
        if result['version'] != '0.2.2': raise RuntimeError('Lab requires pylabrobot==0.2.2')
        from pylabrobot.liquid_handling import LiquidHandler
        from pylabrobot.liquid_handling.backends import LiquidHandlerChatterboxBackend
        result['available'] = True
    except (ImportError,RuntimeError,importlib.metadata.PackageNotFoundError) as error:
        result['error'] = f'{error}. Prepare the pinned App environment and reopen Lab.'
    return result

class ExperimentStore:
    def __init__(self, directory):
        self.root = Path(directory); self.root.mkdir(parents=True,exist_ok=True)
        self.lock = threading.RLock(); self.cancelled = threading.Event(); self.worker = None
        self.records = {}
        for path in self.root.glob('*.json'):
            record = json.loads(path.read_text())
            for trial in record['trials']:
                if trial['status']=='running':
                    trial['status']=transition_trial(trial['status'],'unknown'); trial['error']='App stopped during execution; preserved evidence is not replayed.'
                    for event in trial['events']:
                        if event['status']=='running': event['status']='unknown'
            self.records[record['id']] = record
            self.save(record)

    def save(self, record):
        path = self.root / (record['id']+'.json'); temporary = path.with_suffix('.tmp')
        temporary.write_bytes(canonical(record)); temporary.replace(path)

    def get(self, identity):
        if not isinstance(identity,str) or identity not in self.records: raise ValueError('Experiment not found')
        return self.records[identity]

    def read(self, identity):
        with self.lock: return deepcopy(self.get(identity))

    def listing(self):
        with self.lock: return {'experiments':deepcopy(list(self.records.values())), 'engine':capability()}

    def create(self, data):
        with self.lock:
            experiment = parse_experiment(data,uuid.uuid4().hex)
            record = experiment.to_dict()
            record.update(spec_hash=digest(record),created_at=now(),trials=[],decisions=[],limitations=LIMITATIONS)
            self.records[record['id']]=record; self.save(record)
            return deepcopy(record)

    def trial(self, record, identity):
        for trial in record['trials']:
            if trial['id']==identity: return trial
        raise ValueError('Trial not found')

    def propose(self, identity, raw, parent=None, reason='Initial candidate'):
        with self.lock:
            record = self.get(identity)
            from domain import ProposalContext, TrialReference, validate_proposal
            protocol = parse_protocol(raw)
            context = ProposalContext(record['max_trials'], record['max_steps'], record['initial_state']['revision'],
                                      tuple(TrialReference(t['id'], t['verification'] is not None) for t in record['trials']))
            reason = validate_proposal(context, protocol, parent, reason)
            trial = {'id':uuid.uuid4().hex,'parent_trial_id':parent,'reason':reason,'protocol':protocol.to_dict(),
                     'protocol_hash':digest(protocol.to_dict()),'state_hash':digest(record['initial_state']),
                     'status':'proposed','events':[],'initial_state':deepcopy(record['initial_state']),
                     'final_state':deepcopy(record['initial_state']),'engine':None,'error':None,
                     'observations':[],'verification':None,'created_at':now(),'attempt_id':None}
            record['trials'].append(trial); self.save(record); return deepcopy(record)

    def validate(self, identity, trial_id):
        with self.lock:
            record=self.get(identity); trial=self.trial(record,trial_id)
            if trial['status'] not in ('proposed','validated'): raise ValueError('Only an unexecuted candidate can be validated')
            validate_protocol(parse_state(trial['initial_state']),parse_protocol(trial['protocol']),record['max_steps'])
            trial['status']=transition_trial(trial['status'],'validated') if trial['status']!='validated' else 'validated'; trial['error']=None; self.save(record); return deepcopy(record)

    def start(self, identity, trial_id):
        with self.lock:
            if self.worker and self.worker.is_alive(): raise ValueError('Another simulation is running; wait or cancel it')
            record=self.get(identity); trial=self.trial(record,trial_id)
            if trial['status']!='validated': raise ValueError('Validate this unexecuted candidate before simulation')
            engine=capability()
            if not engine['available']: raise ValueError(engine['error'])
            trial.update(status=transition_trial(trial['status'],'running'),engine=engine,attempt_id=uuid.uuid4().hex)
            self.cancelled.clear(); self.save(record)
            self.worker=threading.Thread(target=lambda:asyncio.run(self.run(identity,trial_id)),daemon=True)
            self.worker.start(); return deepcopy(record)

    async def run(self, identity, trial_id):
        from pylabrobot_adapter import ChatterboxAdapter
        adapter=ChatterboxAdapter()
        record=self.get(identity); trial=self.trial(record,trial_id)
        protocol=parse_protocol(trial['protocol']); state=parse_state(trial['initial_state'])
        posts=validate_protocol(state,protocol,record['max_steps'])
        event=None
        try:
            await adapter.setup(state)
            for index,(operation,after) in enumerate(zip(protocol.steps,posts)):
                with self.lock:
                    if self.cancelled.is_set():
                        trial['status']=transition_trial(trial['status'],'cancelled'); break
                    event={'index':index,'operation':operation.to_dict(),'status':'running','before':state.to_dict(),
                           'after':None,'backend':None,'started_at':now(),'completed_at':None,'error':None}
                    trial['events'].append(event); self.save(record)
                actual=await adapter.execute(operation)
                with self.lock:
                    event['backend']=actual; self.save(record)
                expected=after.to_dict()
                if any(abs(actual['well_volumes_ul'][well.id]-well.volume_ul)>1e-7 for well in after.wells) or abs(actual['pipette_volume_ul']-after.pipette.volume_ul)>1e-7 or actual['mounted_tip_id']!=after.pipette.tip_id:
                    raise RuntimeError('PyLabRobot tracker/state mismatch; outcome unknown, no automatic replay')
                with self.lock:
                    event.update(status='completed',after=expected,backend=actual,completed_at=now())
                    state=after; trial['final_state']=expected; self.save(record)
            else:
                with self.lock: trial['status']=transition_trial(trial['status'],'completed')
        except asyncio.CancelledError:
            with self.lock:
                trial['status']=transition_trial(trial['status'],'unknown')
                trial['error']='Execution interrupted within a backend command; no automatic replay'
                if event and event['status']=='running': event.update(status='unknown',error=trial['error'],completed_at=now())
            raise
        except Exception as error:
            with self.lock:
                trial['status']=transition_trial(trial['status'],'unknown' if event and event['status']=='running' else 'failed')
                trial['error']=str(error)
                if event and event['status']=='running': event.update(status='unknown',error=str(error),completed_at=now())
        finally:
            try: await adapter.stop()
            except Exception as error:
                with self.lock: trial['error']=(trial['error'] or '')+f' Backend shutdown: {error}'
            with self.lock: self.save(record)

    def cancel(self, identity, trial_id):
        with self.lock:
            record=self.get(identity); trial=self.trial(record,trial_id)
            if trial['status']!='running': raise ValueError('Only a running trial can be cancelled')
            self.cancelled.set(); return deepcopy(record)

    def attach(self, identity, trial_id, raw, observation):
        record=self.get(identity); trial=self.trial(record,trial_id)
        if trial['status']!='completed': raise ValueError('Observations require a completed trial')
        if trial['verification']: raise ValueError('Verified evidence is frozen; create a linked revision')
        if trial['observations']: raise ValueError('Trial observation is immutable; create a linked revision')
        sha=hashlib.sha256(raw).hexdigest(); assets=self.root/'assets'; assets.mkdir(exist_ok=True)
        asset=assets/sha
        if not asset.exists(): asset.write_bytes(raw)
        observation.update(id=sha,sha256=sha,asset_ref='assets/'+sha,attached_at=now())
        trial['observations'].append(observation); self.save(record); return deepcopy(record)

    def observe(self, identity, trial_id):
        with self.lock:
            trial=self.trial(self.get(identity),trial_id)
            well=next(w for w in trial['final_state']['wells'] if w['id']=='B1')
            rows=[{'well':'B1','value':min(1.,well['red_fraction']+.1),'unit':'fraction'}]
            raw=canonical(rows)
            return self.attach(identity,trial_id,raw,{'origin':'synthetic','source':'Illustrative deterministic +0.1 fraction fixture v1; not a device measurement','filename':'synthetic-v1.json','measurements':rows})

    def import_observation(self, identity, data):
        raw,observation=import_measurements(data)
        with self.lock: return self.attach(identity,data['trialId'],raw,observation)

    def evaluate(self, identity, trial_id):
        # Typed evaluation conversion is kept at this I/O boundary.
        from evaluation import evaluate, parse_observation
        with self.lock:
            record=self.get(identity); trial=self.trial(record,trial_id)
            if trial['verification'] is not None: return deepcopy(record)
            if trial['status'] in ('proposed','validated','running'): raise ValueError('Finish execution before evaluation')
            observation=trial['observations'][0] if trial['observations'] else None
            typed=parse_observation({key:observation[key] for key in ('origin','source','measurements')}) if observation else None
            trial['verification']=evaluate(parse_criteria(record['criteria']),typed,parse_state(trial['final_state']),trial['status']).to_dict()
            trial['verification']['evidence']=[trial['protocol_hash'],trial['state_hash']]+([observation['sha256']] if observation else [])
            self.save(record); return deepcopy(record)

    def compare(self, identity):
        with self.lock:
            rows=[]
            for trial in self.get(identity)['trials']:
                report=trial['verification'] or {}
                rows.append({'trial_id':trial['id'],'parent_trial_id':trial['parent_trial_id'],'absolute_error':report.get('absolute_error'),'verdict':report.get('verdict','INCONCLUSIVE')})
            improvement=None
            if rows:
                last=rows[-1]; parent=next((row for row in rows if row['trial_id']==last['parent_trial_id']),None)
                if parent and parent['absolute_error'] is not None and last['absolute_error'] is not None:
                    improvement=parent['absolute_error']-last['absolute_error']
            return {'trials':rows,'improvement':improvement,'message':'Insufficient comparable observations' if improvement is None else ('Improved' if improvement>0 else 'No improvement')}

    def review(self, identity, data):
        if set(data)!={'trialId','decision','rationale'} or data['decision'] not in ('accepted','rejected') or not isinstance(data['rationale'],str) or not 1<=len(data['rationale'].strip())<=2000:
            raise ValueError('Review requires accepted/rejected and a rationale')
        with self.lock:
            record=self.get(identity); trial=self.trial(record,data['trialId'])
            if not trial['verification']: raise ValueError('Evaluate before human review')
            record['decisions'].append({'trial_id':trial['id'],'decision':data['decision'],'rationale':data['rationale'],'reviewed_at':now(),'actor':'user-interface','human_identity_verified':False})
            self.save(record); return deepcopy(record)

    def export(self, identity):
        record=self.read(identity)
        return {'schema_version':1,'method':'color-mixing-illustrative-v1',
                'research_context':{'paper':'arXiv:2610.32755v1',
                    'source':'https://www.gstatic.com/science-ai/verid_semantic_lab.pdf',
                    'comparison_document':'docs/design-docs/lab-google-reproduction.md',
                    'scope':'Illustrative software workflow; not reproduction of VERID wet-lab results. Separate benchmarks reproduce published scoring equations and constructed stateful resource checks.'},
                'experiment':record,'comparison':self.compare(identity),
                'assets':{o['sha256']:base64.b64encode((self.root/o['asset_ref']).read_bytes()).decode() for t in record['trials'] for o in t['observations']}}

    def close(self):
        self.cancelled.set()
        if self.worker: self.worker.join(timeout=5)
