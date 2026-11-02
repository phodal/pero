"""Read-only metadata for the current Control Lab interpreter; no solver run/install.

Package versions are metadata, not importability. Requirements come from the
installed App manifest. The Host parses this private probe, not a public API.
"""
import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time


def file_digest(path):
    try:
        with open(path, 'rb') as stream:
            digest = hashlib.sha256()
            for block in iter(lambda: stream.read(65536), b''):
                digest.update(block)
            return digest.hexdigest()
    except OSError:
        return None


def inspect_environment(engine):
    if engine not in ('python-control', 'ngspice'):
        raise ValueError('Unknown Control Lab method')
    manifest = json.loads((Path(__file__).resolve().parents[2] / 'app.json').read_text())
    pins = [item.split('==', 1) for item in manifest['backend']['dependencies']]
    packages = {}
    for name, _ in pins:
        try:
            packages[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            packages[name] = None
    native = {}
    required = [dict(kind='package', name=name, version=version) for name, version in pins]
    if engine == 'ngspice':
        executable = shutil.which('ngspice')
        program = dict(version=None, sha256=None, status='missing')
        if os.name == 'nt':
            program['status'] = 'unsupported'
        elif executable:
            program.update(sha256=file_digest(executable), status='probe_failed')
            try:
                probe = subprocess.run([executable, '-v'], capture_output=True, text=True, timeout=3, check=False)
                version = next((line.strip(' *') for line in probe.stdout.splitlines() if 'ngspice-' in line.lower()), None)
                if probe.returncode == 0 and version:
                    program.update(version=version, status='observed')
            except (OSError, subprocess.TimeoutExpired):
                pass  # Observation remains explicitly probe_failed, never ready.
        native['ngspice'] = program
        required.append(dict(kind='native', name='ngspice', sha256=None))
    profile = dict(name='control-lab', python=dict(major=sys.version_info.major, minor=sys.version_info.minor, patch=sys.version_info.micro),
                   system=platform.system(), machine=platform.machine(), interpreter_sha256=file_digest(sys.executable),
                   packages=packages, native=native)
    profile_id = hashlib.sha256(json.dumps(profile, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    return dict(schema='pero.environment.observation.v1', method='control-lab.' + engine,
                profile=profile, profile_id=profile_id, required=required, preferred=[],
                observed_at_ms=time.time_ns() // 1000000, evidence='metadata_only')


if __name__ == '__main__':
    print(json.dumps(inspect_environment(sys.argv[1]), sort_keys=True))
