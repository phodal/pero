"""Metadata probe for the LCMS2Yield inference stack.

Package pins and the Python minor come from this App manifest. torch_scatter
is installed from the PyG index and has no version pin. The probe reads the
current interpreter only.
It does not install packages, import the model, load weights, or authorize a run.
"""
import hashlib
import json
from importlib import metadata
from pathlib import Path
import platform
import sys
import time

METHOD = 'lcms2yield.inference'


def _declared():
    backend = json.loads((Path(__file__).resolve().parents[2] / 'app.json').read_text(encoding='utf-8'))['backend']
    pins = [tuple(item.split('==', 1)) for item in backend['dependencies']]
    pins.append(('torch_scatter', None))
    major, minor = (int(part) for part in backend['python'].split('.'))
    return pins, major, minor


def _version(name):
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def inspect_environment():
    try:
        digest = hashlib.sha256()
        with open(sys.executable, 'rb') as stream:
            for block in iter(lambda: stream.read(65536), b''):
                digest.update(block)
        interpreter = digest.hexdigest()
    except OSError:
        interpreter = None
    pins, major, minor = _declared()
    profile = dict(
        name='lcms2yield',
        python=dict(major=sys.version_info.major, minor=sys.version_info.minor, patch=sys.version_info.micro),
        system=platform.system(), machine=platform.machine(), interpreter_sha256=interpreter,
        packages={name: _version(name) for name, _pin in pins}, native={})
    profile_id = hashlib.sha256(json.dumps(profile, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    required = [dict(kind='python', major=major, minor=minor, patch=None)]
    required.extend(dict(kind='package', name=name, version=pin) for name, pin in pins)
    return dict(schema='pero.environment.observation.v1', method=METHOD, profile=profile, profile_id=profile_id,
                required=required, preferred=[dict(kind='platform', system='Linux', machine='x86_64')],
                observed_at_ms=time.time_ns() // 1_000_000, evidence='metadata_only')


if __name__ == '__main__':
    print(json.dumps(inspect_environment(), sort_keys=True))
