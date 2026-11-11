"""Actual ACP pipe/process boundary: failed launches must settle their request."""
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import tempfile
import time
import unittest

from bundle import ROOT, load_identity
from dispatch import ACCEPTANCE, task_prompt


class AcpExecutionTests(unittest.TestCase):
    def test_process_io_failures_return_error_and_retained_notice(self):
        identity = load_identity()
        for failure in ('missing_executable', 'blocked_output_directory'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temporary:
                workspace = Path(temporary)
                executable = sys.executable
                if failure == 'missing_executable':
                    executable = str(workspace / 'missing-python')
                else:
                    (workspace / 'pybamm-results').write_text('not a directory')
                process = subprocess.Popen([sys.executable, '-c',
                    'import acp,asyncio,sys; from pathlib import Path; '
                    'acp.sys.executable=sys.argv[2]; asyncio.run(acp.serve(Path(sys.argv[1]).resolve()))',
                    str(workspace), executable], cwd=ROOT, stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                buffer = b''
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout, selectors.EVENT_READ)
                    def request(value):
                        process.stdin.write((json.dumps(value) + '\n').encode())
                        process.stdin.flush()
                    def response():
                        nonlocal buffer
                        deadline = time.monotonic() + 10
                        while b'\n' not in buffer:
                            self.assertTrue(selector.select(max(0, deadline - time.monotonic())),
                                            'ACP request hung after process I/O failure')
                            chunk = os.read(process.stdout.fileno(), 65536)
                            self.assertTrue(chunk, 'ACP exited without settling request')
                            buffer += chunk
                        line, buffer = buffer.split(b'\n', 1)
                        return json.loads(line)
                    try:
                        request({'id': 1, 'method': 'initialize'})
                        self.assertIn('result', response())
                        request({'id': 2, 'method': 'session/new', 'params': {'cwd': temporary}})
                        session = response()['result']['sessionId']
                        prompt = task_prompt('c05-t298', identity.sha256) + '\n\nAcceptance criteria:\n' + ACCEPTANCE
                        request({'id': 3, 'method': 'session/prompt', 'params': {'sessionId': session,
                                 'prompt': [{'text': prompt}]}})
                        notice = response()['params']['update']['content']['text']
                        self.assertTrue(notice.startswith('PERO_PYBAMM_ERROR '), notice)
                        result = response()
                        self.assertEqual(result['id'], 3)
                        self.assertEqual(result['error']['code'], -32603)
                        self.assertIn('FileNotFoundError' if failure == 'missing_executable' else 'NotADirectoryError',
                                      result['error']['message'])
                        process.stdin.close()
                        self.assertEqual(process.wait(timeout=10), 0)
                        self.assertEqual(process.stderr.read(), b'')
                    finally:
                        if process.poll() is None:
                            process.kill()
                            process.wait()
                        for stream in (process.stdin, process.stdout, process.stderr):
                            stream.close()
