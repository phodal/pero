"""Fixed Host transport operations, run with the selected site's Python 3.

This is process/file I/O, not a scheduler. The caller owns approval and Use state.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import time

SUPERVISOR = r'''
import json, os, signal, subprocess, sys, time
from pathlib import Path
root, operation, program, arguments = sys.argv[1:]
root = Path(root)
def save(value):
    temporary = root / '.process.pending'
    with temporary.open('w') as file:
        json.dump(value, file)
        file.flush()
        os.fsync(file.fileno())
    temporary.replace(root / '.process.json')
def birth(pid):
    return subprocess.run(['ps', '-p', str(pid), '-o', 'lstart='], text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.strip()
def exists(group):
    try:
        os.killpg(group, 0)
        return True
    except ProcessLookupError:
        return False
with (root / 'stdout.log').open('wb') as out, (root / 'stderr.log').open('wb') as err:
    read_gate, write_gate = os.pipe()
    launcher = "import os,sys,json; fd=int(sys.argv[1]); allowed=os.read(fd,1); os.close(fd); sys.exit(125) if allowed != b'1' else None; os.execv(sys.argv[2],[sys.argv[2],*json.loads(sys.argv[3])])"
    process = subprocess.Popen([sys.executable, '-c', launcher, str(read_gate), program, arguments], cwd=root,
                               stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                               pass_fds=(read_gate,), start_new_session=True)
    os.close(read_gate)
    stamp = birth(process.pid)
    if not stamp:
        raise RuntimeError('Remote process birth identity unavailable')
    value = {'operation': operation, 'pid': process.pid, 'birth': stamp,
             'started_ms': time.time_ns() // 1000000, 'ended_ms': None,
             'running': True, 'exit_code': None, 'stop_requested': False}
    save(value)
    os.write(write_gate, b'1')
    os.close(write_gate)
    code = process.wait()
    # Clean any descendants in the original group before confirming stop.
    if exists(process.pid):
        os.killpg(process.pid, signal.SIGKILL)
    deadline = time.monotonic() + 2
    while exists(process.pid) and time.monotonic() < deadline:
        time.sleep(.02)
    if exists(process.pid):
        value['unknown'] = 'Original process group stop is unconfirmed'
    else:
        value.update(running=False, ended_ms=time.time_ns() // 1000000,
                     exit_code=code if code >= 0 else 128 - code)
    save(value)
'''


def birth(pid):
    return subprocess.run(['ps', '-p', str(pid), '-o', 'lstart='], text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.strip()


def filename(name):
    if not isinstance(name, str) or not name or name.startswith('.') or '/' in name or '\\' in name:
        raise ValueError('Transport file names must be a visible path component')
    return name


def observation(root, operation):
    intent = json.loads((root / '.start.json').read_text())
    if intent['operation'] != operation:
        raise ValueError('Remote operation identity changed')
    value = json.loads((root / '.process.json').read_text())
    if value['operation'] != operation or not value.get('birth'):
        raise ValueError('Remote process identity changed or is unavailable')
    if value.get('unknown'):
        raise ValueError(value['unknown'])
    deadline = time.monotonic() + 1
    while value['running'] and birth(value['pid']) != value['birth']:
        # A fast method may have exited while its supervisor publishes terminal
        # facts. Wait for that observable file effect before declaring unknown.
        if time.monotonic() >= deadline:
            raise ValueError('Original remote process is absent; stop is unconfirmed')
        time.sleep(.01)
        value = json.loads((root / '.process.json').read_text())
    value['stop_requested'] = (root / '.cancel').exists()
    return value


request = json.load(sys.stdin)
action = request['action']
if action == 'probe':
    value = {'hostname': platform.node(), 'system': platform.system(),
             'architecture': platform.machine(), 'python': platform.python_version()}
else:
    root = Path(request['directory'])
    if not root.is_absolute():
        raise ValueError('Remote attempt directory must be absolute')
    if action == 'stage':
        root.mkdir(mode=0o700, parents=True, exist_ok=False)
        for file in request['files']:
            name = filename(file['name'])
            target = root / name
            target.write_bytes(base64.b64decode(file['bytes'], validate=True))
            target.chmod(0o700 if file['executable'] else 0o600)
        value = {'staged': True}
    elif action == 'start':
        operation = request['operation']
        for name, expected in request['expected']:
            target = root / filename(name)
            if target.is_symlink() or hashlib.sha256(target.read_bytes()).hexdigest() != expected:
                raise ValueError('Frozen input changed before dispatch: ' + name)
        with (root / '.start.json').open('x') as file:
            json.dump({'operation': operation}, file)
            file.flush()
            os.fsync(file.fileno())
        program = request['program']
        if program == 'python3':
            program = sys.executable
        elif not Path(program).is_absolute():
            program = str(root / filename(program))
        with (root / 'supervisor.log').open('wb') as log:
            subprocess.Popen([sys.executable, '-c', SUPERVISOR, str(root), operation,
                              program, json.dumps(request['arguments'])], cwd=root,
                             stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                             start_new_session=True, close_fds=True)
        deadline = time.monotonic() + 5
        while not (root / '.process.json').exists() and time.monotonic() < deadline:
            time.sleep(.01)
        value = observation(root, operation)
    elif action in ('observe', 'cancel'):
        value = observation(root, request['operation'])
        if action == 'cancel' and value['running']:
            (root / '.cancel').touch(exist_ok=True)
            # Check the original birth stamp before signalling the recorded group.
            try:
                os.killpg(value['pid'], signal.SIGKILL)
            except ProcessLookupError:
                pass  # The supervisor's terminal file below is authoritative.
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                terminal = json.loads((root / '.process.json').read_text())
                if not terminal['running'] or terminal.get('unknown'):
                    break
                time.sleep(.02)
            value = observation(root, request['operation'])
    elif action == 'collect':
        value = []
        total = 0
        for name in request['names']:
            target = root / filename(name)
            if target.is_symlink() or not target.is_file():
                raise ValueError('Output is missing or is not a regular file: ' + name)
            with target.open('rb') as file:
                data = file.read(1024 * 1024 + 1)
            total += len(data)
            if len(data) > 1024 * 1024 or total > 4 * 1024 * 1024:
                raise ValueError('Output collection limit exceeded; remote paths are retained')
            value.append({'name': name, 'bytes': base64.b64encode(data).decode(),
                          'sha256': hashlib.sha256(data).hexdigest()})
    else:
        raise ValueError('Unsupported transport operation')
print(json.dumps(value))
