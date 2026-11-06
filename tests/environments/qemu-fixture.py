#!/usr/bin/env python3
"""Explicit macOS ARM QEMU fixture. Downloads/installations remain separate.

python qemu-fixture.py create --base IMAGE --sha512-file HASH --directory NEW_DIR
python qemu-fixture.py stop --directory NEW_DIR
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
import uuid


def qmp(path, command, arguments=None):
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(10)
        connection.connect(str(path))
        with connection.makefile('rwb') as stream:
            json.loads(stream.readline())
            for request in ({'execute': 'qmp_capabilities'},
                            {'execute': command, **({'arguments': arguments} if arguments else {})}):
                stream.write((json.dumps(request) + '\n').encode())
                stream.flush()
                while True:
                    response = json.loads(stream.readline())
                    if 'event' not in response:
                        break
                if 'error' in response:
                    raise RuntimeError(response['error'])
            return response['return']


def create(args):
    base = args.base.resolve(strict=True)
    expected = args.sha512_file.read_text().strip().split()[0]
    with base.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha512').hexdigest()
    if actual != expected:
        raise ValueError('Official base-image SHA-512 does not match')
    root = args.directory.absolute()
    root.mkdir(parents=True, exist_ok=False)
    root = root.resolve()
    instance = str(uuid.uuid4())
    socket_root = Path(tempfile.mkdtemp(prefix='pero-qemu-'))
    control = socket_root / 'qmp.sock'
    seed = root / 'seed'
    seed.mkdir()
    subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(root / 'key')], check=True)
    key = (root / 'key.pub').read_text().strip()
    (seed / 'meta-data').write_text(f'instance-id: {instance}\nlocal-hostname: pero-validation\n')
    # Alpine's default user is alpine; cloud-init owns its key and account setup.
    (seed / 'user-data').write_text(f'#cloud-config\nssh_authorized_keys:\n  - {key}\nssh_pwauth: false\n')
    subprocess.run(['hdiutil', 'makehybrid', '-iso', '-joliet', '-default-volume-name', 'cidata',
                    '-o', str(root / 'seed.iso'), str(seed)], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['qemu-img', 'create', '-f', 'qcow2', '-F', 'qcow2', '-b', str(base),
                    str(root / 'overlay.qcow2'), '4G'], check=True, stdout=subprocess.DEVNULL)
    record = dict(instance=instance, base=str(base), base_sha512=actual, qmp=str(control),
                  directory=str(root), state='preparing', user='alpine')
    (root / 'resource.json').write_text(json.dumps(record, indent=2))
    subprocess.run(['qemu-system-aarch64', '-machine', 'virt,accel=hvf', '-cpu', 'host',
                    '-smp', '2', '-m', '1024', '-uuid', instance,
                    '-bios', str(args.firmware),
                    '-drive', f'file={root}/overlay.qcow2,if=virtio,format=qcow2',
                    '-drive', f'file={root}/seed.iso,if=virtio,format=raw,readonly=on',
                    '-netdev', 'user,id=net0,restrict=on,hostfwd=tcp:127.0.0.1:0-:22',
                    '-device', 'virtio-net-pci,netdev=net0', '-display', 'none',
                    '-serial', f'file:{root}/console.log', '-qmp', f'unix:{control},server=on,wait=off',
                    '-pidfile', str(root / 'pid'), '-daemonize'], check=True)
    if qmp(control, 'query-uuid')['UUID'] != instance:
        raise RuntimeError('QEMU resource identity changed')
    network = qmp(control, 'human-monitor-command', {'command-line': 'info usernet'})
    port = int(re.search(r'TCP\[HOST_FORWARD\]\s+\d+\s+127\.0\.0\.1\s+(\d+)', network)[1])
    record.update(port=port)
    (root / 'resource.json').write_text(json.dumps(record, indent=2))
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        observed = subprocess.run(['ssh', '-i', str(root / 'key'), '-p', str(port),
            '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new',
            '-o', f'UserKnownHostsFile={root}/known-hosts', '-o', 'ConnectTimeout=2',
            'alpine@127.0.0.1', 'cat /proc/sys/kernel/random/boot_id; uname -sm; printf guest-executed'],
            capture_output=True, text=True, timeout=5)
        if observed.returncode == 0:
            lines = observed.stdout.splitlines()
            record.update(state='ready', boot_id=str(uuid.UUID(lines[0])), platform=lines[1],
                          execution=lines[2], pid=int((root / 'pid').read_text()))
            (root / 'resource.json').write_text(json.dumps(record, indent=2))
            print(json.dumps(record, indent=2))
            return
        time.sleep(.25)  # bounded poll of the external guest's SSH readiness
    raise RuntimeError(f'Guest readiness unconfirmed; reconcile {root}/resource.json')


def stop(args):
    root = args.directory.resolve(strict=True)
    path = root / 'resource.json'
    record = json.loads(path.read_text())
    if record['state'] == 'stopped':
        return
    control = Path(record['qmp'])
    if qmp(control, 'query-uuid')['UUID'] != record['instance']:
        raise RuntimeError('Refuse to stop a different QEMU instance')
    qmp(control, 'quit')
    deadline = time.monotonic() + 10
    while control.exists() and time.monotonic() < deadline:
        time.sleep(.05)
    if control.exists():
        raise RuntimeError('Original QEMU stop is unconfirmed')
    record['state'] = 'stopped'
    path.write_text(json.dumps(record, indent=2))
    control.parent.rmdir()
    print('Stopped original QEMU instance; base image, overlay and evidence retained.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('create', 'stop'))
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--base', type=Path)
    parser.add_argument('--sha512-file', type=Path)
    parser.add_argument('--firmware', type=Path, default=Path('/opt/homebrew/share/qemu/edk2-aarch64-code.fd'))
    args = parser.parse_args()
    if args.action == 'create':
        if args.base is None or args.sha512_file is None:
            parser.error('create needs --base and --sha512-file')
        create(args)
    else:
        stop(args)
