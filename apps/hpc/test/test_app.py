from dataclasses import replace
import hashlib
from http.server import ThreadingHTTPServer
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from domain import BenchmarkExecution, Invalid
from executor import Runtime
from server import handler
from store import BenchmarkStore


class AppWiring(unittest.TestCase):
    def test_authentication_bounded_agent_requests_and_persisted_evidence(self):
        runtime = Runtime.inspect()
        with tempfile.TemporaryDirectory() as root:
            store = BenchmarkStore(root, runtime=runtime)
            definition = store.benchmarks[0]
            record = BenchmarkExecution.start(definition, 'a' * 32, 'created', '4.10.4')
            store.save(record)
            restored = BenchmarkStore(root, runtime=runtime)
            self.assertEqual(restored.read(record.id)['status'], 'interrupted')
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(restored, 'token'))
            worker = threading.Thread(target=server.serve_forever)
            worker.start()

            def request(path, value=None, token='token'):
                body = json.dumps(value).encode() if value is not None else None
                headers = {'X-Pero-App-Token': token, 'Content-Type': 'application/json'}
                with urlopen(Request(f'http://127.0.0.1:{server.server_port}' + path, body, headers), timeout=5) as response:
                    return json.load(response)

            try:
                self.assertEqual(request('/api/state')['runs'][0]['status'], 'interrupted')
                for path, body, token in (
                    ('/api/state', None, 'wrong'),
                    ('/api/runs', {'benchmarkId': definition.id, 'command': 'custom'}, 'token'),
                    ('/api/agent-step', {'action': 'verify', 'runId': record.id, 'specDigest': 'wrong'}, 'token'),
                    ('/api/agent-step', {'action': 'run', 'benchmarkId': definition.id, 'specDigest': 'wrong'}, 'token'),
                    ('/api/runs', {'benchmarkId': 'openfoam-poiseuille-v1'}, 'token'),
                ):
                    with self.subTest(path=path, body=body), self.assertRaises(HTTPError) as denied:
                        request(path, body, token)
                    self.assertIn(denied.exception.code, (400, 401))
                    denied.exception.close()
                read = request('/api/agent-step', {'action': 'read', 'runId': record.id,
                                                  'specDigest': record.spec_digest})
                self.assertEqual(read['run']['status'], 'interrupted')
            finally:
                server.shutdown()
                worker.join()
                server.server_close()
                restored.close()
                store.close()

    def test_reframe_real_compute_recheck_export_and_comparison(self):
        runtime = Runtime.inspect()
        if not runtime.available:
            self.skipTest('Run with Python containing reframe-hpc==4.10.4 for real local acceptance')
        with tempfile.TemporaryDirectory() as root:
            store = BenchmarkStore(root, runtime=runtime)
            records = []
            for benchmark in ('pi-midpoint-v1', 'pi-midpoint-v1', 'poisson-1d-v1'):
                created = store.create(benchmark)
                store.workers[created['id']].join(30)
                result = store.read(created['id'])
                self.assertIsNone(result['operation'])
                self.assertEqual(result['status'], 'completed', result['logs'])
                self.assertEqual(result['verification']['status'], 'pass')
                self.assertEqual(result['executionKind'], 'local-reference')
                records.append(result)
            self.assertTrue(store.compare([record['id'] for record in records[:2]])['comparable'])
            self.assertFalse(store.compare([records[0]['id'], records[2]['id']])['comparable'])
            for record in records[:1] + records[2:]:
                curve = store.series(record['id'])
                self.assertGreater(len(curve['points']), 100)
                self.assertLessEqual(len(curve['points']), 257)
            identity = records[0]['id']
            store.verify(identity)
            store.workers[identity].join(10)
            self.assertEqual(store.read(identity)['verification']['status'], 'pass')
            archive = zipfile.ZipFile(io.BytesIO(store.export(identity)))
            manifest = json.loads(archive.read('export-manifest.json'))
            runner_files = [name for name in archive.namelist() if name.startswith('reframe/')]
            for suffix in ('.out', '.err', '.sh'):
                self.assertTrue(any(name.endswith(suffix) for name in runner_files), runner_files)
            for name, digest in manifest['files'].items():
                self.assertEqual(hashlib.sha256(archive.read(name)).hexdigest(), digest)
            with tempfile.TemporaryDirectory() as unpacked:
                archive.extractall(unpacked)
                checked = subprocess.run([runtime.python, str(Path(unpacked) / 'bundle/verify.py'),
                                          str(Path(unpacked) / 'bundle')], capture_output=True, text=True, timeout=10)
                self.assertEqual(json.loads(checked.stdout)['status'], 'pass')
            bundle = Path(root) / 'runs' / identity / 'bundle'
            # Even a preflight hash failure must remove PASS from the record and exported bundle.
            input_path = bundle / 'input.json'
            original_input = input_path.read_bytes()
            input_path.write_text('{}\n')
            for operation in (store.export, store.series):
                with self.subTest(operation=operation.__name__), self.assertRaisesRegex(Invalid, 'evidence changed'):
                    operation(identity)
            store.verify(identity)
            store.workers[identity].join(10)
            invalid_input = store.read(identity)
            self.assertIsNone(invalid_input['verification'])
            self.assertIn('hash mismatch', invalid_input['error'])
            failed_archive = zipfile.ZipFile(io.BytesIO(store.export(identity)))
            self.assertNotIn('bundle/verification.json', failed_archive.namelist())
            input_path.write_bytes(original_input)
            # Corrupt an observed sample: a new independent report must replace the old PASS.
            sample = next((bundle / 'raw').glob('*.csv'))
            sample.write_text('invalid sample\n')
            store.verify(identity)
            store.workers[identity].join(10)
            self.assertEqual(store.read(identity)['verification']['status'], 'incomplete')
            # Corrupt the frozen checker: it must not execute or retain a stale report.
            (bundle / 'verify.py').write_text('raise RuntimeError("changed")\n')
            store.verify(identity)
            store.workers[identity].join(10)
            failed = store.read(identity)
            self.assertIsNone(failed['verification'])
            self.assertIn('hash mismatch', failed['error'])
            store.close()
            restored = BenchmarkStore(root, runtime=runtime)
            self.assertEqual(len(restored.state()['runs']), 3)
            self.assertIsNone(restored.read(identity)['verification'])
            restored.close()

    def test_cancellation_reaches_owned_execution_without_restart_replay(self):
        entered = threading.Event()

        def execute(_runtime, _directory, cancelled, _benchmark_id):
            entered.set()
            if not cancelled.wait(3):
                raise ValueError('Cancellation was not delivered')
            return -15

        with tempfile.TemporaryDirectory() as root:
            store = BenchmarkStore(root, runtime=Runtime(sys.executable, '4.10.4', 'fixture seam'),
                                   run_executor=execute)
            created = store.create('pi-midpoint-v1')
            self.assertTrue(entered.wait(3))
            store.cancel(created['id'])
            store.workers[created['id']].join(5)
            self.assertEqual(store.read(created['id'])['status'], 'cancelled')
            store.close()
            restored = BenchmarkStore(root, runtime=Runtime(sys.executable, None, 'unavailable'))
            self.assertEqual(restored.read(created['id'])['status'], 'cancelled')
            self.assertEqual(restored.workers, {})
            restored.close()


if __name__ == '__main__':
    unittest.main()
