"""Real official RDKit and loopback transport; synthetic chemistry, no provider."""
import http.client
from http.server import ThreadingHTTPServer
import json
import math
import socket
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from molecules import MAX_REQUEST, MAX_OUTPUT, MoleculeRequest, preview
from server import PreviewRunner, handler


class MoleculesTest(unittest.TestCase):
    def test_real_rdkit_svg_descriptors_and_invalid_record(self):
        result = preview(MoleculeRequest.parse({'format': 'smiles', 'records': ['CCO', 'invalid@@']}))
        self.assertEqual(result['engine'], {'name': 'RDKit', 'version': '2026.09.1'})
        ethanol, invalid = result['rows']
        self.assertIn('<svg', ethanol['svg'])
        self.assertAlmostEqual(ethanol['descriptors']['MolWt'], 46.069, places=3)
        self.assertEqual(ethanol['descriptors']['NumHDonors'], 1)
        self.assertTrue(all(math.isfinite(value) for value in ethanol['descriptors'].values()))
        self.assertEqual(invalid['error'], 'Invalid molecule')
        self.assertNotIn('svg', invalid)

    def test_mol_and_sdf_use_real_chemistry_without_metadata_execution(self):
        from rdkit import Chem
        block = Chem.MolToMolBlock(Chem.MolFromSmiles('O'))
        for kind, value in [('mol', block), ('sdf', block + '\n$$$$\n')]:
            row = preview(MoleculeRequest.parse({'format': kind, 'records': [value]}))['rows'][0]
            self.assertAlmostEqual(row['descriptors']['MolWt'], 18.015, places=3)
            self.assertIn('<svg', row['svg'])

    def test_sdf_frontend_records_preserve_blank_titles_for_real_rdkit(self):
        from rdkit import Chem
        parser = (Path(__file__).resolve().parents[1] / 'ui-src' / 'files.ts').as_uri()
        script = f"""import {{ moleculeRecords }} from {json.dumps(parser)};
import {{ readFileSync }} from 'node:fs';
process.stdout.write(JSON.stringify(moleculeRecords('molecules.sdf', readFileSync(0))));"""
        blank = Chem.MolToMolBlock(Chem.MolFromSmiles('O'))
        ethanol = Chem.MolFromSmiles('CCO')
        ethanol.SetProp('_Name', 'Ethanol$$$$title')
        named = Chem.MolToMolBlock(ethanol)
        for newline in ('\n', '\r\n'):
            # Both named and genuinely blank titles occur after delimiters.
            blocks = [blank, named, blank]
            source = ''.join(block + '$$$$\n' for block in blocks).replace('\n', newline)
            with self.subTest(newline=repr(newline)):
                parsed = subprocess.run(['node', '--input-type=module', '-e', script],
                                        input=source.encode(), capture_output=True, timeout=10, check=True)
                records = json.loads(parsed.stdout)
                self.assertEqual(records, [block.replace('\n', newline) for block in blocks])
                rows = preview(MoleculeRequest.parse({'format': 'sdf', 'records': records}))['rows']
                self.assertEqual(len(rows), 3)
                for row, weight in zip(rows, (18.015, 46.069, 18.015)):
                    self.assertNotIn('error', row)
                    self.assertAlmostEqual(row['descriptors']['MolWt'], weight, places=3)
                    self.assertIn('<svg', row['svg'])

    def test_request_and_molecule_budgets(self):
        for value in [None, {}, {'format': 'python', 'records': ['pass']}, {'format': 'smiles', 'records': []},
                      {'format': 'smiles', 'records': ['O'] * 201}, {'format': 'smiles', 'records': [' ']},
                      {'format': 'smiles', 'records': ['C' * 32769]}, {'format': 'smiles', 'records': [1]},
                      {'format': 'smiles', 'records': ['O'], 'path': '/tmp/arbitrary'}]:
            with self.subTest(value=str(value)[:80]), self.assertRaises(ValueError):
                MoleculeRequest.parse(value)
        row = preview(MoleculeRequest.parse({'format': 'smiles', 'records': ['C' * 513]}))['rows'][0]
        self.assertIn('512 atoms', row['error'])

    def test_timeout_and_output_budget_kill_and_reap_child(self):
        real_popen = subprocess.Popen
        children = []
        def launch(*args, **kwargs):
            process = real_popen(*args, **kwargs)
            children.append(process)
            return process
        with patch('server.subprocess.Popen', side_effect=launch):
            runner = PreviewRunner([sys.executable, '-c', 'import threading;threading.Event().wait()'], timeout=0.2)
            self.assertEqual(runner.run(b'{}')[0], 504)
            self.assertIsNotNone(children[-1].poll())
            runner = PreviewRunner([sys.executable, '-c', f'import sys;sys.stdout.buffer.write(b"x"*{MAX_OUTPUT + 1000})'])
            self.assertEqual(runner.run(b'{}')[0], 413)
            self.assertIsNotNone(children[-1].poll())
        runner.lock.acquire()
        try:
            self.assertEqual(runner.run(b'{}')[0], 503)
        finally:
            runner.lock.release()
        runner.close()
        self.assertEqual(runner.run(b'{}')[0], 503)

    def test_http_early_errors_delivered_without_running_worker(self):
        class Runner:
            def run(self, _body):
                self.fail_called = True
                return 200, {}

        runner = Runner()
        runner.fail_called = False
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(runner, 'test-secret'))
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            # A declared oversized body may be partial, and an invalid content
            # type may still carry a normal body. Neither should reach the worker.
            cases = [
                ('test-secret', '/api/molecules', 'text/plain', 2, b'{}', 400),
                ('test-secret', '/api/molecules', 'application/json', MAX_REQUEST + 1, b'{}', 400),
                ('wrong', '/api/molecules', 'application/json', 2, b'{}', 401),
                ('test-secret', '/wrong', 'application/json', 2, b'{}', 404),
            ]
            for token, path, content_type, length, body, status in cases:
                with self.subTest(status=status, path=path):
                    connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                    try:
                        connection.request('POST', path, body, {
                            'Content-Type': content_type, 'Content-Length': str(length),
                            'X-Pero-App-Token': token,
                        })
                        response = connection.getresponse()
                        self.assertEqual(response.status, status)
                        error = json.loads(response.read())
                        self.assertEqual(error['detail'], error['error'])
                    finally:
                        connection.close()
            # A short validly framed body is rejected on EOF, not sent to the worker.
            with socket.create_connection(('127.0.0.1', server.server_port), timeout=3) as client:
                client.sendall(b'POST /api/molecules HTTP/1.0\r\n'
                               b'X-Pero-App-Token: test-secret\r\n'
                               b'Content-Type: application/json\r\nContent-Length: 10\r\n\r\n{}')
                client.shutdown(socket.SHUT_WR)
                response = b''
                while chunk := client.recv(4096):
                    response += chunk
                self.assertIn(b' 400 ', response.split(b'\r\n', 1)[0])
                self.assertIn(b'Incomplete request', response)
            self.assertFalse(runner.fail_called)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_http_early_error_drain_is_bounded(self):
        class Runner:
            def run(self, _body):
                raise AssertionError('Rejected input must not reach the worker')

        base = handler(Runner(), 'test-secret')

        # Exercise the cap deterministically with an inexhaustible input. TCP
        # may accept no body bytes if an early rejection wins the send race.
        class EndlessInput:
            count = 0
            def read1(self, size):
                self.count += size
                return b'x' * size

        class Connection:
            def shutdown(self, _how):
                pass
            def settimeout(self, _timeout):
                pass

        class Output:
            def flush(self):
                pass

        class Probe:
            connection = Connection()
            rfile = EndlessInput()
            wfile = Output()
            def reply(self, _status, _value):
                pass

        probe = Probe()
        with patch('server.time.monotonic', return_value=0):
            base.reject(probe, 400, {'error': 'test'})
        self.assertEqual(probe.rfile.count, MAX_REQUEST)

        finished = threading.Event()
        drained = []

        class CountingReader:
            def __init__(self, stream):
                self.stream = stream
                self.count = 0

            def read1(self, size):
                chunk = self.stream.read1(size)
                self.count += len(chunk)
                return chunk

            def __getattr__(self, name):
                return getattr(self.stream, name)

        class ObservedHandler(base):
            def setup(self):
                super().setup()
                self.rfile = CountingReader(self.rfile)

            def finish(self):
                try:
                    super().finish()
                finally:
                    drained.append(self.rfile.count)
                    finished.set()

        server = ThreadingHTTPServer(('127.0.0.1', 0), ObservedHandler)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            # Attempt to send more than the allowed request. The server may
            # close before all bytes are accepted; its drain remains bounded.
            with socket.create_connection(('127.0.0.1', server.server_port), timeout=5) as client:
                client.sendall(b'POST /api/molecules HTTP/1.0\r\n'
                               b'X-Pero-App-Token: test-secret\r\n'
                               b'Content-Type: application/json\r\nContent-Length: 2097152\r\n\r\n'
                               + b'x' * 4096)
                sent = []
                def send_oversized_body():
                    total = 0
                    try:
                        data = b'x' * (2 * MAX_REQUEST)
                        while total < len(data):
                            count = client.send(data[total:])
                            if not count:
                                break
                            total += count
                    except OSError:
                        # Closing after the bounded drain can reset a sender
                        # that continues beyond the budget, especially on Windows.
                        pass
                    finally:
                        sent.append(total)
                sender = threading.Thread(target=send_oversized_body)
                sender.start()
                try:
                    response = b''
                    while True:
                        chunk = client.recv(4096)
                        if not chunk:
                            break
                        response += chunk
                except OSError:
                    pass
                sender.join(5)
                self.assertFalse(sender.is_alive(), 'oversized sender did not finish')
                self.assertTrue(finished.wait(3), 'oversized request handler did not finish')
                # The initial prefix was accepted by sendall. The remaining
                # send may race a close and accept zero bytes.
                self.assertLessEqual(drained[-1], MAX_REQUEST)
                if b'\r\n\r\n' in response:
                    headers, body = response.split(b'\r\n\r\n', 1)
                    self.assertIn(b' 400 ', headers.split(b'\r\n', 1)[0])
                    length = int(next(line.split(b':', 1)[1] for line in headers.split(b'\r\n')
                                      if line.lower().startswith(b'content-length:')))
                    if len(body) >= length:
                        error = json.loads(body[:length])
                        self.assertEqual(error['detail'], error['error'])
                        self.assertIn('1 MiB', error['detail'])

            finished.clear()
            # A stalled peer gets its response without waiting for the drain;
            # the handler also exits shortly even if the peer stays open.
            with socket.create_connection(('127.0.0.1', server.server_port), timeout=5) as client:
                started = time.monotonic()
                client.sendall(b'POST /api/molecules HTTP/1.0\r\n'
                               b'X-Pero-App-Token: test-secret\r\n'
                               b'Content-Type: text/plain\r\nContent-Length: 100\r\n\r\n')
                response = b''
                while b'\r\n\r\n' not in response:
                    chunk = client.recv(4096)
                    self.assertTrue(chunk, 'EOF before response headers')
                    response += chunk
                headers, body = response.split(b'\r\n\r\n', 1)
                length = int(next(line.split(b':', 1)[1] for line in headers.split(b'\r\n')
                                  if line.lower().startswith(b'content-length:')))
                while len(body) < length:
                    chunk = client.recv(4096)
                    self.assertTrue(chunk, 'EOF before complete response body')
                    body += chunk
                self.assertIn(b' 400 ', headers.split(b'\r\n', 1)[0])
                error = json.loads(body)
                self.assertEqual(error['detail'], error['error'])
                self.assertIn('JSON', error['detail'])
                self.assertLess(time.monotonic() - started, 3)
                self.assertTrue(finished.wait(3), 'stalled request handler did not finish')
                self.assertEqual(drained[-1], 0)
                self.assertGreaterEqual(time.monotonic() - started, 0.5)
                self.assertLess(time.monotonic() - started, 4)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_real_http_host_auth_limits_and_worker(self):
        runner = PreviewRunner()
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(runner, 'test-secret'))
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        def call(value, token='test-secret', headers=None, path='/api/molecules'):
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=30)
            try:
                body = json.dumps(value).encode()
                connection.request('POST', path, body, {'Content-Type': 'application/json', 'X-Pero-App-Token': token, **(headers or {})})
                response = connection.getresponse()
                return response.status, json.loads(response.read())
            finally:
                connection.close()
        try:
            request = {'format': 'smiles', 'records': ['CCO', 'bad']}
            self.assertEqual(call(request, token='wrong')[0], 401)
            self.assertEqual(call(request, path='/api/execute')[0], 404)
            self.assertEqual(call(request, headers={'Content-Type': 'text/plain'})[0], 400)
            self.assertEqual(call(request, headers={'Content-Length': str(MAX_REQUEST + 1)})[0], 400)
            invalid_status, invalid = call({'format': 'smiles', 'records': []})
            self.assertEqual(invalid_status, 400)
            self.assertIn('1 to 200', invalid['detail'])
            status, result = call(request)
            self.assertEqual(status, 200)
            self.assertIn('<svg', result['rows'][0]['svg'])
            self.assertIn('error', result['rows'][1])
        finally:
            server.shutdown()
            server.server_close()
            runner.close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
