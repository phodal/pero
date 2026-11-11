"""Deterministic contracts plus opt-in original-PDF end-to-end verification.

PERO_FISHER_PDF must name the reviewed original; no test downloads it.
"""
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from paper_agent.fisher_result import (DATA_SHA256, FisherProtocol, FisherResult,
    REPORTED, observations)
from paper_agent.fisher_reproduction import prepare, run
from paper_agent.fisher_verify import check
from paper_agent.pcgym import read_json, write_json
from paper_agent.pcgym_domain import Invalid
from paper_agent.store import ResearchStore
from paper_agent.verification import ComparisonPolicy

DATA = Path(__file__).parents[1] / 'backend/paper_agent/fisher_table1.csv'
PDF = os.environ.get('PERO_FISHER_PDF')


class FisherStatisticTests(unittest.TestCase):
    def test_complete_original_transcription_and_centered_statistic(self):
        data = DATA.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), DATA_SHA256)
        rows = observations(data)
        self.assertEqual(len(rows), 100)
        self.assertEqual(rows[31].length_cm, 5.4)  # Scan, not the incorrect OCR 6.4.
        result = FisherResult.compute(rows)
        self.assertAlmostEqual(result.actual, 19.1434, places=12)
        for group, mean, total in zip(result.species, [5.006, 5.936], [6.0882, 13.0552]):
            self.assertEqual(group.count, 50)
            self.assertAlmostEqual(group.mean_cm, mean, places=12)
            self.assertAlmostEqual(group.centered_sum_squares_cm2, total, places=12)
        self.assertIsNone(result.to_dict()['variance_divisor'])

    def test_changed_missing_duplicate_and_ocr_data_refused(self):
        data = DATA.read_bytes()
        for invalid in (data[:-1], data.replace(b'setosa,32,5.4', b'setosa,32,6.4'),
                        data.replace(b'setosa,2,', b'setosa,1,'),
                        data.replace(b'setosa,1,5.1', b'setosa,1,nan')):
            with self.subTest(invalid=invalid[:40]), self.assertRaises(Invalid):
                observations(invalid)

    def test_frozen_identity_covers_policy_runtime_and_source(self):
        spec = FisherProtocol('a' * 64, 'b' * 64, 'Python', 'c' * 64,
                              ComparisonPolicy.parse(dict(mode='absolute', tolerance=.00005)))
        self.assertEqual(spec, FisherProtocol.parse(spec.to_dict()))
        for changed in (replace(spec, selection_digest='d' * 64),
                        replace(spec, python_version='Other Python'),
                        replace(spec, pipeline_digest='e' * 64),
                        replace(spec, comparison=ComparisonPolicy('absolute', tolerance=0))):
            self.assertNotEqual(spec.id, changed.id)
        for field, value in [('reported', 20), ('unit', 'mm^2'), ('groups', 3), ('count', 99),
                             ('data_sha256', 'f' * 64), ('id', '0' * 64), ('command', ['true'])]:
            with self.subTest(field=field), self.assertRaises(Invalid):
                FisherProtocol.parse({**spec.to_dict(), field: value})

    def test_tolerance_never_replaces_independent_check(self):
        spec = FisherProtocol('a' * 64, 'b' * 64, 'Python', 'c' * 64,
                              ComparisonPolicy('absolute', tolerance=.00005))
        for actual, independent, verdict in ((REPORTED, True, 'REPRODUCED'),
                (REPORTED + .001, True, 'MISMATCH'), (REPORTED, False, 'INCONCLUSIVE')):
            with self.subTest(actual=actual, independent=independent):
                result = spec.compare(actual, independent)
                self.assertEqual(result['result_verdict'], verdict)
                self.assertEqual(result['paper_verdict'], 'NOT_ASSESSED')


