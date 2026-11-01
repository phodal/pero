"""Freeze the constructed benchmark denominator, not a claim of paper outcomes."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1] / 'benchmarks'))
import unittest
from stateful_gate import run


class StatefulGateTests(unittest.TestCase):
    def test_explicit_case_labels_and_unmodified_snapshot(self):
        report=run()
        self.assertEqual(report['resource_case_count'],9)
        self.assertEqual(report['schema_control_count'],1)
        self.assertEqual(report['case_set_sha256'],'dc4f269d6edfc4fe393cc8ff2325793fd31b4b92f39ce7418ea242719b695555')
        for case in report['cases']:
            with self.subTest(case=case['id']):
                self.assertEqual(case['stateful']['code'],case['expected_code'])
                self.assertEqual(case['stateful']['step_index'],case['expected_step_index'])
                self.assertTrue(case['initial_state_unchanged'])
                self.assertTrue(case['snapshot_roundtrip_equivalent'])
                self.assertEqual(case['static']['accepted'],not case['schema_control'])
        self.assertEqual(report,run())

    def test_reported_denominator_excludes_malformed_control(self):
        metrics=run()['metrics']
        self.assertEqual(metrics['static'],{'true_positive':0,'false_positive':0,'true_negative':1,'false_negative':8,'invalid_recall':0.,'rejection_precision':None})
        self.assertEqual(metrics['stateful'],{'true_positive':8,'false_positive':0,'true_negative':1,'false_negative':0,'invalid_recall':1.,'rejection_precision':1.})
