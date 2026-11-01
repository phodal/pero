"""Real test-owned parent termination, with each platform's Host ownership model."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[1] / 'backend'
sys.path.insert(0, str(BACKEND))
from server import PreviewRunner


class LifetimeTest(unittest.TestCase):
    def test_assignment_failure_never_delivers_input_and_reaps(self):
        real_popen = subprocess.Popen
        children = []
        def launch(*args, **kwargs):
            child = real_popen(*args, **kwargs)
            children.append(child)
            return child
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'executed'
            code = 'import sys,pathlib;sys.stdin.buffer.read();pathlib.Path(sys.argv[1]).write_text("executed")'
            with patch('server.subprocess.Popen', side_effect=launch), patch('server.WorkerJob') as job:
                job.return_value.assign.side_effect = OSError('Cannot establish owned job')
                status, response = PreviewRunner([sys.executable, '-c', code, str(marker)]).run(b'{}')
            self.assertEqual(status, 500)
            self.assertIn('ownership', response['error'])
            self.assertIsNotNone(children[0].poll())
            self.assertFalse(marker.exists())

    def test_forced_parent_exit_terminates_owned_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            ready = Path(directory) / 'worker-ready'
            child_code = 'import sys,os,pathlib,threading;sys.stdin.buffer.read();pathlib.Path(sys.argv[1]).write_text(str(os.getpid()));threading.Event().wait()'
            parent_code = 'import sys;sys.path.insert(0,sys.argv[1]);from server import PreviewRunner;PreviewRunner([sys.executable,"-c",sys.argv[2],sys.argv[3]]).run(b"{}")'
            parent = subprocess.Popen([sys.executable, '-c', parent_code, str(BACKEND), child_code, str(ready)],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, start_new_session=os.name != 'nt')
            child_pid = None
            handle = None
            api = None
            try:
                deadline = time.monotonic() + 10
                while True:
                    try:
                        ready_pid = ready.read_text().strip()
                    except FileNotFoundError:
                        ready_pid = ''
                    if ready_pid:
                        break
                    if parent.poll() is not None:
                        self.fail('Parent exited before bound worker readiness: ' + parent.stderr.read().decode())
                    if time.monotonic() >= deadline:
                        self.fail('Worker did not acknowledge input within the readiness deadline')
                    time.sleep(0.01)
                child_pid = int(ready_pid)
                if os.name == 'nt':
                    api = ctypes.WinDLL('kernel32', use_last_error=True)
                    api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
                    api.OpenProcess.restype = wintypes.HANDLE
                    api.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
                    api.WaitForSingleObject.restype = wintypes.DWORD
                    api.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
                    api.TerminateProcess.restype = wintypes.BOOL
                    api.CloseHandle.argtypes = [wintypes.HANDLE]
                    api.CloseHandle.restype = wintypes.BOOL
                    handle = api.OpenProcess(0x00100001, False, child_pid)  # SYNCHRONIZE | TERMINATE (failure cleanup)
                    self.assertTrue(handle, 'Open the live child before killing its parent')
                    self.assertEqual(api.WaitForSingleObject(handle, 0), 258)  # WAIT_TIMEOUT: still alive
                    # Mirrors Windows Host: only the backend parent is killed.
                    parent.kill()
                    parent.wait(timeout=5)
                    self.assertEqual(api.WaitForSingleObject(handle, 5000), 0, 'Kill-on-close must terminate the child')
                else:
                    # Mirrors Unix Host: terminate the test-owned backend group.
                    self.assertEqual(os.getpgid(parent.pid), parent.pid)
                    os.killpg(parent.pid, signal.SIGKILL)
                    parent.wait(timeout=5)
                    deadline = time.monotonic() + 5
                    while True:
                        state = subprocess.run(['ps', '-o', 'stat=', '-p', str(child_pid)], capture_output=True, text=True, check=False).stdout.strip()
                        if not state or state.startswith('Z'):
                            break
                        if time.monotonic() >= deadline:
                            self.fail('Worker remains running after its owned group was terminated')
                        time.sleep(0.01)
            finally:
                if parent.poll() is None:
                    if os.name == 'nt':
                        parent.kill()
                    else:
                        os.killpg(parent.pid, signal.SIGKILL)
                    parent.wait(timeout=5)
                if handle:
                    if api.WaitForSingleObject(handle, 0) == 258:
                        api.TerminateProcess(handle, 1)  # Only this test-owned child, without hiding the failed assertion.
                        api.WaitForSingleObject(handle, 5000)
                    api.CloseHandle(handle)
                parent.stderr.close()


if __name__ == '__main__':
    unittest.main()
