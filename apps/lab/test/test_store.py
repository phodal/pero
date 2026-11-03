"""Real pinned PLR shell wiring; no fake execution backend."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from experiments import ExperimentStore, capability, canonical, digest
from pylabrobot_adapter import ChatterboxAdapter
from test_domain import protocol


class ProposalTests(unittest.TestCase):
    def test_invalid_sequence_leaves_no_candidate_and_can_be_corrected(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ExperimentStore(directory)
            self.addCleanup(store.close)
            record = store.create({})
            identity = record['id']
            path = Path(directory) / (identity + '.json')
            persisted = path.read_bytes()
            invalid = protocol().to_dict()
            del invalid['steps'][1]  # Dispense now follows pickup with an empty pipette.
            with self.assertRaises(ValueError) as caught:
                store.propose(identity, invalid)
            self.assertEqual(caught.exception.code, 'pipette_depletion')
            self.assertEqual(caught.exception.step_index, 1)
            self.assertEqual(store.read(identity), record)
            self.assertEqual(path.read_bytes(), persisted)
            self.assertEqual(list(Path(directory).iterdir()), [path])
            reopened = ExperimentStore(directory)
            self.addCleanup(reopened.close)
            self.assertEqual(reopened.read(identity), record)
            corrected = reopened.propose(identity, protocol().to_dict())
            trial = corrected['trials'][0]
            self.assertEqual(trial['status'], 'proposed')
            self.assertEqual(trial['initial_state'], record['initial_state'])
            self.assertEqual(trial['final_state'], record['initial_state'])
            self.assertEqual(reopened.validate(identity, trial['id'])['trials'][0]['status'], 'validated')


@unittest.skipUnless(capability()['available'], 'requires CPython 3.12 and pinned real pylabrobot==0.2.2')
class StoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = ExperimentStore(self.directory.name)
        self.addCleanup(self.directory.cleanup)
        self.addCleanup(self.store.close)

    def run_candidate(self, identity, candidate, parent=None):
        record = self.store.propose(identity, candidate.to_dict(), parent, 'Measured feedback requires revised ratio' if parent else 'Baseline')
        trial_id = record['trials'][-1]['id']
        self.store.validate(identity, trial_id)
        self.store.start(identity, trial_id)
        self.store.worker.join(timeout=15)
        self.assertFalse(self.store.worker.is_alive(), 'real Chatterbox run must finish')
        trial = self.store.read(identity)['trials'][-1]
        self.assertEqual(trial['status'], 'completed', trial['error'])
        return trial_id

    def test_two_linked_trials_export_reopen_and_immutable_evidence(self):
        frozen = self.store.create({'max_trials': 2})
        identity = frozen['id']
        first = self.run_candidate(identity, protocol())
        self.store.observe(identity, first)
        baseline = self.store.evaluate(identity, first)
        self.assertEqual(baseline['trials'][0]['verification']['verdict'], 'FAIL')
        second = self.run_candidate(identity, protocol(40, 60), first)
        self.store.observe(identity, second)
        record = self.store.evaluate(identity, second)
        self.assertEqual(record['trials'][1]['verification']['verdict'], 'PASS')
        self.assertEqual(record['trials'][1]['parent_trial_id'], first)
        self.assertEqual(record['criteria'], frozen['criteria'])
        self.assertEqual(record['spec_hash'], frozen['spec_hash'])
        self.assertAlmostEqual(self.store.compare(identity)['improvement'], .1)
        self.assertEqual(record['decisions'], [])
        for trial in record['trials']:
            self.assertEqual(trial['engine']['version'], '0.2.2')
            self.assertEqual(trial['protocol_hash'], digest(trial['protocol']))
            self.assertEqual(len(trial['events']), 8)
            previous = trial['initial_state']
            for event in trial['events']:
                self.assertEqual(event['before'], previous)
                self.assertEqual(event['status'], 'completed')
                self.assertIsNotNone(event['backend'])
                previous = event['after']
            self.assertEqual(previous, trial['final_state'])
        report = self.store.export(identity)
        for sha, encoded in report['assets'].items():
            self.assertEqual(hashlib.sha256(base64.b64decode(encoded)).hexdigest(), sha)
        reopened = ExperimentStore(self.directory.name)
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.export(identity), report)
        with self.assertRaises(ValueError):
            reopened.start(identity, second)
        with self.assertRaises(ValueError):
            reopened.observe(identity, second)
        with self.assertRaises(ValueError):
            reopened.propose(identity, protocol().to_dict(), second, 'Over budget')
        self.assertEqual(reopened.export(identity), report)

    def test_original_csv_and_json_bytes_survive_import_and_export(self):
        for filename, raw in [('measurements.csv', b'well,value,unit\r\nB1,0.500,fraction\r\n'),
                              ('measurements.json', b'[ { "well": "B1", "value": 0.5, "unit": "fraction" } ]\n')]:
            with self.subTest(filename=filename):
                identity = self.store.create({})['id']
                trial_id = self.run_candidate(identity, protocol())
                data = {'trialId': trial_id, 'filename': filename, 'source': 'User-provided optical fraction',
                        'content_base64': base64.b64encode(raw).decode()}
                record = self.store.import_observation(identity, data)
                observation = record['trials'][0]['observations'][0]
                sha = hashlib.sha256(raw).hexdigest()
                self.assertEqual(observation['origin'], 'imported')
                self.assertEqual(observation['sha256'], sha)
                self.assertEqual(observation['measurements'][0]['unit'], 'fraction')
                self.assertEqual((Path(self.directory.name) / observation['asset_ref']).read_bytes(), raw)
                self.assertEqual(base64.b64decode(self.store.export(identity)['assets'][sha]), raw)
                self.assertEqual(self.store.evaluate(identity, trial_id)['trials'][0]['verification']['verdict'], 'PASS')

    def test_cancel_and_uncertain_command_preserve_partial_evidence_without_replay(self):
        actual_execute = ChatterboxAdapter.execute
        for outcome in ('cancelled', 'unknown'):
            with self.subTest(outcome=outcome):
                identity = self.store.create({})['id']
                record = self.store.propose(identity, protocol().to_dict())
                trial_id = record['trials'][0]['id']
                self.store.validate(identity, trial_id)
                async def execute(adapter, operation):
                    evidence = await actual_execute(adapter, operation)
                    if outcome == 'unknown':
                        raise RuntimeError('Injected transport result loss after real PLR dispatch')
                    self.store.cancelled.set()
                    return evidence
                with patch.object(ChatterboxAdapter, 'execute', execute):
                    self.store.start(identity, trial_id)
                    self.store.worker.join(timeout=15)
                trial = self.store.read(identity)['trials'][0]
                self.assertEqual(trial['status'], outcome)
                self.assertEqual(len(trial['events']), 1)
                self.assertEqual(trial['events'][0]['status'], 'completed' if outcome == 'cancelled' else 'unknown')
                if outcome == 'cancelled':
                    self.assertEqual(trial['final_state']['revision'], 1)
                with self.assertRaises(ValueError):
                    self.store.start(identity, trial_id)
                reopened = ExperimentStore(self.directory.name)
                self.addCleanup(reopened.close)
                self.assertEqual(reopened.read(identity)['trials'][0], trial)

    def test_running_snapshot_reopens_as_unknown_without_dispatch(self):
        identity = self.store.create({})['id']
        record = self.store.propose(identity, protocol().to_dict())
        record['trials'][0]['status'] = 'running'
        record['trials'][0]['events'] = [{'status': 'running', 'before': record['initial_state']}]
        # Models abrupt process loss, not an executed trial or fabricated success.
        self.store.save(record)
        reopened = ExperimentStore(self.directory.name)
        self.addCleanup(reopened.close)
        recovered = reopened.read(identity)['trials'][0]
        self.assertEqual(recovered['status'], 'unknown')
        self.assertEqual(recovered['events'][0]['status'], 'unknown')
        self.assertIsNone(reopened.worker)

    def test_verification_freezes_missing_observation_and_comparison_uses_parent(self):
        identity = self.store.create({})['id']
        first = self.run_candidate(identity, protocol())
        frozen = self.store.evaluate(identity, first)
        self.assertEqual(frozen['trials'][0]['verification']['verdict'], 'INCONCLUSIVE')
        with self.assertRaises(ValueError):
            self.store.observe(identity, first)
        self.assertEqual(self.store.read(identity), frozen)
        # A separate experiment compares a branch to its actual parent, not the last-created trial.
        identity = self.store.create({})['id']
        first = self.run_candidate(identity, protocol())
        self.store.observe(identity, first)
        self.store.evaluate(identity, first)
        second = self.run_candidate(identity, protocol(40, 60), first)
        self.store.observe(identity, second)
        self.store.evaluate(identity, second)
        third = self.run_candidate(identity, protocol(60, 40), first)
        self.store.observe(identity, third)
        self.store.evaluate(identity, third)
        comparison = self.store.compare(identity)
        self.assertAlmostEqual(comparison['improvement'], -.1)
        self.assertEqual(comparison['message'], 'No improvement')
