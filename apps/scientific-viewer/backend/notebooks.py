"""App-owned interactive Python kernels. Opening a saved notebook starts no process."""
from dataclasses import dataclass
from pathlib import Path
from queue import Empty
from copy import deepcopy
import json
import os
import sys
import threading
import time
import uuid


@dataclass(frozen=True)
class NotebookCommand:
    action: str
    session: str | None = None
    code: str = ''

    @classmethod
    def parse(cls, value):
        if not isinstance(value, dict) or set(value) - {'action', 'session', 'code'}:
            raise ValueError('Use action, session and code')
        action = value.get('action')
        if action not in ('start', 'execute', 'status', 'interrupt', 'restart', 'close'):
            raise ValueError('Unknown notebook action')
        session, code = value.get('session'), value.get('code', '')
        if action != 'start' and (not isinstance(session, str) or len(session) != 32 or any(c not in '0123456789abcdef' for c in session)):
            raise ValueError('Choose an active notebook kernel')
        if not isinstance(code, str) or len(code.encode()) > 128_000:
            raise ValueError('A code cell must be at most 128,000 bytes')
        return cls(action, session, code)


class NotebookKernel:
    def __init__(self, directory):
        from jupyter_client import KernelManager
        directory.mkdir(parents=True, exist_ok=True)
        self.manager = KernelManager(kernel_name='python3')
        self.manager.kernel_spec.argv = [sys.executable, '-m', 'ipykernel_launcher', '-f', '{connection_file}']
        self.client = None
        self.lock = threading.Lock()
        self.state = dict(status='idle', outputs=[], execution_count=None, error='')
        try:
            env = {key: value for key, value in os.environ.items() if key != 'PERO_APP_TOKEN'}
            self.manager.start_kernel(cwd=str(directory), env=env)
            self.client = self.manager.client()
            self.client.start_channels()
            self.client.wait_for_ready(timeout=20)
        except Exception:
            self.close()
            raise

    def snapshot(self):
        with self.lock:
            return deepcopy(self.state)

    def close(self):
        with self.lock:
            if self.state['status'] == 'closed':
                return
            self.state['status'] = 'closed'
        self.manager.shutdown_kernel(now=True)
        if self.client:
            self.client.stop_channels()

    def execute(self, code):
        with self.lock:
            if self.state['status'] != 'idle':
                raise ValueError('Kernel is busy or closed')
            self.state = dict(status='running', outputs=[], execution_count=None, error='')
        threading.Thread(target=self._execute, args=(code,), daemon=True).start()

    def _execute(self, code):
        deadline, size = time.monotonic() + 120, 0
        try:
            request = self.client.execute(code, allow_stdin=False, stop_on_error=True)
            while self.manager.is_alive():
                if time.monotonic() >= deadline:
                    raise TimeoutError('Cell exceeded 120 seconds; kernel stopped')
                try:
                    message = self.client.get_iopub_msg(timeout=1)
                except Empty:
                    continue
                if message.get('parent_header', {}).get('msg_id') != request:
                    continue
                kind, content = message['msg_type'], message['content']
                if kind == 'status' and content['execution_state'] == 'idle':
                    with self.lock:
                        if self.state['status'] != 'closed':
                            self.state['status'] = 'idle'
                    return
                if kind == 'execute_input':
                    with self.lock:
                        self.state['execution_count'] = content['execution_count']
                elif kind in ('stream', 'display_data', 'execute_result', 'error'):
                    output = {**content, 'output_type': kind}
                    size += len(json.dumps(output).encode())
                    if size > 4 * 1024 * 1024:
                        raise ValueError('Cell output exceeded 4 MiB; kernel stopped')
                    with self.lock:
                        self.state['outputs'].append(output)
                elif kind == 'clear_output':
                    with self.lock:
                        self.state['outputs'] = []
            raise RuntimeError('Python kernel exited')
        except Exception as error:
            with self.lock:
                if self.state['status'] != 'closed':
                    self.state['error'] = str(error)
            self.close()


class Notebooks:
    def __init__(self, data):
        self.directory = Path(data) / 'notebooks'
        self.sessions = {}
        self.lock = threading.Lock()

    def dispatch(self, command):
        if command.action == 'start':
            with self.lock:
                if len(self.sessions) >= 4:
                    raise ValueError('Close a kernel before opening another notebook')
                identity = uuid.uuid4().hex
                kernel = NotebookKernel(self.directory / identity)
                self.sessions[identity] = kernel
            return dict(session=identity, **kernel.snapshot())
        with self.lock:
            kernel = self.sessions.get(command.session)
        if kernel is None:
            raise ValueError('Notebook kernel is no longer available; start a new kernel')
        if command.action == 'execute':
            kernel.execute(command.code)
        elif command.action == 'interrupt':
            kernel.manager.interrupt_kernel()
        elif command.action == 'restart':
            status = kernel.snapshot()['status']
            if status == 'running':
                raise ValueError('Interrupt the running cell before restarting')
            if status == 'closed':
                with self.lock:
                    kernel = NotebookKernel(self.directory / command.session)
                    self.sessions[command.session] = kernel
            else:
                kernel.manager.restart_kernel(now=True)
                kernel.client.wait_for_ready(timeout=20)
                with kernel.lock:
                    kernel.state = dict(status='idle', outputs=[], execution_count=None, error='')
        elif command.action == 'close':
            kernel.close()
            with self.lock:
                self.sessions.pop(command.session, None)
        return dict(session=command.session, **kernel.snapshot())

    def close(self):
        with self.lock:
            kernels, self.sessions = list(self.sessions.values()), {}
        for kernel in kernels:
            kernel.close()
