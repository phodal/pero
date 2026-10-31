"""Evidence limits apply to complete observations, including adaptive grids."""
import pathlib
import os
import shutil
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'backend'))
from control_lab.engines import EngineError, _read_table, execute
from control_lab.experiments import ExperimentSpec, Invalid, admit_attempts, sample_reservation
from control_lab.store import ExperimentStore
from test_verification import observed


class SampleLimitTest(unittest.TestCase):
    def test_plans_reserve_a_bounded_complete_adaptive_observation(self):
        self.assertEqual(sample_reservation('ngspice', 101), 1000)
        self.assertEqual(sample_reservation('ngspice', 1212), 2424)
        self.assertEqual(sample_reservation('python-control', 101), 101)
        with self.assertRaisesRegex(Invalid, '40000'):
            ExperimentSpec.parse({'templateId': 'active-filter', 'candidateBudget': 30,
                                  'parameters': {'samples': 1212}})
        spec = ExperimentSpec.parse({'templateId': 'active-filter', 'candidateBudget': 1,
                                     'parameters': {'samples': 101}})
        admit_attempts(spec, 37000, 3)
        with self.assertRaisesRegex(Invalid, '40000'):
            admit_attempts(spec, 37001, 3)

    def test_table_limit_rejects_extra_rows_without_truncating_raw_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'transient.tsv'
            raw = 'time v(out)\n' + ''.join(f'{i} {i}\n' for i in range(6))
            path.write_text(raw)
            with self.assertRaisesRegex(EngineError, '5-point evidence limit'):
                _read_table(path, 2, 5)
            self.assertEqual(path.read_text(), raw)
            self.assertEqual(len(_read_table(path, 2, 6)[0]), 6)

    def test_legacy_spec_remains_readable_but_oversized_new_batch_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ExperimentStore(directory)
            record = store.create({'templateId': 'active-filter', 'candidateBudget': 1,
                                   'parameters': {'samples': 1212}})
            identity = record['id']
            # Simulate a pre-limit Spec accepted by the old parser. Its
            # canonical representation and hash stay valid after reopening.
            with store.lock:
                saved = store.get_record(identity)
                saved['candidateBudget'] = 30
                saved['specHash'] = ExperimentSpec.restore(saved).hash
                store.save(saved)
            reopened = ExperimentStore(directory)
            before = reopened.read(identity)
            self.assertEqual(reopened.export(identity)['experiment']['specHash'], before['specHash'])
            with self.assertRaisesRegex(Invalid, '40000'):
                reopened.start(identity, 'search')
            self.assertEqual(reopened.read(identity), before)

    def test_legacy_five_by_five_thousand_refuses_before_solver_and_preserves_export(self):
        data = {'templateId': 'active-filter', 'candidateBudget': 5,
                'parameters': {'samples': 5000}}
        # The old admission calculation was exactly 40,000:
        # (five search candidates + three final scenarios) * 5,000.
        self.assertEqual((5 + 3) * 5000, 40000)
        with self.assertRaisesRegex(Invalid, '40000'):
            ExperimentSpec.parse(data)
        calls = []
        def adaptive(_engine, _model, _parameters, _scenario, _directory, _cancelled):
            calls.append(True)
            return {'series': [{'name': 'reference', 'x': list(range(5001)), 'y': [0] * 5001}]}
        with tempfile.TemporaryDirectory() as directory:
            store = ExperimentStore(directory, adaptive)
            created = store.create({'templateId': 'active-filter', 'candidateBudget': 1,
                                    'parameters': {'samples': 5000}})
            identity = created['id']
            with store.lock:
                saved = store.get_record(identity)
                saved['candidateBudget'] = 5
                saved['specHash'] = ExperimentSpec.restore(saved).hash
                legacy_hash = saved['specHash']
                store.save(saved)
            reopened = ExperimentStore(directory, adaptive)
            before = reopened.read(identity)
            export_before = reopened.export(identity)
            self.assertEqual(before['specHash'], legacy_hash)
            with self.assertRaisesRegex(Invalid, '40000'):
                reopened.start(identity, 'search')
            self.assertEqual(calls, [])
            self.assertEqual(reopened.read(identity), before)
            self.assertEqual(reopened.export(identity), export_before)

    def test_final_scenarios_reserve_joint_budget_against_prior_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ExperimentStore(directory)
            created = store.create({'templateId': 'active-filter', 'candidateBudget': 1,
                                    'parameters': {'samples': 101}})
            identity = created['id']
            with store.lock:
                record = store.get_record(identity)
                record['candidates'] = [{'id': 'baseline', 'parameters': record['parameters']}]
                record['lockedCandidateId'] = 'baseline'
                # Saved historical observation points are counted by maximum
                # series length, as in the production ledger.
                record['trials'] = [{'status': 'completed', 'observation': {'series': [{'x': [0] * 37001}]}}]
            before = store.read(identity)
            with self.assertRaisesRegex(Invalid, '40000'):
                store.start(identity, 'verify')
            self.assertEqual(store.read(identity), before)

    def test_store_rejects_oversized_solver_output_and_retains_failure_then_retries(self):
        spec = ExperimentSpec.parse({'templateId': 'active-filter', 'candidateBudget': 1,
                                     'parameters': {'samples': 101}})
        calls = []
        def fake(_engine, _model, _parameters, _scenario, directory, _cancelled):
            calls.append(True)
            if len(calls) == 1:
                (directory / 'raw.tsv').write_text('retained oversized solver output')
                return {'series': [{'name': 'reference', 'x': list(range(1001)), 'y': [0] * 1001}]}
            return observed(spec).to_dict()
        with tempfile.TemporaryDirectory() as directory:
            store = ExperimentStore(directory, fake)
            record = store.create({'templateId': 'active-filter', 'candidateBudget': 1,
                                   'parameters': {'samples': 101}})
            identity = record['id']
            store.start(identity, 'search'); store.worker.join(timeout=5)
            failed = store.read(identity)
            self.assertEqual(failed['status'], 'failed')
            self.assertEqual(failed['trials'][0]['status'], 'failed')
            self.assertIn('1000-point evidence limit', failed['trials'][0]['error'])
            self.assertIsNone(failed['trials'][0]['observation'])
            self.assertEqual(failed['trials'][0]['failureArtifacts'][0]['name'], 'raw.tsv')
            self.assertEqual(store.export(identity)['artifacts'][0]['text'], 'retained oversized solver output')
            store.start(identity, 'search'); store.worker.join(timeout=5)
            retried = store.read(identity)
            self.assertEqual([trial['status'] for trial in retried['trials']], ['failed', 'completed'])
            self.assertLessEqual(sum(max((len(curve['x']) for curve in (trial.get('observation') or {}).get('series', [])), default=0)
                                     for trial in retried['trials']), 40000)

    @unittest.skipUnless(shutil.which('ngspice') and os.name != 'nt', 'real ngspice unavailable')
    def test_real_ngspice_small_grid_preserves_adaptive_rows(self):
        for samples, gain in ((101, 1.586), (1212, 1.586), (1212, 2.8)):
            with self.subTest(samples=samples, gain=gain), tempfile.TemporaryDirectory() as directory:
                result = execute('ngspice', 'active-filter',
                                 {'r': 1000, 'c': 1e-7, 'gain': gain, 'horizon': .005, 'samples': samples},
                                 {}, pathlib.Path(directory), threading.Event())
                length = len(result['series'][0]['x'])
                self.assertGreater(length, samples)
                self.assertLessEqual(length, sample_reservation('ngspice', samples))


if __name__ == '__main__':
    unittest.main()
