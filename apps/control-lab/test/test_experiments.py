import pathlib
import sys
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'backend'))
from control_lab.experiments import ExperimentSpec, Invalid, admit_attempts, candidates


class ExperimentsTest(unittest.TestCase):
    def test_frozen_inputs(self):
        for change in ({'candidateBudget':31},{'candidateBudget':True},{'parameters':{'kp':float('nan')}},
                       {'parameters':{'samples':101,'horizon':60}}, {'parameters':{'unknown':1}},
                       {'candidateBudget':30,'parameters':{'samples':5001}}):
            with self.subTest(change=change),self.assertRaises(Invalid):
                ExperimentSpec.parse(dict(templateId='robust-pid',**change))
        spec=ExperimentSpec.parse({'templateId':'robust-pid','candidateBudget':12,'parameters':{'horizon':6,'samples':601}})
        self.assertEqual(len(candidates(spec,30)),30)
        admit_attempts(spec,0,64)
        with self.assertRaises(Invalid):admit_attempts(spec,39000,2)
        with self.assertRaises(Invalid):ExperimentSpec.parse({'templateId':'robust-pid','candidateBudget':30})
        with self.assertRaises(Invalid):ExperimentSpec.parse({'templateId':'robust-pid','candidateBudget':8})
        self.assertEqual(tuple(sorted((dict(s.parameters)['gain'], dict(s.parameters)['damping']) for s in spec.scenarios if s.role=='search')),
                         ((.8,1),(1,.8),(1,1),(1,1.2),(1.2,1)))
        self.assertEqual(tuple(s.id for s in spec.scenarios if s.role=='verification'), ('nominal-final','damping-low-final'))
        fresh=ExperimentSpec.parse({'templateId':'robust-pid','candidateBudget':6})
        self.assertEqual(dict(fresh.parameters)['horizon'],10)
        self.assertEqual(dict(fresh.parameters)['samples'],1001)
        self.assertEqual(dict(fresh.criteria)['overshootMax'],.1)
        self.assertEqual(dict(fresh.criteria)['settlingMax'],5)
        self.assertEqual(dict(fresh.criteria)['steadyErrorMax'],.01)
        self.assertEqual(dict(fresh.criteria)['gainMarginMin'],6)
        self.assertNotIn('gainMarginMin', dict(ExperimentSpec.parse({'templateId':'pi-golden'}).criteria))
        self.assertEqual(candidates(spec,30),candidates(spec,30))
        saved=spec.to_dict()
        restored=ExperimentSpec.restore(saved)
        self.assertEqual(spec.hash,restored.hash)
        saved['scenarios'][0]['parameters']['gain']=1.2345
        self.assertEqual(dict(ExperimentSpec.restore(saved).scenarios[0].parameters)['gain'],1.2345)
        self.assertNotEqual(ExperimentSpec.restore(saved).hash,spec.hash)
        self.assertNotEqual(spec.hash,ExperimentSpec.parse({'templateId':'robust-pid','candidateBudget':11,'parameters':{'horizon':6,'samples':601}}).hash)


if __name__=='__main__':unittest.main()
