import copy
import math
import pathlib
import sys
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'backend'))
from control_lab.experiments import ExperimentSpec, candidates, input_digest
from control_lab.verification import Observation, aggregate, characteristic, hurwitz, verify_observation


def observed(spec, scenario=None, mutate=None):
    scenario=scenario or spec.scenarios[0]
    candidate=candidates(spec,1)[0]
    p=dict(spec.parameters)
    x=[i*p['horizon']/(int(p['samples'])-1) for i in range(int(p['samples']))]
    result=dict(engineVersion='test-oracle',internalStable=True,metrics={'characteristicDenominator':characteristic(spec.template_id,p,dict(scenario.parameters))},diagnostics=[],series=[
        dict(name='reference',unit='1',xUnit='s',x=x,y=[1-math.exp(-t) for t in x]),
        dict(name='disturbance',unit='1',xUnit='s',x=x,y=[t*math.exp(-t) for t in x]),
        dict(name='controlEffort',unit='1',xUnit='s',x=x,y=[1.0 for _ in x]),
    ])
    if mutate:mutate(result)
    return Observation.from_solver(result,'python-control',[],input_digest(spec,candidate,scenario))


class VerificationTest(unittest.TestCase):
    def test_saved_observations_independent_and_bound(self):
        spec=ExperimentSpec.parse({'templateId':'pi-golden'})
        obs=observed(spec)
        self.assertEqual(verify_observation(spec,'baseline',Observation.parse(obs.to_dict()),spec.scenarios[0]).to_dict()['verdict'],'PASS')
        other=spec.scenarios[1]
        self.assertEqual(verify_observation(spec,'baseline',obs,other).to_dict()['verdict'],'INCONCLUSIVE')
        for mutation in (
            lambda r:r['series'].pop(),
            lambda r:r['series'][0].update(x=[0,12],y=[0,1]),
            lambda r:r['series'][0].update(xUnit='Hz'),
            lambda r:r['metrics'].update(characteristicDenominator=[1,1]),
        ):
            with self.subTest(mutation=mutation):
                self.assertEqual(verify_observation(spec,'baseline',observed(spec,mutate=mutation),spec.scenarios[0]).to_dict()['verdict'],'INCONCLUSIVE')
        changed=obs.to_dict();changed['series'][0]['y'][-1]=.5
        with self.assertRaises(ValueError):Observation.parse(changed)

    def test_golden_p_does_not_settle_to_own_final(self):
        spec=ExperimentSpec.parse({'templateId':'p-golden'})
        def p_response(r):
            r['series'][0]['y']=[.5*(1-math.exp(-2*t)) for t in r['series'][0]['x']]
        report=verify_observation(spec,'baseline',observed(spec,mutate=p_response),spec.scenarios[0]).to_dict()
        self.assertEqual(report['verdict'],'FAIL')
        self.assertEqual(next(c for c in report['checks'] if c['name']=='Independent analytic golden')['verdict'],'PASS')
        self.assertEqual(next(c for c in report['checks'] if c['name']=='Target settling time')['verdict'],'INCONCLUSIVE')

    def test_full_denominator_and_final_batch(self):
        for coeff,stable in (([1,2],True),([1,0],False),([1,2,1],True),([1,2,3,4],True),([1,1,1,2],False),([1,14,30.6,37,12],True)):
            self.assertEqual(hurwitz(coeff),stable)
        spec=ExperimentSpec.parse({'templateId':'pi-golden'})
        scenario=spec.scenarios[1]
        trial=dict(candidateId='baseline',scenarioId=scenario.id,phase='verification',status='completed',operationId='old',observation=observed(spec,scenario).to_dict())
        self.assertEqual(aggregate(spec,'baseline',[trial],'verification','old').to_dict()['verdict'],'PASS')
        self.assertEqual(aggregate(spec,'baseline',[trial],'verification','new').to_dict()['verdict'],'INCONCLUSIVE')

    def test_classical_margins_follow_frozen_limits(self):
        spec=ExperimentSpec.parse({'templateId':'robust-pid','candidateBudget':1,'parameters':{'horizon':6,'samples':601}})
        scenario=spec.scenarios[0]
        cases=(
            (dict(gainMarginDb=8, phaseMarginDeg=40), 'PASS', 'PASS'),
            (dict(gainMarginDb=1, phaseMarginDeg=40), 'FAIL', 'FAIL'),
            (dict(gainMarginUnbounded=1, phaseMarginUnbounded=1), 'PASS', 'PASS'),
            ({}, 'INCONCLUSIVE', 'INCONCLUSIVE'),
        )
        for extra, overall, margin in cases:
            with self.subTest(extra=extra):
                def mutate(result, extra=extra):
                    result['metrics'].update(extra)
                report=verify_observation(spec,'baseline',observed(spec,scenario,mutate=mutate),scenario).to_dict()
                self.assertEqual(report['verdict'], overall)
                self.assertEqual(next(c for c in report['checks'] if c['name']=='Gain margin')['verdict'], margin)
        golden=verify_observation(ExperimentSpec.parse({'templateId':'pi-golden'}),'baseline',observed(ExperimentSpec.parse({'templateId':'pi-golden'})),ExperimentSpec.parse({'templateId':'pi-golden'}).scenarios[0]).to_dict()
        self.assertNotIn('Gain margin', [c['name'] for c in golden['checks']])


if __name__=='__main__':unittest.main()
