"""Opt-in deployed HTTPS acceptance using one enrolled Worker and real PyBaMM."""
import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import select
import signal
import socket
import socketserver
import subprocess
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlparse
import uuid

from bundle import ROOT, load_identity
from check import read_results
from contract import digest
from dispatch import ACCEPTANCE, Binding, Observation, summarize, task_prompt
from tasks import ControlPlane, save


def wait_for(condition, label, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = condition()
        if value:
            return value
        time.sleep(0.02)  # Poll actual process, journal or remote API state.
    raise TimeoutError(label)


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


class WorkerEgress(socketserver.ThreadingTCPServer):
    """CONNECT-only fault boundary; TLS remains between Worker and deployed server."""
    daemon_threads = True

    def __init__(self, host):
        self.host = host
        self.connected = threading.Event()
        self.connected.set()
        self.sockets = set()
        self.lock = threading.Lock()
        self.tunnels = 0
        super().__init__(('127.0.0.1', 0), Tunnel)
        self.thread = threading.Thread(target=self.serve_forever, daemon=True)
        self.thread.start()

    @property
    def origin(self):
        return f'http://127.0.0.1:{self.server_address[1]}'

    def disconnect(self):
        self.connected.clear()
        with self.lock:
            for stream in self.sockets:
                stream.shutdown(socket.SHUT_RDWR)

    def close(self):
        self.disconnect()
        self.shutdown()
        self.server_close()
        self.thread.join(timeout=2)


class Tunnel(socketserver.StreamRequestHandler):
    def handle(self):
        request = self.rfile.readline(8192).decode('ascii').split()
        while self.rfile.readline(8192).strip():
            pass
        if request[:2] != ['CONNECT', self.server.host + ':443'] or not self.server.connected.is_set():
            self.wfile.write(b'HTTP/1.1 503 Worker egress blocked\r\n\r\n')
            return
        try:
            with socket.create_connection((self.server.host, 443), timeout=10) as upstream:
                peers = (self.connection, upstream)
                with self.server.lock:
                    self.server.sockets.update(peers)
                    self.server.tunnels += 1
                try:
                    self.wfile.write(b'HTTP/1.1 200 Connection established\r\n\r\n')
                    while self.server.connected.is_set():
                        ready, _, _ = select.select(peers, [], [], 0.1)
                        for source in ready:
                            data = source.recv(65536)
                            if not data:
                                return
                            peers[1 if source is peers[0] else 0].sendall(data)
                finally:
                    with self.server.lock:
                        self.server.sockets.difference_update(peers)
        except OSError:
            return  # Closing the selected tunnel is the intended injected failure.


def main(args):
    os.umask(0o077)
    origin = args.origin.rstrip('/')
    parsed = urlparse(origin)
    if parsed.scheme != 'https' or parsed.port not in (None, 443):
        raise ValueError('This acceptance requires deployed HTTPS on port 443')
    operator = json.loads(args.operator_file.read_text())['token']
    api = ControlPlane(origin, operator)
    if api.request('/api/v1/me')['role'] != 'operator':
        raise ValueError('Operator credential required for dedicated acceptance provisioning')
    identity = load_identity()
    experiment = identity.method.experiments[0].id
    reference = read_results(ROOT / 'reference.jsonl')[experiment]
    worker_bin = args.worker_bin.resolve(strict=True)
    python = args.python.absolute()
    # Preflight before any remote writes. Preserve the selected venv executable path.
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    subprocess.run([str(python), str(ROOT / 'run.py'), experiment, str(output / 'preflight.jsonl')],
                   check=True, stdout=(output / 'preflight.log').open('w'), stderr=subprocess.STDOUT)
    nonce = uuid.uuid4().hex
    project = 'selfhost-' + nonce[:16]
    workspace = output / 'workspace'
    workspace.mkdir()
    enrollment = {'device_id': 'acceptance-' + nonce, 'request_id': nonce,
                  'name': 'Self-hosted HTTPS acceptance ' + nonce[:8], 'projects': [project],
                  'capabilities': [{'project_id': project, 'workspace_key': 'battery', 'agent_id': 'pybamm-sweep-v1'}],
                  'enrollment_secret': os.urandom(32).hex()}
    # Durable original enrollment identity permits manual reconciliation of a lost reply.
    save(output / 'enrollment.private.json', enrollment)
    credential = api.request('/api/v1/workers/enroll', enrollment)
    worker_id = credential['worker']['id']
    save(output / 'worker.private.json', credential)
    save(output / 'agents.json', [{'id': 'pybamm-sweep-v1', 'name': 'Frozen PyBaMM method',
         'command': str(python), 'args': [str(ROOT / 'acp.py'), '--workspace', str(workspace)], 'env': {}}])
    save(output / 'config.json', {'workspaces': {'battery': str(workspace)},
                                'agents_file': str(output / 'agents.json')})
    journal = output / 'journal.json'
    worker_env = {key: value for key, value in os.environ.items()
                  if not key.startswith('PERO_') and key.upper() not in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY')}
    worker_env.update(PERO_CLOUD_URL=origin, PERO_WORKER_TOKEN=credential['token'],
                      PERO_WORKER_CONFIG=str(output / 'config.json'), PERO_WORKER_STATE=str(journal))
    receipt = {'origin': origin, 'project': project, 'worker_id': worker_id,
               'observed_at': datetime.now(timezone.utc).isoformat(),
               'method_sha256': identity.sha256, 'worker_sha256': digest(worker_bin.read_bytes()),
               'cases': [], 'worker_disabled': False, 'scientific_acceptance': 'not_assessed',
               'limits': ['One deployed control plane and one local execution machine.',
                          'Fixed numerical ACP method, no model calls or general Agent tool approval.',
                          'Connection loss is injected only at this Worker CONNECT proxy.',
                          'Reconcile and its Worker fence remain for explicit operator review.']}
    save(output / 'receipt.json', receipt)
    processes, logs, tasks, children = [], [], [], []
    egress = WorkerEgress(parsed.hostname)

    def launch(name, proxy=False):
        log = (output / (name + '.log')).open('w')
        logs.append(log)
        env = {**worker_env, **({'HTTPS_PROXY': egress.origin} if proxy else {})}
        process = subprocess.Popen([str(worker_bin), '--once'], env=env, stdout=log, stderr=subprocess.STDOUT)
        processes.append(process)
        return process

    def started():
        if not journal.exists():
            return None
        active = json.loads(journal.read_text()).get('active') or {}
        for event in active.get('events', []):
            text = (event.get('data') or {}).get('content', {}).get('text', '')
            if text.startswith('PERO_PYBAMM_START '):
                return json.loads(text.removeprefix('PERO_PYBAMM_START '))
        return None

    try:
        for case in ('calculation', 'cancellation', 'connection-loss'):
            key = project + '-' + case
            spec = {'title': 'Self-hosted acceptance: ' + case, 'project_id': project,
                    'workspace_key': 'battery', 'agent_id': 'pybamm-sweep-v1',
                    'prompt': task_prompt(experiment, identity.sha256), 'acceptance': ACCEPTANCE}
            task = api.request('/api/v1/tasks', spec, key + '-task')
            tasks.append(task['id'])
            run = api.request('/api/v1/tasks/' + task['id'] + '/dispatch', {'worker_id': worker_id}, key + '-run')
            binding = Binding(experiment, worker_id, task['id'], run['id'])
            row = {'case': case, 'task_id': task['id'], 'run_id': run['id'], 'passed': False}
            receipt['cases'].append(row)
            save(output / 'receipt.json', receipt)
            assert api.request('/api/v1/tasks', spec, key + '-task')['id'] == task['id']
            assert api.request('/api/v1/tasks/' + task['id'] + '/dispatch',
                               {'worker_id': worker_id}, key + '-run')['id'] == run['id']
            process = launch(case, proxy=case == 'connection-loss')
            if case != 'calculation':
                start = wait_for(started, 'Actual calculation child-start journal event')
                children.append(start['pid'])
                os.kill(start['pid'], signal.SIGSTOP)
                row['child_pid'] = start['pid']
                save(output / (case + '-active-journal.json'), json.loads(journal.read_text()))
                if case == 'cancellation':
                    api.request('/api/v1/tasks/' + task['id'] + '/cancel', {})
                else:
                    assert egress.tunnels > 0, 'Worker did not use the dedicated CONNECT proxy'
                    egress.disconnect()
                wait_for(lambda: not alive(start['pid']), 'Execution child must stop', timeout=180)
            wait_for(lambda: process.poll() is not None, 'Worker exit', timeout=180)
            row['worker_exit'] = process.returncode
            if case == 'connection-loss':
                save(output / 'disconnected-journal.json', json.loads(journal.read_text()))
                egress.connected.set()
                recovered = launch('recovered', proxy=True)
                wait_for(lambda: recovered.poll() is not None, 'Original-journal recovery')
                row['recovery_exit'] = recovered.returncode
                row['proxy_tunnels'] = egress.tunnels
            detail = api.request('/api/v1/tasks/' + task['id'])
            save(output / (case + '-detail.json'), detail)
            observed = Observation.parse(detail)
            assert observed.run == binding.run and observed.worker == worker_id
            expected = {'calculation': 'succeeded', 'cancellation': 'cancelled', 'connection-loss': 'reconcile'}[case]
            assert observed.status == expected, (case, observed.status)
            starts = sum((event.get('data') or {}).get('content', {}).get('text', '').startswith(
                'PERO_PYBAMM_START ') for event in detail['events'])
            if case == 'connection-loss':
                retained = list(journal.with_suffix('.retained').glob('*.json'))
                assert len(retained) == 1, 'Unuploaded execution evidence must survive recovery'
                local = json.loads(retained[0].read_text())
                assert local['run']['id'] == binding.run
                local_starts = sum((event.get('data') or {}).get('content', {}).get('text', '').startswith(
                    'PERO_PYBAMM_START ') for event in local['events'])
                assert local_starts == 1 and starts <= 1, 'Original prompt was missing or replayed'
                row['retained_local_starts'] = local_starts
            else:
                assert starts == 1, 'Original prompt was missing or replayed'
            if case == 'calculation':
                result = summarize(binding, observed, reference, identity)
                save(output / 'calculation-check.json', asdict(result))
                assert result.verification == 'consistent', result.reason
                assert process.returncode == 0
                row['result_sha256'] = result.result_sha256
            row.update(passed=True, status=observed.status, events=len(detail['events']), starts=starts)
            save(output / 'receipt.json', receipt)
        assert len(list(workspace.glob('pybamm-results/*'))) == 3, 'Unexpected additional calculation attempt'
        assert digest(worker_bin.read_bytes()) == receipt['worker_sha256'], 'Worker binary changed during acceptance'
        receipt['passed'] = True
    finally:
        egress.connected.set()
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        # Faults retain their Run; settle only this invocation's active tasks.
        for task in tasks:
            detail = api.request('/api/v1/tasks/' + task)
            if detail['run']['status'] in ('queued', 'running', 'cancel_requested'):
                api.request('/api/v1/tasks/' + task + '/cancel', {})
        for pid in children:
            if alive(pid):
                receipt['cleanup_forced'] = True
                os.kill(pid, signal.SIGKILL)
        try:
            api.request('/api/v1/workers/' + worker_id + '/disable', {})
            receipt['worker_disabled'] = True
        except HTTPError as error:
            if error.code != 409:
                raise
            receipt['worker_retained_reason'] = 'Original unresolved Run fences credential disable; operator review required.'
        receipt['passed'] = bool(receipt.get('passed') and not receipt.get('cleanup_forced'))
        save(output / 'receipt.json', receipt)
        egress.close()
        for log in logs:
            log.close()
    print(json.dumps(receipt, indent=2))
    if not receipt['passed']:
        raise RuntimeError('Acceptance incomplete; inspect retained receipt and logs')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-live', action='store_true', required=True,
                        help='Explicitly allow dedicated project/device/task writes to the deployed service')
    parser.add_argument('--origin', default='https://app.openpero.com')
    for option in ('operator-file', 'worker-bin', 'python', 'output'):
        parser.add_argument('--' + option, required=True, type=Path)
    main(parser.parse_args())
