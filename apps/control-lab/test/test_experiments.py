import pathlib
import sys
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'backend'))
from control_lab.experiments import ExperimentSpec, Invalid, candidates


class ExperimentsTest(unittest.TestCase):
    def test_frozen_inputs(self):
        for change in ({'candidateBudget':31},{'candidateBudget':True},{'parameters':{'kp':float('nan')}},
                       {'parameters':{'samples':101,'horizon':60}}, {'parameters':{'unknown':1}},
                       {'candidateBudget':30,'parameters':{'samples':5001}}):
            with self.subTest(change=change),self.assertRaises(Invalid):
                ExperimentSpec.parse(dict(templateId='robust-pid',**change))
        spec=ExperimentSpec.parse({'templateId':'robust-pid','candidateBudget':30})
        self.assertEqual(len(candidates(spec,30)),30)
        self.assertEqual(candidates(spec,30),candidates(spec,30))
        saved=spec.to_dict()
        restored=ExperimentSpec.restore(saved)
        self.assertEqual(spec.hash,restored.hash)
        saved['scenarios'][0]['parameters']['gain']=1.2345
        self.assertEqual(dict(ExperimentSpec.restore(saved).scenarios[0].parameters)['gain'],1.2345)
        self.assertNotEqual(ExperimentSpec.restore(saved).hash,spec.hash)
        self.assertNotEqual(spec.hash,ExperimentSpec.parse({'templateId':'robust-pid','candidateBudget':29}).hash)


if __name__=='__main__':unittest.main()
