import pathlib
import sys
import tempfile
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'backend'))
from control_lab.experiments import ExperimentSpec, Invalid
from control_lab.store import ExperimentStore
from test_verification import observed


class StoreTest(unittest.TestCase):
    def test_baseline_and_incremental_search_share_frozen_candidate_budget(self):
        spec=ExperimentSpec.parse({'templateId':'robust-pid','candidateBudget':3,'parameters':{'horizon':6,'samples':601}})
        def execute(_engine,_model,_parameters,scenario,_directory,_cancelled):
            matched=next(s for s in spec.scenarios if dict(s.parameters)==scenario and s.role=='search')
            return observed(spec,matched).to_dict()
        with tempfile.TemporaryDirectory() as root:
            store=ExperimentStore(root,execute)
            initial=store.create({'templateId':'robust-pid','candidateBudget':3,'parameters':{'horizon':6,'samples':601}})
            identity=initial['id']
            store.start(identity,'baseline');store.worker.join(timeout=3)
            self.assertFalse(store.worker.is_alive())
            baseline=store.read(identity)
            self.assertEqual([c['id'] for c in baseline['candidates']],['baseline'])
            search=sum(s.role=='search' for s in spec.scenarios)
            self.assertEqual(len(baseline['trials']),search)
            self.assertTrue(all(t['candidateId']=='baseline' and t['status']=='completed' for t in baseline['trials']))
            store.start(identity,'baseline')
            self.assertEqual(len(store.read(identity)['trials']),search)
            store.propose(identity,{'kp':3});store.worker.join(timeout=3)
            self.assertFalse(store.worker.is_alive())
            record=store.read(identity)
            self.assertEqual(len(record['candidates']),2)
            self.assertEqual(len(record['trials']),search*2)
            store.start(identity,'search-next');store.worker.join(timeout=3)
            self.assertFalse(store.worker.is_alive())
            record=store.read(identity)
            self.assertEqual([c['id'] for c in record['candidates'] if c['id'].startswith('candidate-')],['candidate-01'])
            self.assertEqual(len(record['candidates']),3)
            self.assertEqual(len(record['trials']),search*3)
            with self.assertRaises(Invalid):store.propose(identity,{'kp':4})
            with self.assertRaises(Invalid):store.start(identity,'search-next')
            self.assertEqual(store.read(identity)['specHash'],initial['specHash'])
            reopened=ExperimentStore(root,execute)
            self.assertEqual(len(reopened.read(identity)['candidates']),3)
            with self.assertRaises(Invalid):reopened.propose(identity,{'kp':4})
            reopened.lock_candidate(identity,'baseline')
            for operation in ('baseline','search-next','search'):
                with self.subTest(operation=operation), self.assertRaises(Invalid):reopened.start(identity,operation)
            reopened.close()

    def test_baseline_retry_and_admission_leave_no_candidate_on_rejection(self):
        spec=ExperimentSpec.parse({'templateId':'pi-golden','candidateBudget':1})
        calls=[]
        def execute(_engine,_model,_parameters,scenario,_directory,_cancelled):
            calls.append(scenario)
            if len(calls)==1:raise RuntimeError('temporarily unavailable')
            return observed(spec).to_dict()
        with tempfile.TemporaryDirectory() as root:
            store=ExperimentStore(root,execute)
            identity=store.create({'templateId':'pi-golden','candidateBudget':1})['id']
            store.start(identity,'baseline');store.worker.join(timeout=3)
            self.assertEqual(store.read(identity)['trials'][0]['status'],'failed')
            store.start(identity,'baseline');store.worker.join(timeout=3)
            self.assertEqual([t['status'] for t in store.read(identity)['trials']],['failed','completed'])
            self.assertEqual(len(calls),2)
            store.close()
        for limited in ('attempts','samples'):
            for operation in ('baseline','search-next','search'):
                with self.subTest(limited=limited,operation=operation), tempfile.TemporaryDirectory() as root:
                    store=ExperimentStore(root,execute)
                    request={'templateId':'pi-golden','candidateBudget':1,'parameters':{'horizon':2,'samples':201}}
                    identity=store.create(request)['id']
                    if limited=='attempts':
                        observation=observed(ExperimentSpec.parse(request)).to_dict()
                        store.records[identity]['trials']=[dict(candidateId='other',scenarioId='other',status='completed',observation=observation) for _ in range(80)]
                    else:
                        store.records[identity]['trials']=[dict(candidateId='other',scenarioId='other',status='completed',observation={'series':[{'x':[0]*40000}]})]
                    with self.assertRaises(Invalid):store.start(identity,operation)
                    self.assertEqual(store.read(identity)['candidates'],[])
                    self.assertEqual(ExperimentStore(root).read(identity)['candidates'],[])
                    self.assertIsNone(store.worker)
                    store.close()

    def test_rejected_proposal_does_not_consume_candidate_budget(self):
        for limited in ('attempts','samples'):
            with self.subTest(limited=limited), tempfile.TemporaryDirectory() as root:
                store=ExperimentStore(root)
                request={'templateId':'robust-pid','candidateBudget':2,'parameters':{'horizon':2,'samples':201}}
                identity=store.create(request)['id']
                if limited=='attempts':
                    observation=observed(ExperimentSpec.parse(request)).to_dict()
                    store.records[identity]['trials']=[dict(candidateId='other',scenarioId='other',status='completed',observation=observation) for _ in range(80)]
                else:
                    store.records[identity]['trials']=[dict(candidateId='other',scenarioId='other',status='completed',observation={'series':[{'x':[0]*40000}]})]
                with self.assertRaises(Invalid):store.propose(identity,{'kp':3})
                self.assertEqual(store.read(identity)['candidates'],[])
                self.assertIsNone(store.worker)
                self.assertEqual(ExperimentStore(root).read(identity)['candidates'],[])
                store.close()

    def test_failed_attempts_retain_sample_reservations_after_restart(self):
        for status,observation in (('failed',None),('failed',{'series':[{'x':list(range(101))}]}),
                                   ('cancelled',{'series':[{'x':list(range(101))}]}),
                                   ('running',{'series':[{'x':list(range(101))}]}),
                                   ('completed',{'series':[{'x':[]}]}),
                                   ('completed',{'series':[{'x':list(range(101))}]})):
            with self.subTest(status=status,partial=bool(observation)), tempfile.TemporaryDirectory() as root:
                store=ExperimentStore(root)
                identity=store.create({'templateId':'robust-pid','candidateBudget':2,'parameters':{'horizon':6,'samples':601}})['id']
                record=store.records[identity]
                record['trials']=[dict(candidateId='other',scenarioId='other',status=status,observation=observation) for _ in range(66)]
                store.save(record)
                reopened=ExperimentStore(root)
                for operation in ('baseline','search-next','search'):
                    with self.subTest(operation=operation), self.assertRaises(Invalid):reopened.start(identity,operation)
                with self.assertRaises(Invalid):reopened.propose(identity,{'kp':3})
                self.assertEqual(reopened.read(identity)['candidates'],[])
                self.assertEqual(len(reopened.read(identity)['trials']),66)
                reopened.close();store.close()

    def test_malformed_observation_counts_longest_axis_before_retry(self):
        for status in ('completed','failed'):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as root:
                store=ExperimentStore(root)
                identity=store.create({'templateId':'pi-golden','candidateBudget':1})['id']
                record=store.records[identity]
                record['trials']=[dict(candidateId='other',scenarioId='other',status=status,
                                       observation={'series':[{'x':[0,1],'y':[0]*40000}]})]
                store.save(record)
                reopened=ExperimentStore(root)
                with self.assertRaises(Invalid):reopened.start(identity,'baseline')
                self.assertEqual(reopened.read(identity)['candidates'],[])
                reopened.close();store.close()

    def test_incremental_search_retries_before_adding_and_interoperates_with_batch(self):
        spec=ExperimentSpec.parse({'templateId':'robust-pid','candidateBudget':4,'parameters':{'horizon':6,'samples':601}})
        calls=[]
        def execute(_engine,_model,_parameters,scenario,_directory,_cancelled):
            calls.append(scenario)
            if len(calls)==1:raise RuntimeError('temporarily unavailable')
            matched=next(s for s in spec.scenarios if dict(s.parameters)==scenario and s.role=='search')
            return observed(spec,matched).to_dict()
        with tempfile.TemporaryDirectory() as root:
            store=ExperimentStore(root,execute)
            identity=store.create({'templateId':'robust-pid','candidateBudget':4,'parameters':{'horizon':6,'samples':601}})['id']
            search=sum(s.role=='search' for s in spec.scenarios)
            store.start(identity,'search-next');store.worker.join(timeout=3)
            self.assertEqual(len(store.read(identity)['candidates']),1)
            self.assertEqual([t['status'] for t in store.read(identity)['trials']],['failed']+['completed']*(search-1))
            store.start(identity,'search-next');store.worker.join(timeout=3)
            retried=store.read(identity)
            self.assertEqual([c['id'] for c in retried['candidates']],['baseline'])
            self.assertEqual([t['status'] for t in retried['trials']],['failed']+['completed']*search)
            store.start(identity,'search-next');store.worker.join(timeout=3)
            self.assertEqual([c['id'] for c in store.read(identity)['candidates']],['baseline','candidate-01'])
            store.start(identity,'search');store.worker.join(timeout=3)
            final=store.read(identity)
            self.assertEqual([c['id'] for c in final['candidates']],['baseline','candidate-01','candidate-02','candidate-03'])
            self.assertEqual(len(final['trials']),1+4*search)
            store.start(identity,'search')
            self.assertEqual(len(store.read(identity)['trials']),1+4*search)
            store.close()

    def test_failed_attempt_retry_lock_reopen_export(self):
        calls=[]
        def execute(engine,model,parameters,scenario,directory,cancelled):
            calls.append(scenario)
            if len(calls)==1:raise RuntimeError('temporarily unavailable')
            from control_lab.experiments import ExperimentSpec
            spec=ExperimentSpec.parse({'templateId':'pi-golden','candidateBudget':1})
            result=observed(spec).to_dict()
            return result
        with tempfile.TemporaryDirectory() as root:
            store=ExperimentStore(root,execute)
            record=store.create({'templateId':'pi-golden','candidateBudget':1});identity=record['id']
            with self.assertRaises(Invalid):store.start(identity,'search',2)
            store.start(identity,'search',1);store.worker.join()
            self.assertEqual(store.read(identity)['status'],'failed')
            store.start(identity,'search',1);store.worker.join()
            record=store.read(identity)
            self.assertEqual([t['status'] for t in record['trials']],['failed','completed'])
            self.assertEqual(record['candidates'][0]['verdict'],'PASS')
            store.lock_candidate(identity,'baseline')
            with self.assertRaises(Invalid):store.start(identity,'search',1)
            store.start(identity,'verify');store.worker.join()
            self.assertEqual(store.read(identity)['report']['verdict'],'PASS')
            evidence=store.read(identity)['report']['evidence']
            self.assertEqual(store.reevaluate(identity)['report']['evidence'],evidence)
            reopened=ExperimentStore(root,execute)
            self.assertEqual(reopened.read(identity)['specHash'],record['specHash'])
            self.assertEqual(reopened.export(identity)['experiment']['report']['evidence'],evidence)


