"""Hermetic scientific contracts; all trajectories here are synthetic fixtures."""
import copy
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.reproduction import (COMMIT, Environment, Grain, ReproductionError,
    ResearchClaim, ReproductionSpec, Trajectory, canonical, verify, violation_metrics)
from paper_agent.pcgym_audit import SourceEvidence, source_url


def claim():
    return ResearchClaim.from_document('a'*64, 'b'*64, 'c'*64, 'arXiv:2410.22093v4',
        'Table 6 Base reward 0.0727 Shaped reward 0.0003 Oracle 0.0000 '
        'N episodes; indicator evaluates the entire trajectory.')


def spec():
    env = Environment('3.12.0', (('pcgym', '0.1.8'),), COMMIT, 'd'*64, True)
    return ReproductionSpec.prepare(claim(), 'e'*64, env,
        dict(profile='integration-smoke', seed=7, includeOracle=True, maxSeconds=60))


def trace(policy='base', episode=0, temperatures=None):
    return Trajectory.parse(dict(policy=policy, episode=episode, seed=1007+episode,
        temperature_kelvin=temperatures or [325.0]*60,
        concentration=[0.85]*60, coolant_kelvin=[300.0]*60), spec())


class MetricContracts(unittest.TestCase):
    def test_grains_have_different_denominators(self):
        e, s = violation_metrics([[328]+[325]*59, [325]*60])
        self.assertEqual((e.numerator, e.denominator, e.value), (1, 2, .5))
        self.assertEqual((s.numerator, s.denominator, s.value), (1, 120, 1/120))

    def test_bounds_are_inclusive(self):
        self.assertTrue(all(m.value == 0 for m in violation_metrics([[321,327,325]])))

    def test_multiple_excursions_count_one_episode(self):
        e, s = violation_metrics([[320,328,325], [328,328,328]])
        self.assertEqual(e.value, 1)
        self.assertEqual(s.value, 5/6)

    def test_empty_and_nonfinite_are_not_pass(self):
        for data in ([], [[]], [[float('nan')]], [[float('inf')]], [[True]]):
            with self.subTest(data=data), self.assertRaises(ReproductionError):
                violation_metrics(data)

    def test_complete_simulation_still_does_not_establish_table6(self):
        observations = [trace(p,i) for p in ('base','shaped','oracle') for i in range(2)]
        report = verify(spec(), observations, 'succeeded', 'local-pcgym')
        self.assertEqual(report['coverage_check'], 'PASS')
        self.assertEqual(report['paper_comparison'], 'INCONCLUSIVE')
        self.assertEqual(report['scientific_acceptance'], 'unverified')
        self.assertTrue(all(r['table6_comparison']=='INCONCLUSIVE' for r in report['rows']))

    def test_missing_policy_and_episode_keep_denominator(self):
        report = verify(spec(), [trace()], 'succeeded', 'fixture')
        self.assertEqual(report['coverage_check'], 'INCONCLUSIVE')
        self.assertEqual(len(report['rows']), 3)
        self.assertEqual(report['rows'][0]['expected_episodes'], 2)
        self.assertEqual(report['rows'][1]['received_episodes'], 0)

    def test_duplicate_episode_rejected(self):
        with self.assertRaises(ReproductionError): verify(spec(), [trace(),trace()], 'succeeded', 'fixture')

    def test_cancelled_never_becomes_completed(self):
        report = verify(spec(), [trace()], 'cancelled', 'fixture')
        self.assertEqual(report['coverage_check'], 'INCONCLUSIVE')
        self.assertEqual(report['execution_status'], 'cancelled')


class FrozenContracts(unittest.TestCase):
    def test_spec_roundtrip(self):
        original = spec()
        self.assertEqual(ReproductionSpec.restore(original.to_dict()).id, original.id)

    def test_spec_edits_are_rejected(self):
        for key, value in [('episodes',3), ('code_commit','f'*40), ('training_steps',25000),
                           ('include_initial_state',False), ('samples_per_episode',59),
                           ('policy_revision','agent-edit')]:
            raw = copy.deepcopy(spec().to_dict()); raw[key] = value
            with self.subTest(key=key), self.assertRaises(ReproductionError):
                ReproductionSpec.restore(raw)

    def test_environment_change_requires_new_spec(self):
        env = Environment('3.12.1', (('pcgym','0.1.8'),), COMMIT, 'd'*64, True)
        with self.assertRaises(ReproductionError): spec().require_environment(env)

    def test_unavailable_engine_cannot_run(self):
        env = Environment('3.12.0', (), '', '', False, ('missing pcgym',))
        with self.assertRaises(ReproductionError): spec().require_environment(env)

    def test_claim_requires_exact_version_and_row_relationships(self):
        with self.assertRaises(ReproductionError):
            ResearchClaim.from_document('a'*64,'b'*64,'c'*64,'2410.22093v3','Table 6')
        with self.assertRaises(ReproductionError):
            ResearchClaim.from_document('a'*64,'b'*64,'c'*64,'2410.22093v4',
                'Table6 Base reward 0.0003 Shaped reward 0.0727 Oracle 0.0000 episodes trajectory')

    def test_temperature_units_and_coverage(self):
        for values in ([25]*60, [325]*59, [float('nan')]*60, [True]*60):
            with self.subTest(value=values[0]), self.assertRaises(ReproductionError): trace(temperatures=values)

    def test_seed_schedule(self):
        raw = trace().to_dict(); raw['seed'] = 42
        with self.assertRaises(ReproductionError): Trajectory.parse(raw, spec())

    def test_unknown_source_and_changed_bytes_refused(self):
        with self.assertRaises(ReproductionError): source_url('../../etc/passwd')
        with self.assertRaises(ReproductionError):
            SourceEvidence.capture('metric', source_url('metric'), 'print("not the pinned code")')

    def test_truncated_tree_cannot_prove_missing_assets(self):
        with self.assertRaises(ReproductionError):
            SourceEvidence.capture('tree', source_url('tree'), '{"truncated":true,"tree":[]}')

    def test_bool_is_not_training_seed(self):
        with self.assertRaises(ReproductionError):
            ReproductionSpec.prepare(claim(),'e'*64,spec().environment,
                dict(profile='audited-rerun',seed=True,includeOracle=True,maxSeconds=60))


if __name__ == '__main__': unittest.main()
