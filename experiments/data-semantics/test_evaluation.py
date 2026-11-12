"""Model answer admission preserves errors instead of silently dropping attempts."""
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from threading import Thread
from evaluate import Answer


class Answers(unittest.TestCase):
    def test_answer_boundary(self):
        base = dict(status='answered', sql='SELECT :n', parameters={'n': 1}, reason='Local test')
        for value, accepted in [(base, True), (base | {'status': 'clarify', 'sql': ''}, True),
                (base | {'status': 'refused', 'sql': ''}, True), (base | {'status': 'clarify'}, False),
                (base | {'status': 'success'}, False), (base | {'parameters': {'n': True}}, False),
                (base | {'permissions': 'admin'}, False)]:
            with self.subTest(value=value):
                if accepted:
                    Answer.parse(value)
                else:
                    with self.assertRaises(ValueError):
                        Answer.parse(value)

    def test_authenticated_model_receipts(self):
        """One loopback shell test: auth crosses the seam; credentials do not persist."""
        observed = []
        secret = 'local-model-fixture-key'

        class Model(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                observed.append((self.headers.get('Authorization'), body))
                reply = json.dumps(dict(id='provider-receipt', model='fixed-fixture',
                    usage={'prompt_tokens': 10, 'completion_tokens': 5},
                    choices=[dict(message={'content': json.dumps(dict(status='refused', sql='',
                        parameters={}, reason='Transport fixture; no model inference'))})])).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(reply)))
                self.end_headers()
                self.wfile.write(reply)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        thread = Thread(target=server.serve_forever)
        thread.start()
        try:
            with TemporaryDirectory() as temporary:
                output = Path(temporary) / 'run'
                result = subprocess.run([sys.executable, str(Path(__file__).with_name('evaluate.py')),
                    '--endpoint', f'http://127.0.0.1:{server.server_port}/chat/completions',
                    '--model', 'fixed-fixture', '--api-key-env', 'SEMANTIC_TEST_KEY',
                    '--non-thinking', '--output', str(output)],
                    env=dict(os.environ, SEMANTIC_TEST_KEY=secret), capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(len(observed), 273)
                self.assertTrue(all(auth == 'Bearer ' + secret for auth, _ in observed))
                self.assertTrue(all(body['thinking'] == {'type': 'disabled'} for _, body in observed))
                self.assertEqual(len(list(output.glob('*.provider.json'))), 273)
                self.assertEqual(json.loads((output / 'A-1-B01.provider.json').read_text())['id'], 'provider-receipt')
                self.assertTrue(all(secret not in p.read_text() for p in output.glob('*.json')))
        finally:
            server.shutdown()
            thread.join()
            server.server_close()