if __name__=='__main__':unittest.main()

class RealProposalTest(unittest.TestCase):
    def test_structured_proposal_then_locked_independent_verification(self):
        import importlib.util
        if not importlib.util.find_spec('control'):self.skipTest('real control dependency unavailable')
        with tempfile.TemporaryDirectory() as root:
            store=ExperimentStore(root)
            record=store.create({'templateId':'robust-pid','candidateBudget':2})
            identity=record['id']
            with self.assertRaises(Invalid):store.propose(identity,{'horizon':24})
            store.propose(identity,{'kp':2.2,'ki':1.1,'kd':.4});store.worker.join()
            record=store.read(identity)
            search=sum(item['role']=='search' for item in record['scenarios'])
            final_count=sum(item['role']=='verification' for item in record['scenarios'])
            self.assertEqual(len(record['candidates']),2)
            proposed=record['candidates'][1]
            self.assertTrue(proposed['id'].startswith('proposal-'))
            self.assertEqual(len(record['trials']),search)
            self.assertTrue(all(t['status']=='completed' for t in record['trials']))
            self.assertTrue(all(t['report']['verdict']!='INCONCLUSIVE' for t in record['trials']))
            with self.assertRaises(Invalid):store.propose(identity,{'kp':3})
            store.lock_candidate(identity,proposed['id'])
            with self.assertRaises(Invalid):store.propose(identity,{'kp':2.2})
            store.start(identity,'verify');store.worker.join()
            report=store.read(identity)['report']
            self.assertEqual(len(report['evidence']),final_count)
            self.assertEqual(store.reevaluate(identity)['report']['id'],report['id'])
            export=store.export(identity)
            self.assertTrue(export['artifacts'])
            self.assertTrue(all('text' in item for item in export['artifacts']))
            self.assertIn('dependencyVersions',store.read(identity)['trials'][0]['observation']['metrics'])
