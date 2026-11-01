"""POSIX cancellation uses real processes, but never a scientific engine."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

from test_pcgym_reproduction import BACKEND, specification
from paper_agent.pcgym import read_json, write_json

WORKER = '''
import os, signal, sys
from pathlib import Path
root = Path(sys.argv[1])
def stopping(signum, frame):
    (root / 'cleanup-entered').write_text('worker observed owner terminate')
signal.signal(signal.SIGTERM, stopping)
(root / 'worker-ready').write_text(str(os.getpid()))
while True:
    signal.pause()
'''

OWNER = '''
import sys, signal
from pathlib import Path
from paper_agent import pcgym, pcgym_runtime
root = Path(sys.argv[1])
pcgym_runtime.preflight = lambda *args: None
original = pcgym.subprocess.Popen
def launch(args, **kwargs):
    return original([sys.executable, str(root / 'worker.py'), str(root)], **kwargs)
pcgym.subprocess.Popen = launch
previous = {name: signal.getsignal(name) for name in (signal.SIGTERM, signal.SIGINT)}
pcgym.run(root, pcgym.load_spec(root).id, confirm=True, accept_findings=True)
if any(signal.getsignal(name) != handler for name, handler in previous.items()):
    raise RuntimeError('Caller signal handlers were not restored')
'''


@unittest.skipUnless(os.name == 'posix', 'POSIX signal lifecycle; Windows termination is not certified')
class CancellationLifecycle(unittest.TestCase):
    def test_repeated_cancel_during_cleanup_reaps_worker_and_preserves_receipt(self):
        for first, second in ((signal.SIGTERM, signal.SIGTERM),
                              (signal.SIGINT, signal.SIGINT),
                              (signal.SIGTERM, signal.SIGINT),
                              (signal.SIGINT, signal.SIGTERM)):
            with self.subTest(first=first, second=second):
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    write_json(root / 'spec.json', specification().to_dict())
                    write_json(root / 'local.json', dict(interpreter=sys.executable, checkout='unused-fixture'))
                    (root / 'worker.py').write_text(WORKER)
                    owner = subprocess.Popen([sys.executable, '-c', OWNER, str(root)],
                        env={**os.environ, 'PYTHONPATH': str(BACKEND)},
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    worker_pid = None

                    def wait_for(name):
                        deadline = time.monotonic() + 10
                        while not (root / name).exists():
                            if owner.poll() is not None or time.monotonic() >= deadline:
                                self.fail(f'Owner exited or marker timed out: {name}')
                            time.sleep(.01)  # Bounded observation of a real child effect.

                    try:
                        wait_for('worker-ready')
                        worker_pid = int((root / 'worker-ready').read_text())
                        owner.send_signal(first)  # App cancel or CLI interrupt.
                        wait_for('cleanup-entered')  # Worker received terminate from owner's finally.
                        owner.send_signal(second)  # Repeated cancellation inside cleanup's wait.
                        stdout, stderr = owner.communicate(timeout=12)
                        receipts = list((root / 'attempts').glob('*/execution.json'))
                        try:
                            os.kill(worker_pid, 0)
                            worker_present = True
                        except ProcessLookupError:
                            worker_present = False
                        self.assertEqual(owner.returncode, 0,
                            f'Owner={owner.returncode}, worker_present={worker_present}, '
                            f'lock={(root / "running.lock").exists()}, '
                            f'receipts={[read_json(p)["status"] for p in receipts]}; {stderr.decode()}')
                        self.assertEqual(len(receipts), 1)
                        self.assertEqual(read_json(receipts[0])['status'], 'cancelled')
                        self.assertFalse((root / 'running.lock').exists())
                        with self.assertRaises(ProcessLookupError):
                            os.kill(worker_pid, 0)
                    finally:
                        if owner.poll() is None:
                            owner.kill()
                        owner.communicate(timeout=5)
                        if worker_pid is not None:
                            try:
                                os.kill(worker_pid, signal.SIGKILL)
                            except ProcessLookupError:
                                pass

if __name__ == '__main__':
    unittest.main()
