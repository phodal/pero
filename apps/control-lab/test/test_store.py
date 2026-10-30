import pathlib
import sys
import tempfile
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'backend'))
from control_lab.experiments import Invalid
from control_lab.store import ExperimentStore
from test_verification import observed


class StoreTest(unittest.TestCase):
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
            self.assertEqual(len(record['candidates']),2)
            proposed=record['candidates'][1]
            self.assertTrue(proposed['id'].startswith('proposal-'))
            self.assertEqual(len(record['trials']),2)
            self.assertTrue(all(t['status']=='completed' for t in record['trials']))
            self.assertTrue(all(t['report']['verdict']!='INCONCLUSIVE' for t in record['trials']))
            with self.assertRaises(Invalid):store.propose(identity,{'kp':3})
            store.lock_candidate(identity,proposed['id'])
            with self.assertRaises(Invalid):store.propose(identity,{'kp':2.2})
            store.start(identity,'verify');store.worker.join()
            report=store.read(identity)['report']
            self.assertEqual(len(report['evidence']),4)
            self.assertEqual(store.reevaluate(identity)['report']['id'],report['id'])
            export=store.export(identity)
            self.assertTrue(export['artifacts'])
            self.assertTrue(all('text' in item for item in export['artifacts']))
            self.assertIn('dependencyVersions',store.read(identity)['trials'][0]['observation']['metrics'])
