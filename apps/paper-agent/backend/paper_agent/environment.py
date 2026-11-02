"""PC-Gym environment metadata, independent of experiment smoke/table6 profile.

This reads installed distributions only. It never imports scientific packages,
checks out source, installs dependencies, creates a study or authorizes training.
"""
import hashlib
import json
import platform
import sys
import time

from .pcgym_sources import package_inventory


def inspect_environment():
    inventory = package_inventory()
    try:
        digest = hashlib.sha256()
        with open(sys.executable, 'rb') as stream:
            for block in iter(lambda: stream.read(65536), b''):
                digest.update(block)
        interpreter_sha256 = digest.hexdigest()
    except OSError:
        interpreter_sha256 = None
    profile = dict(name='paper-agent', python=dict(major=sys.version_info.major, minor=sys.version_info.minor, patch=sys.version_info.micro),
                   system=platform.system(), machine=platform.machine(), interpreter_sha256=interpreter_sha256,
                   packages={name: None if version == 'MISSING' else version for name, version in inventory.items()}, native={})
    profile_id = hashlib.sha256(json.dumps(profile, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    return dict(schema='pero.environment.observation.v1', method='paper-agent.pcgym',
                profile=profile, profile_id=profile_id,
                required=[dict(kind='package', name=name, version=None) for name in inventory], preferred=[],
                observed_at_ms=time.time_ns() // 1000000, evidence='metadata_only')


if __name__ == '__main__':
    print(json.dumps(inspect_environment(), sort_keys=True))
