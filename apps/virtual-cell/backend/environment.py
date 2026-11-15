"""Read-only observation for the CPU task package's configured interpreter.

No downloads, model startup, calculation or EnvironmentUse is implied. The
legacy Host contract matches exact Python minors: bind the observed compatible
minor, or the package minimum so an older interpreter remains blocked.
"""
import hashlib
import json
import platform
import sys
import time

from task_package import METHOD, MIN_PYTHON


def inspect_environment():
    try:
        digest = hashlib.sha256()
        with open(sys.executable, "rb") as stream:
            for block in iter(lambda: stream.read(65536), b""):
                digest.update(block)
        interpreter = digest.hexdigest()
    except OSError:
        interpreter = None
    profile = dict(
        name="virtual-cell",
        python=dict(major=sys.version_info.major, minor=sys.version_info.minor, patch=sys.version_info.micro),
        system=platform.system(), machine=platform.machine(), interpreter_sha256=interpreter,
        packages={}, native={})
    profile_id = hashlib.sha256(json.dumps(profile, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    major, minor = sys.version_info[:2] if sys.version_info[:2] >= MIN_PYTHON else MIN_PYTHON
    return dict(schema="pero.environment.observation.v1", method=METHOD, profile=profile, profile_id=profile_id,
                required=[dict(kind="python", major=major, minor=minor, patch=None)], preferred=[],
                observed_at_ms=time.time_ns() // 1_000_000, evidence="metadata_only")


if __name__ == "__main__":
    print(json.dumps(inspect_environment(), sort_keys=True))
