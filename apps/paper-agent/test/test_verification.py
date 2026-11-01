"""Deterministic policy tests; no fixture constitutes a paper reproduction."""
from dataclasses import replace
import unittest

from test_pcgym_reproduction import specification
from paper_agent.pcgym_domain import EPISODE_METRIC, SAMPLE_METRIC, PAPER, Invalid
from paper_agent.verification import ComparisonEvidence, ComparisonPolicy, VerificationItem


class ComparisonTests(unittest.TestCase):
    def test_policy_boundaries_and_zero_relative(self):
        for raw, reported, actual, expected in (
            ({'mode': 'absolute', 'tolerance': .5}, 1, 1.5, 'within_tolerance'),
            ({'mode': 'absolute', 'tolerance': .5}, -1, -.49, 'outside_tolerance'),
            ({'mode': 'relative', 'tolerance': .25}, -2, -1.5, 'within_tolerance'),
            ({'mode': 'relative', 'tolerance': .25}, 2, 3, 'outside_tolerance'),
            ({'mode': 'relative', 'tolerance': 100}, 0, 0, 'undefined'),
            ({'mode': 'relative', 'tolerance': 100}, 0, 1, 'undefined'),
            ({'mode': 'bounds', 'lower': -1, 'upper': 2}, 0, -1, 'within_tolerance'),
            ({'mode': 'bounds', 'lower': -1, 'upper': 2}, 0, 2, 'within_tolerance'),
            ({'mode': 'bounds', 'lower': -1, 'upper': 2}, 0, 3, 'outside_tolerance'),
            ({'mode': 'bounds', 'lower': 0, 'upper': 1e308}, 1e-308, 1e308, 'within_tolerance'),
            ({'mode': 'absolute', 'tolerance': 1e308}, 1e-308, 1e308, 'within_tolerance'),
            ({'mode': 'relative', 'tolerance': 1}, 1e-308, 1e308, 'undefined'),
        ):
            with self.subTest(raw=raw, actual=actual):
                policy = ComparisonPolicy.parse(raw)
                self.assertEqual(policy.assess(reported, actual)['status'], expected)
                self.assertEqual(ComparisonPolicy.parse(policy.to_dict()), policy)

    def test_invalid_policies_and_nonfinite_values(self):
        for raw in ({'mode': 'absolute', 'tolerance': -1},
                    {'mode': 'relative', 'tolerance': True},
                    {'mode': 'absolute', 'tolerance': float('nan')},
                    {'mode': 'bounds', 'lower': 2, 'upper': 1},
                    {'mode': 'bounds', 'lower': 0, 'upper': float('inf')},
                    {'mode': 'absolute', 'tolerance': 1, 'pass': True}):
            with self.subTest(raw=raw), self.assertRaises(Invalid):
                ComparisonPolicy.parse(raw)
        policy = ComparisonPolicy.parse({'mode': 'absolute', 'tolerance': 1})
        for value in (float('nan'), float('inf'), -float('inf'), True):
            with self.subTest(value=value), self.assertRaises(Invalid):
                policy.assess(0, value)
        with self.assertRaises(Invalid):
            policy.assess(-1e308, 1e308)

    def test_frozen_identity_and_gates_precede_tolerance(self):
        spec = specification(paper_binding_digest='c' * 64)
        item = VerificationItem.create(spec, 'e' * 64, 'base', {'mode': 'absolute', 'tolerance': 1e6})
        evidence = ComparisonEvidence(spec.id, PAPER, EPISODE_METRIC, True, 'completed', .0727, True)
        matching = item.compare(evidence)
        self.assertEqual(matching['diagnostic']['status'], 'within_tolerance')
        self.assertEqual(matching['comparison_status'], 'inconclusive')
        self.assertEqual(matching['paper_verdict'], 'INCONCLUSIVE')
        for changes, reason in ((dict(spec_id='a' * 64), 'version_mismatch'),
                                (dict(paper_version='arxiv:2410.22093v3'), 'version_mismatch'),
                                (dict(metric=SAMPLE_METRIC), 'metric_mismatch'),
                                (dict(full_coverage=False), 'incomplete_coverage'),
                                (dict(integrity_verified=False), 'unverified_execution_evidence'),
                                (dict(execution_status='failed', actual=None), 'execution_not_completed'),
                                (dict(execution_status='cancelled'), 'execution_not_completed'),
                                (dict(execution_status='unknown'), 'execution_not_completed')):
            with self.subTest(changes=changes):
                result = item.compare(replace(evidence, **changes))
                self.assertIn(reason, result['reasons'])
                self.assertIsNone(result['diagnostic'])
                self.assertEqual(result['paper_verdict'], 'INCONCLUSIVE')
                self.assertEqual(result['execution_status'], changes.get('execution_status', 'completed'))
        revision = VerificationItem.create(spec, 'e' * 64, 'base', {'mode': 'absolute', 'tolerance': 0})
        self.assertEqual(item.spec_id, revision.spec_id)
        self.assertNotEqual(item.id, revision.id)
        self.assertEqual(item.compare(replace(evidence, actual=1))['diagnostic']['status'], 'within_tolerance')
        self.assertEqual(revision.compare(replace(evidence, actual=1))['diagnostic']['status'], 'outside_tolerance')
        with self.assertRaises(Invalid):
            item.compare(replace(evidence, actual=float('nan')))
