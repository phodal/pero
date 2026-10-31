"""Fault-injection tests for durable experiment starts and worker failures."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from control_lab.experiments import ExperimentSpec, Invalid
from control_lab.store import ExperimentStore
from test_verification import observed


class StoreIOTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='control-lab-store-io-')
        self.addCleanup(self.tmp.cleanup)
        self.request = {'templateId': 'pi-golden', 'candidateBudget': 1,
                        'parameters': {'horizon': 2, 'samples': 201}}
        self.spec = ExperimentSpec.parse(self.request)
        self.calls = []
        self.store = ExperimentStore(self.tmp.name, self.execute)
        self.identity = self.store.create(self.request)['id']
        self.addCleanup(self.store.close)

    def execute(self, _engine, _model, _parameters, scenario, directory, _cancelled):
        self.calls.append(scenario)
        (directory / 'solver.txt').write_text('original solver evidence\n')
        return observed(self.spec).to_dict()

    def join(self):
        if self.store.worker:
            self.store.worker.join(timeout=3)
            self.assertFalse(self.store.worker.is_alive())

    def prepare_report(self):
        self.store.start(self.identity, 'baseline')
        self.join()
        self.store.lock_candidate(self.identity, 'baseline')
        self.store.start(self.identity, 'verify')
        self.join()
        result = self.store.export(self.identity)
        self.assertIsNotNone(result['experiment']['report'])
        self.assertTrue(result['artifacts'])
        return result

    def assert_evidence_retained(self, before, after):
        self.assertEqual(after['experiment']['specHash'], before['experiment']['specHash'])
        self.assertEqual(after['experiment']['reports'][:len(before['experiment']['reports'])], before['experiment']['reports'])
        self.assertEqual(after['experiment']['trials'][:len(before['experiment']['trials'])], before['experiment']['trials'])
        self.assertEqual(after['artifacts'][:len(before['artifacts'])], before['artifacts'])

    def test_start_save_failure_before_write_preserves_old_report_and_evidence(self):
        before = self.prepare_report()
        count = len(self.calls)
        with patch.object(Path, 'write_bytes', side_effect=OSError('injected save error')):
            with self.assertRaises(OSError):
                self.store.start(self.identity, 'verify')
        self.assertEqual(len(self.calls), count)
        self.assertNotEqual(self.store.read(self.identity)['status'], 'running')
        self.assertEqual(self.store.read(self.identity)['report'], before['experiment']['report'])
        self.assert_evidence_retained(before, self.store.export(self.identity))
        reopened = ExperimentStore(self.tmp.name, self.execute)
        try:
            recovered = reopened.export(self.identity)
            self.assertNotEqual(recovered['experiment']['status'], 'running')
            self.assertEqual(recovered['experiment']['report'], before['experiment']['report'])
            self.assert_evidence_retained(before, recovered)
        finally:
            reopened.close()
        self.store.start(self.identity, 'verify')
        self.join()
        after = self.store.export(self.identity)
        self.assert_evidence_retained(before, after)
        self.assertEqual(len(after['experiment']['trials']), len(before['experiment']['trials']) + 1)
        self.assertEqual(len(self.calls), count + 1)

    def test_start_save_error_after_replace_does_not_duplicate_solver(self):
        before = self.prepare_report()
        original_replace = Path.replace
        count = len(self.calls)
        injected = [False]
        def fault(path, destination):
            result = original_replace(path, destination)
            if not injected[0]:
                injected[0] = True
                raise OSError('injected error after atomic replace')
            return result
        with patch.object(Path, 'replace', fault):
            self.store.start(self.identity, 'verify')
            self.join()
        self.assertTrue(injected[0])
        self.assertEqual(len(self.calls), count + 1)
        self.assertNotEqual(self.store.read(self.identity)['status'], 'running')
        self.assert_evidence_retained(before, self.store.export(self.identity))
        reopened = ExperimentStore(self.tmp.name, self.execute)
        try:
            self.assert_evidence_retained(before, reopened.export(self.identity))
            self.assertNotEqual(reopened.read(self.identity)['status'], 'running')
            self.assertEqual(len(reopened.read(self.identity)['trials']), len(before['experiment']['trials']) + 1)
        finally:
            reopened.close()

    def test_unrecognizable_disk_state_fails_closed(self):
        before = self.prepare_report()
        count = len(self.calls)
        def fault(_path, destination):
            # Model an ambiguous/externally altered on-disk record, not a
            # successfully committed old or new snapshot.
            destination.write_bytes(b'{}')
            raise OSError('injected ambiguous destination')
        with patch.object(Path, 'replace', fault):
            with self.assertRaises(Invalid):
                self.store.start(self.identity, 'verify')
        self.assertEqual(len(self.calls), count)
        with self.assertRaises(Invalid):
            self.store.read(self.identity)
        with self.assertRaises(Invalid):
            self.store.start(self.identity, 'verify')
        # Even when the record cannot be reconciled, separate raw files survive.
        for artifact in before['artifacts']:
            path = Path(self.tmp.name) / 'artifacts' / self.identity / artifact['trialId'] / artifact['name']
            self.assertEqual(path.read_text(), artifact['text'])

    def test_thread_start_failure_closes_and_retries(self):
        before = self.prepare_report()
        count = len(self.calls)
        with patch.object(threading.Thread, 'start', side_effect=RuntimeError('injected thread start error')):
            with self.assertRaises((RuntimeError, Invalid)):
                self.store.start(self.identity, 'verify')
        self.assertEqual(len(self.calls), count)
        current = self.store.read(self.identity)
        self.assertNotEqual(current['status'], 'running')
        self.assertEqual(current['report'], before['experiment']['report'])
        self.assertEqual(current.get('verificationOperationId'), before['experiment'].get('verificationOperationId'))
        self.assert_evidence_retained(before, self.store.export(self.identity))
        self.store.close()  # Must not join a thread that never started.
        reopened = ExperimentStore(self.tmp.name, self.execute)
        try:
            recovered = reopened.export(self.identity)
            self.assertNotEqual(recovered['experiment']['status'], 'running')
            self.assertEqual(recovered['experiment']['report'], before['experiment']['report'])
            self.assertEqual(recovered['experiment'].get('verificationOperationId'), before['experiment'].get('verificationOperationId'))
            self.assert_evidence_retained(before, recovered)
            reopened.start(self.identity, 'verify')
            reopened.worker.join(timeout=3)
            self.assertFalse(reopened.worker.is_alive())
            self.assert_evidence_retained(before, reopened.export(self.identity))
            self.assertEqual(len(self.calls), count + 1)
        finally:
            reopened.close()

    def test_worker_save_failure_preserves_evidence_and_retry_budget(self):
        for persistent in (False, True):
            with self.subTest(persistent=persistent), tempfile.TemporaryDirectory(prefix='control-lab-worker-io-') as root:
                calls = []
                def execute(*args):
                    calls.append(1)
                    return observed(self.spec).to_dict()
                store = ExperimentStore(root, execute)
                identity = store.create(self.request)['id']
                original_replace = Path.replace
                saves = [0]
                errors = []
                def fault(path, destination):
                    saves[0] += 1
                    if saves[0] >= 2 and (persistent or saves[0] == 2):
                        raise OSError('injected worker save error')
                    return original_replace(path, destination)
                old_hook = threading.excepthook
                threading.excepthook = lambda args: errors.append(args.exc_value)
                try:
                    with patch.object(Path, 'replace', fault):
                        store.start(identity, 'baseline')
                        store.worker.join(timeout=3)
                        self.assertFalse(store.worker.is_alive())
                    self.assertEqual(calls, [])
                    try:
                        current = store.read(identity)
                    except Invalid:  # Fail-closed until the ledger is reopened.
                        pass
                    else:
                        self.assertNotEqual(current['status'], 'running')
                        self.assertFalse(any(t['status'] == 'running' for t in current['trials']))
                    reopened = ExperimentStore(root, execute)
                    try:
                        record = reopened.read(identity)
                        self.assertNotEqual(record['status'], 'running')
                        self.assertFalse(any(t['status'] == 'running' for t in record['trials']))
                        # Any retained failure counts against the same attempt cap after restart.
                        old_trials = len(record['trials'])
                        reopened.start(identity, 'baseline')
                        reopened.worker.join(timeout=3)
                        self.assertFalse(reopened.worker.is_alive())
                        self.assertEqual(len(calls), 1)
                        self.assertEqual(len(reopened.read(identity)['trials']), old_trials + 1)
                        self.assertEqual(reopened.read(identity)['specHash'], self.spec.hash)
                    finally:
                        reopened.close()
                finally:
                    threading.excepthook = old_hook
                    store.close()

    def test_legacy_failed_record_with_running_trial_recovers_and_keeps_budget(self):
        import copy
        import uuid
        before = self.prepare_report()
        seeded = self.store.read(self.identity)
        original = seeded['trials'][0]
        while len(seeded['trials']) < 79:
            item = copy.deepcopy(original)
            item['id'] = uuid.uuid4().hex
            item['observation']['artifacts'] = []
            seeded['trials'].append(item)
        interrupted = copy.deepcopy(original)
        interrupted['id'] = uuid.uuid4().hex
        interrupted['status'] = 'running'
        interrupted.pop('observation', None)
        interrupted.pop('report', None)
        interrupted.pop('completedAt', None)
        seeded['trials'].append(interrupted)
        seeded.update(status='failed', operation=None, error='legacy worker save failure')
        directory = Path(self.tmp.name) / 'artifacts' / self.identity / interrupted['id']
        directory.mkdir(parents=True)
        (directory / 'partial.txt').write_text('interrupted solver evidence\n')
        self.store.save(seeded)
        count = len(self.calls)
        reopened = ExperimentStore(self.tmp.name, self.execute)
        try:
            recovered = reopened.export(self.identity)
            record = recovered['experiment']
            self.assertEqual(record['status'], 'failed')
            self.assertEqual(record['trials'][-1]['status'], 'failed')
            self.assertEqual(len(record['trials']), 80)
            self.assert_evidence_retained(before, recovered)
            self.assertTrue(any(a['trialId'] == interrupted['id'] and a['text'] == 'interrupted solver evidence\n'
                                for a in recovered['artifacts']))
            with self.assertRaises(Invalid):
                reopened.start(self.identity, 'verify')
            self.assertEqual(len(self.calls), count)
        finally:
            reopened.close()

    def test_worker_result_save_failure_preserves_evidence_and_spends_attempt(self):
        before = self.prepare_report()
        # Seed a nearly full persisted ledger with valid prior observations.
        # Each trial is distinct; no solver needs to run to construct the fixture.
        import copy
        import uuid
        seeded = self.store.read(self.identity)
        original = seeded['trials'][0]
        while len(seeded['trials']) < 79:
            item = copy.deepcopy(original)
            item['id'] = uuid.uuid4().hex
            item['observation']['artifacts'] = []
            seeded['trials'].append(item)
        self.store.save(seeded)
        reopened = ExperimentStore(self.tmp.name, self.execute)
        original_replace = Path.replace
        errors = []
        old_hook = threading.excepthook
        threading.excepthook = lambda args: errors.append(args.exc_value)
        count = len(self.calls)
        try:
            def fault(path, destination):
                record = json.loads(path.read_bytes())
                if len(record['trials']) == 80 and record['trials'][-1]['status'] == 'completed':
                    raise OSError('injected result save error')
                return original_replace(path, destination)
            with patch.object(Path, 'replace', fault):
                reopened.start(self.identity, 'verify')
                reopened.worker.join(timeout=3)
                self.assertFalse(reopened.worker.is_alive())
            self.assertEqual(len(self.calls), count + 1)
            recovered = ExperimentStore(self.tmp.name, self.execute)
            try:
                record = recovered.read(self.identity)
                self.assertEqual(len(record['trials']), 80)
                self.assertNotEqual(record['status'], 'running')
                self.assertNotEqual(record['trials'][-1]['status'], 'running')
                self.assertNotEqual(record['trials'][-1]['status'], 'completed')
                self.assertEqual(record['trials'][:len(before['experiment']['trials'])], before['experiment']['trials'])
                self.assertEqual(record['reports'][:len(before['experiment']['reports'])], before['experiment']['reports'])
                self.assert_evidence_retained(before, recovered.export(self.identity))
                self.assertTrue(record['trials'][-1].get('failureArtifacts'))
                with self.assertRaises(Invalid):
                    recovered.start(self.identity, 'verify')
                self.assertEqual(len(self.calls), count + 1)
            finally:
                recovered.close()
        finally:
            threading.excepthook = old_hook
            reopened.close()


if __name__ == '__main__':
    unittest.main()
