import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import http.client
from http.server import ThreadingHTTPServer
import json
import tempfile
import threading
import unittest

from experiments import ExperimentStore
from http_api import handler
from test_domain import protocol


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = ExperimentStore(self.directory.name)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), handler(self.store, 'test-only-token'))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()
        self.store.close()
        self.directory.cleanup()

    def request(self, method, path, data=None, token='test-only-token', raw=None, content_type='application/json'):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        body = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
        headers = {'Content-Type': content_type}
        if token is not None:
            headers['X-Pero-App-Token'] = token
        connection.request(method, path, body, headers)
        response = connection.getresponse()
        result = json.loads(response.read())
        connection.close()
        return response.status, result

    def test_auth_boundary_and_no_execution_escape_routes(self):
        for token in (None, '', 'incorrect'):
            status, result = self.request('GET', '/api/state', token=token)
            self.assertEqual(status, 401)
            self.assertNotIn('test-only-token', json.dumps(result))
        for route in ('/api/execute_hardware', '/api/run-python', '/api/agent-session'):
            self.assertEqual(self.request('POST', route, {})[0], 404)
        status, state = self.request('GET', '/api/state')
        self.assertEqual(status, 200)
        self.assertEqual(state['experiments'], [])
        self.assertEqual(state['engine']['mode'], 'simulation')

    def test_agent_proposal_contract_and_actionable_validation(self):
        status, experiment = self.request('POST', '/api/experiments', {})
        self.assertEqual(status, 201)
        identity = experiment['id']
        request = {'action': 'propose', 'experimentId': identity, 'protocol': protocol().to_dict(), 'specHash': experiment['spec_hash']}
        for missing in ({}, {'specHash':None}, {'specHash':'0'*64}):
            invalid_request={key:value for key,value in request.items() if key!='specHash'} | missing
            self.assertEqual(self.request('POST','/api/agent-step',invalid_request)[0],400)
            self.assertEqual(self.store.read(identity)['trials'],[])
        status, record = self.request('POST', '/api/agent-step', request)
        self.assertEqual(status, 200)
        trial_id = record['trials'][0]['id']
        self.assertEqual(record['agent_trial_index'], [{'id': trial_id, 'status': 'proposed', 'parent_trial_id': None}])
        self.assertLess(len(json.dumps(record['agent_trial_index'])), 150)
        self.assertNotIn('agent_trial_index', self.store.read(identity))
        status, record = self.request('POST', '/api/agent-step', {'action': 'validate', 'experimentId': identity, 'trialId': trial_id,'specHash':experiment['spec_hash']})
        self.assertEqual(status, 200)
        self.assertEqual(record['trials'][0]['status'], 'validated')
        self.assertEqual(record['agent_trial_index'], [{'id': trial_id, 'status': 'validated', 'parent_trial_id': None}])
        for action in ('execute_hardware', 'accept', 'set_policy', 'run_script'):
            self.assertEqual(self.request('POST', '/api/agent-step', {'action': action, 'experimentId': identity})[0], 400)
        status, record = self.request('POST', '/api/agent-step', {'action': 'read', 'experimentId': identity, 'target_fraction': 1})
        self.assertEqual(status, 400)
        self.assertEqual(self.request('GET', f'/api/experiments/{identity}')[1]['criteria'], experiment['criteria'])
        invalid = protocol().to_dict()
        invalid['steps'][1]['volume_ul'] = 0
        other_record = self.request('POST', '/api/experiments', {})[1]
        other = other_record['id']
        status, result = self.request('POST', '/api/agent-step', dict(request, experimentId=other, protocol=invalid,specHash=other_record['spec_hash']))
        self.assertEqual(status, 400)
        self.assertEqual(result['step_index'], 1)
        self.assertEqual(self.store.read(other)['trials'], [])

    def test_initial_preview_matches_frozen_state_without_creating_an_experiment(self):
        status, preview = self.request('GET', '/api/state')
        self.assertEqual(status, 200)
        self.assertEqual(preview['experiments'], [])
        status, experiment = self.request('POST', '/api/experiments', {'target_fraction': 0.4})
        self.assertEqual(status, 201)
        self.assertEqual(preview['initial_state'], experiment['initial_state'])
        status, listing = self.request('GET', '/api/state')
        self.assertEqual(status, 200)
        self.assertEqual([item['id'] for item in listing['experiments']], [experiment['id']])
        self.assertEqual(listing['initial_state'], preview['initial_state'])

    def test_request_schema_and_size_limits(self):
        for data in ({'max_trials': True}, {'max_trials': 10 ** 1000}, {'hardware': True}, {'criteria': {'tolerance': 1}}, []):
            self.assertEqual(self.request('POST', '/api/experiments', data)[0], 400)
        for raw in (b'{', b'{"target_fraction":NaN}', b' ' * 131073):
            self.assertEqual(self.request('POST', '/api/experiments', raw=raw)[0], 400)
        self.assertEqual(self.request('POST', '/api/experiments', {}, content_type='text/plain')[0], 400)
