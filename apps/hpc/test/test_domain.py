from dataclasses import replace
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from domain import Benchmark, BenchmarkExecution, Invalid, Property, Verification, comparison


class EvidenceRules(unittest.TestCase):
    def test_execution_and_verification_are_separate(self):
        definition = Benchmark('reference', 'Reference', '1', '', 'local-reference', True, None, 'same')
        started = BenchmarkExecution.start(definition, 'run', '2026-11-02T00:00:00Z', '4.10.4')
        report = Verification('fail', (Property('error', .1),), (Property('limit', .01),), ('accuracy',))
        for code, cancelled, expected in ((0, False, 'completed'), (1, False, 'failed'),
                                           (0, True, 'cancelled'), (-15, True, 'cancelled')):
            with self.subTest(code=code, cancelled=cancelled):
                result = started.finish(code, 1, 'later', report, (), '', cancelled)
                self.assertEqual(result.status, expected)
                self.assertEqual(result.verification.status, 'fail')
                self.assertIsNone(result.operation)
        interrupted = started.interrupt('later')
        self.assertEqual(interrupted.status, 'interrupted')
        self.assertIn('not rerun', interrupted.error)

    def test_comparability_requires_same_definition_and_observed_results(self):
        report = Verification('pass', (Property('error', .001),), (), ())
        first = BenchmarkExecution('a', 'ref', 'Reference', 'same', 'local-reference',
                                   'completed', None, 'created', 'updated', verification=report)
        for second, expected in (
            (replace(first, id='b'), True),
            (replace(first, id='b', verification=replace(report, status='fail')), True),
            (replace(first, id='b', spec_digest='different'), False),
            (replace(first, id='b', execution_kind='slurm-openfoam'), False),
            (replace(first, id='b', status='running', operation='run'), False),
            (replace(first, id='b', verification=None), False),
            (replace(first, id='b', verification=replace(report, status='incomplete')), False),
        ):
            with self.subTest(second=second):
                self.assertEqual(comparison((first, second)).comparable, expected)
        for records in ((), (first,), (first,) * 9):
            with self.subTest(count=len(records)), self.assertRaises(Invalid):
                comparison(records)

    def test_checker_admission_and_recheck_remove_stale_pass(self):
        value = dict(schemaVersion=1, status='pass', metrics={'error': .001}, thresholds={'limit': .01},
                     errors=[], checks=[dict(id='range', label='Range', passed=True, value=4,
                                            threshold=[3.9, 4.1])])
        report = Verification.admit(value)
        self.assertEqual(report.view(), value)
        for changed in ({**value, 'schemaVersion': 2}, {**value, 'status': 'success'},
                        {**value, 'metrics': {'error': float('nan')}}):
            with self.subTest(changed=changed), self.assertRaises(Invalid):
                Verification.admit(changed)
        execution = BenchmarkExecution('a', 'ref', 'Reference', 'same', 'local-reference',
                                       'completed', None, 'created', 'updated', verification=report)
        self.assertIsNone(execution.begin_verification('later').verification)


if __name__ == '__main__':
    unittest.main()
