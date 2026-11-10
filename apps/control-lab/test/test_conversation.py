import importlib.util
import json
import pathlib
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'backend'))
from control_lab.conversation import KIND, project_candidate
from control_lab.experiments import Candidate, ExperimentSpec
from control_lab.http import handler
from control_lab.store import ExperimentStore
from test_verification import observed


def execute_saved(spec):
    def execute(_engine, _model, _parameters, scenario, _directory, _cancelled):
        matched = next(item for item in spec.scenarios if dict(item.parameters) == scenario and item.role == 'search')
        return observed(spec, matched).to_dict()
    return execute


class ConversationProjectionTest(unittest.TestCase):
    def test_changed_parameters_do_not_inherit_the_saved_check(self):
        request = {'templateId': 'robust-pid', 'candidateBudget': 2, 'parameters': {'horizon': 2, 'samples': 201}}
        spec = ExperimentSpec.parse(request)
        with tempfile.TemporaryDirectory() as root:
            store = ExperimentStore(root, execute_saved(spec))
            created = store.create(request)
            store.propose(created['id'], {'kp': 1})
            store.worker.join(timeout=5)
            record = store.read(created['id'])
            self.assertEqual(record['status'], 'completed')
            candidate_id = next(item['id'] for item in record['candidates'] if item['id'] != 'baseline')
            trials = len(record['trials'])
            first = store.project(created['id'], candidate_id)
            replay = store.project(created['id'], candidate_id)
            self.assertEqual(replay, first)
            self.assertEqual(len(store.read(created['id'])['trials']), trials)
            self.assertEqual(first['kind'], KIND)
            self.assertIs(first['inheritedCheck'], False)
            self.assertIsNotNone(first['curve'])
            self.assertLess(len(json.dumps(first, separators=(',', ':')).encode()), 12000)
            changed = store.read(created['id'])
            next(item for item in changed['candidates'] if item['id'] == candidate_id)['parameters']['kp'] = 4
            second = project_candidate(changed, candidate_id, True)
            self.assertEqual(second['status'], 'unchecked')
            self.assertIsNone(second['curve'])
            self.assertNotEqual(second['version'], first['version'])
            self.assertTrue(all(row['verdict'] == 'NOT_CHECKED' for row in second['checks']))
            self.assertTrue(second['notApplicable'])
            self.assertTrue({row['reportId'] for row in first['checks'] if row['reportId']}.issubset(
                {item['reportId'] for item in second['notApplicable']}))

    def test_unavailable_failure_and_missing_attempts_use_different_results(self):
        request = {'templateId': 'robust-pid', 'candidateBudget': 1, 'parameters': {'horizon': 2, 'samples': 201}}
        with tempfile.TemporaryDirectory() as root:
            store = ExperimentStore(root, execute_saved(ExperimentSpec.parse(request)))
            created = store.create(request)
            record = store.read(created['id'])
            record['candidates'] = [Candidate('baseline', 'Baseline', ExperimentSpec.restore(record).parameters).to_dict()]
            missing = project_candidate(record, 'baseline', False)
            waiting = project_candidate(record, 'baseline', True)
            self.assertEqual(missing['status'], 'unavailable')
            self.assertEqual(waiting['status'], 'unchecked')
            self.assertTrue(all(row['verdict'] == 'SOLVER_UNAVAILABLE' for row in missing['checks']))
            self.assertTrue(all(row['verdict'] == 'NOT_CHECKED' for row in waiting['checks']))
            nominal = next(item['id'] for item in record['scenarios'] if item['role'] == 'search')
            record['trials'] = [{'id': 'a' * 32, 'candidateId': 'baseline', 'scenarioId': nominal, 'phase': 'search',
                                 'status': 'failed', 'error': 'EngineUnavailable: missing', 'observation': None,
                                 'report': {'id': 'b' * 64}}]
            unavailable = project_candidate(record, 'baseline', True)
            self.assertEqual(unavailable['status'], 'unavailable')
            self.assertEqual(unavailable['notApplicable'][0]['reportId'], 'b' * 64)
            record['trials'][0]['error'] = 'RuntimeError: solver stopped'
            failed = project_candidate(record, 'baseline', True)
            self.assertEqual(failed['status'], 'failed')
            self.assertIsNone(failed['curve'])
            self.assertIn('COMPUTATION_FAILED', {row['verdict'] for row in failed['checks']})
            self.assertNotIn('PASS', {row['verdict'] for row in failed['checks']})
            self.assertTrue(any(row['actual'] is None for row in failed['checks']))

    def test_agent_projection_is_a_receipt_and_replays_without_another_solve(self):
        request = {'templateId': 'robust-pid', 'candidateBudget': 2, 'parameters': {'horizon': 2, 'samples': 201}}
        spec = ExperimentSpec.parse(request)
        calls = {'n': 0}

        def execute(*args):
            calls['n'] += 1
            return execute_saved(spec)(*args)

        with tempfile.TemporaryDirectory() as root:
            store = ExperimentStore(root, execute)
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(store, 'test-token'))
            worker = threading.Thread(target=server.serve_forever)
            worker.start()

            def ask(data):
                body = json.dumps(data).encode()
                headers = {'X-Pero-App-Token': 'test-token', 'Content-Type': 'application/json'}
                with urlopen(Request(f'http://127.0.0.1:{server.server_port}/api/agent-step', body, headers), timeout=5) as response:
                    return json.load(response)

            try:
                created = store.create(request)
                store.propose(created['id'], {'kp': 1})
                store.worker.join(timeout=5)
                candidate_id = next(item['id'] for item in store.read(created['id'])['candidates'] if item['id'] != 'baseline')
                solved = calls['n']
                goal = {'experimentId': created['id'], 'specHash': created['specHash'], 'candidateId': candidate_id}
                receipt = ask({'action': 'project', **goal})
                replay = ask({'action': 'project', **goal})
                self.assertEqual(receipt['kind'], KIND)
                self.assertNotIn('trials', receipt)
                self.assertEqual(replay['version'], receipt['version'])
                self.assertEqual(calls['n'], solved)
                self.assertEqual(store.read(created['id'])['status'], 'completed')
            finally:
                server.shutdown()
                worker.join()
                server.server_close()
                store.close()

    def test_real_solver_curve_uses_saved_samples_and_a_new_input_gets_a_new_version(self):
        if importlib.util.find_spec('control') is None:
            self.skipTest('python-control is not installed; saved-observation binding is covered separately')
        request = {'templateId': 'robust-pid', 'candidateBudget': 3, 'parameters': {'horizon': 2, 'samples': 201}}
        with tempfile.TemporaryDirectory() as root:
            store = ExperimentStore(root)
            created = store.create(request)
            versions = {}
            for gain in (1, 3):
                store.propose(created['id'], {'kp': gain})
                store.worker.join(timeout=60)
                self.assertFalse(store.worker.is_alive())
                record = store.read(created['id'])
                self.assertIn(record['status'], ('completed', 'failed'))
                candidate_id = next(item['id'] for item in record['candidates'] if item['parameters']['kp'] == gain)
                receipt = store.project(created['id'], candidate_id)
                replay = store.project(created['id'], candidate_id)
                self.assertEqual(replay, receipt)
                self.assertIn(receipt['status'], ('pass', 'check_failed', 'inconclusive', 'failed'))
                self.assertIs(receipt['inheritedCheck'], False)
                self.assertLess(len(json.dumps(receipt, separators=(',', ':')).encode()), 12000)
                versions[gain] = receipt
                if receipt['curve'] is None:
                    continue
                trial = next(item for item in record['trials'] if item.get('observation', {}).get('id') == receipt['curve']['observationId'])
                series = next(item for item in trial['observation']['series'] if item['name'] == receipt['curve']['signal'])
                self.assertLess(receipt['curve']['displayed'], receipt['curve']['sampleCount'])
                self.assertEqual(receipt['curve']['displayed'], len(receipt['curve']['document']['rows']))
                for row in receipt['curve']['document']['rows']:
                    self.assertTrue(any(row['y'] == value for value in series['y']))
            self.assertNotEqual(versions[1]['version'], versions[3]['version'])
            first_reports = {row['reportId'] for row in versions[1]['checks'] if row.get('reportId')}
            second_reports = {row['reportId'] for row in versions[3]['checks'] if row.get('reportId')}
            self.assertTrue(first_reports)
            self.assertTrue(first_reports.isdisjoint(second_reports))
            for receipt in versions.values():
                encoded = json.dumps(receipt, separators=(',', ':'), allow_nan=False)
                self.assertNotIn('NaN', encoded)
                for row in receipt['checks']:
                    if row['actual'] is None:
                        self.assertIn('"actual":null', json.dumps(row, separators=(',', ':')))
