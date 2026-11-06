"""Metadata probe for the LCMS2Yield inference stack.

Reads the current interpreter only. It does not install packages, import the
model, load weights, or authorize a run.
"""
import hashlib
import json
from importlib import metadata
import platform
import sys
import time

METHOD = 'lcms2yield.inference'
# Distribution names as importlib records them. torch_scatter has no README pin;
# any installed version satisfies that one requirement.
PINS = (
    ('torch', '2.3.0'),
    ('torchvision', '0.18.0'),
    ('torch_geometric', '2.5.3'),
    ('performer-pytorch', '1.1.4'),
    ('rdkit', '2023.9.6'),
    ('pykan', '0.2.7'),
    ('setuptools', '84.2.1'),
    ('numpy', '1.26.4'),
    ('pandas', '2.3.2'),
    ('matplotlib', '3.9.0'),
    ('PyYAML', '6.0.2'),
    ('torch_scatter', None),
)


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
    profile = dict(
        name='lcms2yield',
        python=dict(major=sys.version_info.major, minor=sys.version_info.minor, patch=sys.version_info.micro),
        system=platform.system(), machine=platform.machine(), interpreter_sha256=interpreter,
        packages={name: _version(name) for name, _version_pin in PINS}, native={})
    profile_id = hashlib.sha256(json.dumps(profile, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    required = [dict(kind='python', major=3, minor=12, patch=None)]
    required.extend(dict(kind='package', name=name, version=pin) for name, pin in PINS)
    return dict(schema='pero.environment.observation.v1', method=METHOD, profile=profile, profile_id=profile_id,
                required=required, preferred=[dict(kind='platform', system='Linux', machine='x86_64')],
                observed_at_ms=time.time_ns() // 1_000_000, evidence='metadata_only')


if __name__ == '__main__':
    print(json.dumps(inspect_environment(), sort_keys=True))
