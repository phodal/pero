import pathlib
import sys
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'backend'))
from control_lab.experiments import ExperimentSpec, Invalid, TEMPLATES, admit_attempts, candidates


class ExperimentsTest(unittest.TestCase):
    def test_frozen_inputs(self):
        for change in ({'candidateBudget':31},{'candidateBudget':True},{'parameters':{'kp':float('nan')}},
                       {'parameters':{'samples':101,'horizon':60}}, {'parameters':{'unknown':1}},
                       {'candidateBudget':30,'parameters':{'samples':5001}},
                       {'candidateBudget':30,'parameters':{'horizon':6,'samples':601}},
                       {'candidateBudget':30,'parameters':{'horizon':2,'samples':201}}):
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
        cancellation=ExperimentSpec.parse({'templateId':'robust-pid','candidateBudget':15,'parameters':{'horizon':5,'samples':501}})
        self.assertEqual(len(candidates(cancellation,15)),15)
        self.assertEqual(sum(s.role=='search' for s in cancellation.scenarios),5)
        self.assertEqual(sum(s.role=='verification' for s in cancellation.scenarios),2)
        admit_attempts(cancellation,0,77)
        self.assertEqual(dict(cancellation.parameters)['horizon']/(dict(cancellation.parameters)['samples']-1),.01)
        for item in TEMPLATES:
            self.assertGreaterEqual(item.default_candidate_budget,1)
            self.assertLessEqual(item.default_candidate_budget,item.candidate_budget_max)
            self.assertEqual(ExperimentSpec.parse({'templateId':item.id}).candidate_budget,item.default_candidate_budget)
        for item in TEMPLATES:
            parameters = {'horizon':2,'samples':201} if item.engine == 'python-control' else {'samples':101}
            maximum = 15 if item.id == 'robust-pid' else 30
            self.assertEqual(item.candidate_budget_max,maximum)
            for budget in range(1,31):
                with self.subTest(template=item.id,budget=budget):
                    request = {'templateId':item.id,'candidateBudget':budget,'parameters':parameters}
                    if budget <= maximum:
                        self.assertEqual(ExperimentSpec.parse(request).candidate_budget,budget)
                    else:
                        with self.assertRaisesRegex(Invalid,'80 attempts'):
                            ExperimentSpec.parse(request)
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
