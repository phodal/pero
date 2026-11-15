"""Real loopback HTTP -> private Host wire; remote execution remains a fixture."""
import http.client
from http.server import HTTPServer
import json
from pathlib import Path
import socketserver
import sys
from tempfile import TemporaryDirectory
from threading import Thread
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from clusters import ClusterDraft, ClusterStore
from remote import RemoteCompute, RemoteComputeError, RemoteRequest
from server import handler


class HostFixture(socketserver.TCPServer):
    def __init__(self):
        self.requests = []
        self.response = {'value': {'available': True, 'attempts': []}}
        class Receive(socketserver.StreamRequestHandler):
            def handle(connection):
                self.requests.append(json.loads(connection.rfile.readline()))
                connection.wfile.write(json.dumps(self.response).encode() + b'\n')
        super().__init__(('127.0.0.1', 0), Receive)


class RemoteComputeTests(unittest.TestCase):
    def test_only_saved_connections_fixed_inputs_and_original_attempt_actions_are_admitted(self):
        cluster = ClusterDraft('Workstation', 'lab', id='cluster-' + 'a' * 32, scheduler='ssh')
        valid = {'operation': 'prepare', 'clusterId': cluster.id, 'samples': 1000, 'repetitions': 1}
        for invalid in [None, [], {}, {'operation': 'exec', 'command': 'anything'},
                        {**valid, 'program': 'other'}, {**valid, 'clusterId': 'missing'},
                        {**valid, 'samples': True}, {**valid, 'samples': 1000.0}, {**valid, 'samples': 999},
                        {**valid, 'samples': 10000001}, {**valid, 'repetitions': 0},
                        {**valid, 'repetitions': 100001}, {'operation': 'probe', 'clusterId': cluster.id, 'host': 'other'},
                        {'operation': 'observe', 'id': '../other'}, {'operation': 'cancel', 'id': 'attempt', 'force': True},
                        {'operation': 'submit', 'id': 'attempt', 'digest': 'missing'},
                        {'operation': 'artifact', 'id': 'attempt', 'digest': 'missing'},
                        {'operation': 'artifact', 'id': 'attempt', 'digest': 'ab' * 32, 'path': '/remote/file'}]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                RemoteRequest.parse(invalid, [cluster])
        request = RemoteRequest.parse(valid, [cluster])
        self.assertEqual(request.cluster, cluster)
        self.assertEqual(request.wire()['cluster']['host'], 'lab')

    def test_authenticated_http_forwards_to_host_without_credential_or_command_input(self):
        with TemporaryDirectory() as directory, HostFixture() as host:
            host_thread = Thread(target=host.serve_forever, daemon=True)
            host_thread.start()
            store = ClusterStore(directory)
            cluster = store.save(ClusterDraft.parse({'name': 'Lab workstation', 'host': 'lab-alias',
                                                    'scheduler': 'ssh', 'workdir': '/scratch/research'}))['clusters'][0]
            bridge = RemoteCompute(f'127.0.0.1:{host.server_address[1]}', 'host-only-secret')
            server = HTTPServer(('127.0.0.1', 0), handler(store, 'app-secret', bridge))
            server_thread = Thread(target=server.serve_forever, daemon=True)
            server_thread.start()
            def request(method, path='/api/remote', value=None, secret='app-secret', content_type='application/json'):
                connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=2)
                body = json.dumps(value) if value is not None else None
                connection.request(method, path, body, {'X-Pero-App-Token': secret, 'Content-Type': content_type})
                response = connection.getresponse()
                result = response.status, json.loads(response.read())
                connection.close()
                return result
            try:
                self.assertEqual(request('GET', secret='wrong')[0], 401)
                self.assertEqual(request('POST', '/api/remote/exec', {'program': 'wrong'})[0], 404)
                self.assertEqual(request('POST', value={'operation': 'probe', 'clusterId': cluster['id']}, content_type='text/plain')[0], 400)
                self.assertEqual(host.requests, [])
                self.assertEqual(request('GET'), (200, {'available': True, 'attempts': []}))
                operations = [
                    {'operation': 'probe', 'clusterId': cluster['id']},
                    {'operation': 'prepare', 'clusterId': cluster['id'], 'samples': 1000, 'repetitions': 2},
                    {'operation': 'submit', 'id': 'remote-attempt', 'digest': 'ab' * 32},
                    {'operation': 'observe', 'id': 'remote-attempt'},
                    {'operation': 'cancel', 'id': 'remote-attempt'},
                    {'operation': 'collect', 'id': 'remote-attempt'},
                    {'operation': 'artifact', 'id': 'remote-attempt', 'digest': 'ab' * 32},
                ]
                for value in operations:
                    with self.subTest(operation=value['operation']):
                        self.assertEqual(request('POST', value=value)[0], 200)
                        sent = host.requests[-1]
                        self.assertEqual(sent['token'], 'host-only-secret')
                        expected = {key: item for key, item in value.items() if key != 'clusterId'}
                        if 'clusterId' in value:
                            expected['cluster'] = {key: item for key, item in cluster.items() if key != 'connectionStatus'}
                        if value['operation'] == 'prepare':
                            expected['input'] = {'samples': expected.pop('samples'), 'repetitions': expected.pop('repetitions')}
                        self.assertEqual(sent['request'], expected)
                host.response = {'value': {'filename': 'result.json', 'sha256': 'ab' * 32, 'base64': 'e30='}}
                self.assertEqual(request('POST', value=operations[-1]), (200, host.response['value']))
                saved = store.path.read_bytes()
                count = len(host.requests)
                self.assertEqual(request('POST', value={**operations[1], 'command': 'no'})[0], 400)
                self.assertEqual(len(host.requests), count)
                self.assertEqual(store.path.read_bytes(), saved)
                host.response = {'error': 'Submission unconfirmed; reconcile original operation, do not resubmit'}
                status, failure = request('POST', value=operations[3])
                self.assertEqual(status, 502)
                self.assertIn('do not resubmit', failure['detail'])
                self.assertNotIn('host-only-secret', failure['detail'])
                host.response = {'value': []}
                self.assertEqual(request('GET')[0], 502)
            finally:
                server.shutdown()
                server_thread.join()
                server.server_close()
                host.shutdown()
                host_thread.join()

    def test_missing_host_capability_remains_unavailable_and_cannot_submit(self):
        bridge = RemoteCompute('', '')
        self.assertEqual(bridge.request(RemoteRequest('state'))['available'], False)
        self.assertEqual(bridge.request(RemoteRequest('state'))['attempts'], [])
        with self.assertRaises(RemoteComputeError):
            bridge.request(RemoteRequest('submit', id='attempt', digest='ab' * 32))


if __name__ == '__main__':
    unittest.main()
