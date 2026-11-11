#!/usr/bin/env python3
"""Opt-in real loopback acceptance after the Rust locked-profile preparation test.

Usage: python3.14 scripts/verification/uv-control.py /absolute/PERO_UV_LIVE_HOME
This mutates only the disposable evidence home, never normal user App data.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import select
import subprocess
import sys
import time
import urllib.error
import urllib.request

root = Path(sys.argv[1]).resolve()
repository = Path(__file__).resolve().parents[2]
profiles = json.loads((root / 'profiles.json').read_text())
first, rebuilt = [next(p['prepared'] for p in profiles if p['label'] == label) for label in ('first', 'rebuild')]
data = root / 'app-data' / 'control-lab'
binding = data / '.compute' / 'binding.json'
# These are the exact profiles prepared and bound through AppStore in the Rust gate.
def bind(value):
    pending = binding.with_suffix('.pending')
    pending.write_text(json.dumps(value))
    pending.replace(binding)

bind(first)
secret = 'disposable-local-verification-token'
service_log = (root / 'service.log').open('w')
def start_service():
    process = subprocess.Popen([sys.executable, '-E', '-s', '-B', str(repository / 'apps/control-lab/backend/server.py')],
        env={**{k: os.environ[k] for k in ('HOME', 'PATH', 'TMPDIR') if k in os.environ},
             'PERO_APP_DATA': str(data), 'PERO_APP_TOKEN': secret},
        stdout=subprocess.PIPE, stderr=service_log, text=True)
    assert select.select([process.stdout], [], [], 15)[0], 'service readiness deadline'
    return process, json.loads(process.stdout.readline())['port']

service, port = start_service()
try:
    def request(path, body=None, status=200):
        req = urllib.request.Request(f'http://127.0.0.1:{port}{path}',
            data=json.dumps(body).encode() if body is not None else None,
            headers={'X-Pero-App-Token': secret, 'Content-Type': 'application/json'})
        try:
            response = urllib.request.urlopen(req, timeout=45)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            result = json.load(response)
            assert response.status == status, (response.status, result)
            return result

    def create():
        return request('/api/experiments', {'templateId': 'pi-golden', 'parameters': {'horizon': 8, 'samples': 1001}}, 201)

    def action(record, operation, status=200):
        return request('/api/agent-step', {'action': operation, 'experimentId': record['id'], 'specHash': record['specHash']}, status)

    def finished(record):
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            value = request('/api/experiments/' + record['id'])
            if value['status'] != 'running':
                return value
            time.sleep(.05)  # Bounded poll of the external service's durable state.
        raise AssertionError('Scientific attempt deadline')

    original = create()
    action(original, 'baseline')
    completed = finished(original)
    assert completed['trials'][0]['status'] == 'completed', completed
    trial = completed['trials'][0]
    reference = next(s for s in trial['observation']['series'] if s['name'] == 'reference')
    error = max(abs(y - (1 - math.exp(-x))) for x, y in zip(reference['x'], reference['y']))
    assert error < 1e-10, error
    exported = request('/api/experiments/' + original['id'] + '/export')
    (root / 'original-export.json').write_text(json.dumps(exported, sort_keys=True))
    artifact = next(a for a in exported['artifacts'] if a['name'] == 'compute-profile.json')
    assert json.loads(artifact['text']) == first
    bind(rebuilt)
    refusal = action(original, 'verify', 400)
    # Lock first so the next rejection exercises runtime identity, not candidate admission.
    request('/api/experiments/' + original['id'] + '/lock', {'candidateId': 'baseline'})
    refusal = action(original, 'verify', 400)
    assert 'Compute selection changed' in refusal['error'], refusal
    current_export = request('/api/experiments/' + original['id'] + '/export')
    assert current_export['artifacts'] == exported['artifacts']
    replacement = create()
    action(replacement, 'baseline')
    assert finished(replacement)['trials'][0]['status'] == 'completed'
    assert service.poll() is None

    # Remove an actual dependency from the rebuilt disposable prefix. No fallback.
    package = next((Path(rebuilt['root']) / 'lib').glob('python*/site-packages/control'))
    missing = package.with_name('control.missing')
    package.rename(missing)
    try:
        failed = create()
        refusal = action(failed, 'baseline', 400)
        assert 'missing' in refusal['error'], refusal
        assert request('/api/experiments/' + failed['id'])['trials'] == []
    finally:
        missing.rename(package)
    # Equal version metadata cannot hide changed distribution bytes.
    module = package / '__init__.py'
    original_module = module.read_bytes()
    try:
        module.write_bytes(original_module + b'\n# disposable byte drift\n')
        changed = create()
        refusal = action(changed, 'baseline', 400)
        assert 'changed' in refusal['error'], refusal
    finally:
        module.write_bytes(original_module)
    # Explicitly select an intact published profile to recover, without repairing it.
    bind(first)
    recovered = create()
    action(recovered, 'baseline')
    assert finished(recovered)['trials'][0]['status'] == 'completed'

    cancelled = create()
    action(cancelled, 'baseline')
    action(cancelled, 'cancel')
    stopped = finished(cancelled)
    assert stopped['status'] == 'cancelled', stopped
    assert all(t['status'] != 'running' for t in stopped['trials'])
    assert service.poll() is None
    original_pid = service.pid
    service.terminate()
    service.wait(timeout=40)
    service, port = start_service()
    reopened = request('/api/experiments/' + original['id'] + '/export')
    assert reopened['artifacts'] == exported['artifacts']
    result = dict(service_pid=original_pid, reopened_pid=service.pid, service_python=sys.version, compute_python=first['observation']['version'],
        lock_sha256=first['lock_sha256'], analytic_max_error=error, original_attempt=trial['attemptId'],
        checks=['real numerical trial', 'same backend PID across compute selection', 'old experiment rejects new profile',
                'historical artifacts unchanged', 'missing dependency refuses before attempt', 'same-version package byte drift rejected', 'explicit binding recovery', 'scientific cancellation', 'historical export after service restart'],
        limitation='Local Control CPU integration only; no live EnvironmentUse authority or scientific acceptance')
    (root / 'verification.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
finally:
    service.terminate()
    service.wait(timeout=40)
    service_log.close()