@unittest.skipUnless(PDF, 'Set PERO_FISHER_PDF for real-source integration; no synthetic replacement')
class FisherOriginalPdfTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / 'case'
        self.prepared = prepare(PDF, self.root)
        self.spec_id = self.prepared['spec_id']

    def execute(self):
        result = run(self.root, self.spec_id, confirm=True)
        return result, Path(result['evidence_directory'])

    def test_real_source_reanalysis_independent_process_and_persisted_result(self):
        result, target = self.execute()
        self.assertEqual(result['result_verdict'], 'REPRODUCED', result)
        self.assertEqual(result['actual'], 19.1434)
        self.assertEqual(result['difference'], 0)
        checker = subprocess.run([sys.executable, '-I', '-S', str(target / 'verify.py')],
                                 capture_output=True, text=True, check=True)
        verified = json.loads(checker.stdout)
        self.assertEqual((verified['exact_numerator'], verified['exact_denominator']), (95717, 5000))
        binding = read_json(target / 'annotation-result.json')
        reopened = ResearchStore(self.root / 'paper-store')
        source = reopened.annotation(binding['sourceAnnotationId'])
        saved = reopened.annotation(binding['resultAnnotationId'])
        self.assertEqual(source.anchor, saved.anchor)
        self.assertIn('REPRODUCED', saved.note)
        self.assertIn(result['attempt_id'], saved.note)
        self.assertEqual(reopened.annotation_image(source.id), reopened.annotation_image(saved.id))
        again, _ = self.execute()
        self.assertEqual(again['spec_id'], result['spec_id'])
        self.assertNotEqual(again['attempt_id'], result['attempt_id'])
        self.assertEqual(len(list((self.root / 'attempts').iterdir())), 2)

    def test_explicit_spec_approval_required_before_attempt(self):
        for key, confirm in [(self.spec_id, False), ('a' * 64, True)]:
            with self.subTest(key=key, confirm=confirm), self.assertRaises(Invalid):
                run(self.root, key, confirm=confirm)
        self.assertFalse((self.root / 'attempts').exists())

    def test_environment_failure_is_not_numeric_mismatch(self):
        spec = FisherProtocol.parse(read_json(self.root / 'spec.json'))
        changed = replace(spec, python_version='unavailable-version')
        write_json(self.root / 'spec.json', changed.to_dict())
        result = run(self.root, changed.id, confirm=True)
        self.assertEqual(result['execution_status'], 'environment_failed')
        self.assertEqual(result['result_verdict'], 'INCONCLUSIVE')
        self.assertTrue(Path(result['log']).is_file())
        self.assertFalse((Path(result['evidence_directory']) / 'observations.json').exists())

    def test_unknown_previous_attempt_is_not_blindly_replayed(self):
        prior = self.root / 'attempts' / 'interrupted'
        prior.mkdir(parents=True)
        write_json(prior / 'execution.json', dict(spec_id=self.spec_id, status='running'))
        with self.assertRaises(Invalid):
            self.execute()
        self.assertEqual(len(list((self.root / 'attempts').iterdir())), 1)

    def test_changed_inputs_do_not_start_computation(self):
        with (self.root / 'data.csv').open('ab') as stream:
            stream.write(b'\n')
        result, target = self.execute()
        self.assertEqual(result['execution_status'], 'input_mismatch')
        self.assertFalse((target / 'observations.json').exists())

    def test_annotation_failure_preserves_verified_numerical_result(self):
        with patch('paper_agent.fisher_reproduction.annotate', side_effect=OSError('disk unavailable')):
            result, target = self.execute()
        self.assertEqual(result['result_verdict'], 'REPRODUCED')
        self.assertEqual(result['execution_status'], 'completed')
        self.assertEqual(result['annotation_status'], 'failed')
        self.assertEqual(result['workflow_status'], 'incomplete')
        self.assertEqual(read_json(target / 'comparison.json')['result_verdict'], result['result_verdict'])
        self.assertEqual(read_json(target / 'failure.json')['result_verdict'], result['result_verdict'])
        self.assertEqual(check(target)['numeric_recomputation'], 'PASS')

    def test_completed_computation_can_miss_frozen_bounds(self):
        spec = FisherProtocol.parse(read_json(self.root / 'spec.json'))
        changed = replace(spec, comparison=ComparisonPolicy.parse(dict(mode='bounds', lower=20, upper=21)))
        write_json(self.root / 'spec.json', changed.to_dict())
        result = run(self.root, changed.id, confirm=True)
        self.assertEqual(result['execution_status'], 'completed')
        self.assertEqual(result['result_verdict'], 'MISMATCH')
        self.assertEqual(check(Path(result['evidence_directory']))['numeric_recomputation'], 'PASS')

    def test_tampering_missing_coverage_and_self_reported_success_rejected(self):
        _, target = self.execute()
        original = (target / 'observations.json').read_bytes()
        # Updating both receipt and manifest is still not proof of correct science.
        for change in [dict(actual=20), dict(count=99), dict(unit='mm^2'),
                       dict(species=[]), dict(actual=True)]:
            with self.subTest(change=change):
                observed = {**json.loads(original), **change}
                write_json(target / 'observations.json', observed)
                receipt = read_json(target / 'execution.json')
                receipt['observations_sha256'] = hashlib.sha256((target / 'observations.json').read_bytes()).hexdigest()
                write_json(target / 'execution.json', receipt)
                manifest = read_json(target / 'manifest.json')
                for name in ('observations.json', 'execution.json'):
                    manifest[name] = hashlib.sha256((target / name).read_bytes()).hexdigest()
                write_json(target / 'manifest.json', manifest)
                with self.assertRaises(ValueError):
                    check(target)

    def test_wrong_original_pdf_refused_before_store_creation(self):
        wrong = Path(self.temp.name) / 'wrong.pdf'
        wrong.write_bytes(b'%PDF-synthetic')
        output = Path(self.temp.name) / 'wrong-case'
        with self.assertRaises(Invalid):
            prepare(wrong, output)
        self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
