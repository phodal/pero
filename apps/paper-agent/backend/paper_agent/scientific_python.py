"""Observe a separately selected scientific interpreter, without installing it.

The immutable value participates in the existing frozen approval. This module
owns observation I/O; it does not create a second training lifecycle or checker.
"""
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys

from .pcgym_domain import Invalid, digest, fields
from .pcgym_sources import package_inventory


@dataclass(frozen=True)
class ScientificPython:
    executable: str
    executable_sha256: str
    python_version: str
    packages: tuple[tuple[str, str], ...]

    @classmethod
    def parse(cls, value):
        fields(value, ('executable', 'executable_sha256', 'python_version', 'packages'))
        if (not isinstance(value['executable'], str) or not Path(value['executable']).is_absolute()
                or not isinstance(value['executable_sha256'], str)
                or len(value['executable_sha256']) != 64
                or any(c not in '0123456789abcdef' for c in value['executable_sha256'])
                or not isinstance(value['python_version'], str)
                or not isinstance(value['packages'], list)
                or any(not isinstance(pair, (list, tuple)) or len(pair) != 2
                       or not all(isinstance(part, str) and part for part in pair)
                       for pair in value['packages'])):
            raise Invalid('scientific_python', 'Invalid scientific interpreter observation')
        packages = tuple(sorted(tuple(pair) for pair in value['packages']))
        if len(dict(packages)) != len(packages):
            raise Invalid('scientific_python', 'Duplicate scientific package observation')
        return cls(value['executable'], value['executable_sha256'], value['python_version'], packages)

    def to_dict(self):
        return dict(executable=self.executable, executable_sha256=self.executable_sha256,
                    python_version=self.python_version, packages=[list(pair) for pair in self.packages])

    @property
    def identity(self):
        return digest(self.to_dict())

    def require(self, spec, frozen=None):
        if self.python_version != spec.python_version or self.packages != tuple(sorted(spec.packages)):
            raise Invalid('environment_changed', 'Scientific interpreter or dependencies differ from the frozen specification')
        if (spec.scientific_runtime_digest is not None and self.identity != spec.scientific_runtime_digest
                or frozen is not None and self != frozen):
            raise Invalid('environment_changed', 'Scientific interpreter identity changed; freeze and approve the new environment')


def current():
    with open(sys.executable, 'rb') as stream:
        sha = hashlib.sha256()
        for block in iter(lambda: stream.read(65536), b''):
            sha.update(block)
    return ScientificPython(sys.executable, sha.hexdigest(), platform.python_version(),
                            tuple(sorted(package_inventory().items())))


def observe(executable):
    path = Path(executable)
    if not path.is_absolute() or not path.is_file() or not os.access(path, os.X_OK):
        raise Invalid('scientific_python', 'Select an existing absolute scientific Python executable')
    # Preserve the venv entry path: resolving its final symlink selects base Python.
    if str(path) == sys.executable:
        return current()
    environment = {key: os.environ[key] for key in ('PATH', 'SYSTEMROOT', 'WINDIR', 'HOME') if key in os.environ}
    try:
        result = subprocess.run([str(path), '-E', '-s', '-B', '-m', 'paper_agent.scientific_python'],
            cwd=Path(__file__).resolve().parents[1], env=environment, capture_output=True,
            text=True, timeout=10, check=False)
    except subprocess.TimeoutExpired as error:
        raise Invalid('scientific_python', 'Scientific interpreter observation timed out; no computation started') from error
    if result.returncode:
        raise Invalid('scientific_python', 'Selected scientific interpreter could not be observed; no computation started')
    try:
        runtime = ScientificPython.parse(json.loads(result.stdout))
    except (ValueError, TypeError) as error:
        raise Invalid('scientific_python', 'Selected interpreter returned an invalid runtime observation') from error
    if runtime.executable != str(path):
        raise Invalid('scientific_python', 'Scientific interpreter resolved to a different entry path')
    return runtime


if __name__ == '__main__':
    print(json.dumps(current().to_dict(), sort_keys=True))
