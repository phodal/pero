"""A fixed python-control child adapter; the existing Store owns every attempt.

Host publishes the selection under App data. Selection is read once per operation;
children receive that frozen value, never a mutable global choice or arbitrary code.
"""
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

from . import engines
from .experiments import Invalid, canonical
from .native_executable import NativeExecutable


@dataclass(frozen=True)
class ComputeProfile:
    root: Path
    payload: bytes

    @classmethod
    def parse(cls, value):
        expected = {'root', 'project_sha256', 'lock_sha256', 'python_request',
                    'uv_version', 'uv_sha256', 'observation', 'python_archive_url', 'python_archive_sha256'}
        if not isinstance(value, dict) or set(value) != expected:
            raise Invalid('Invalid managed compute profile')
        if not isinstance(value['root'], str) or not Path(value['root']).is_absolute():
            raise Invalid('Managed compute profile needs an absolute prefix')
        for key in ('project_sha256', 'lock_sha256', 'uv_sha256', 'python_archive_sha256'):
            digest = value[key]
            if not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
                raise Invalid('Invalid managed compute digest')
        observation = value['observation']
        if (not isinstance(observation, dict) or set(observation) != {
                'version', 'build', 'platform', 'machine', 'executable_sha256', 'packages', 'packages_sha256'}
                or not isinstance(observation['packages'], dict)
                or any(not isinstance(k, str) or not isinstance(v, str) for k, v in observation['packages'].items())
                or any(not isinstance(observation[k], str) for k in observation if k != 'packages')
                or any(not isinstance(value[k], str) for k in ('python_request', 'uv_version', 'python_archive_url'))):
            raise Invalid('Invalid managed compute observation')
        return cls(Path(value['root']), canonical(value))

    @property
    def identity(self):
        return hashlib.sha256(self.payload).hexdigest()

    @property
    def executable(self):
        return self.root / 'bin' / 'python'

    def require(self, observed):
        if observed != json.loads(self.payload)['observation']:
            raise Invalid('Compute environment changed; rebuild and create a new experiment')

    def inspect(self):
        from . import compute_observation
        try:
            result = subprocess.run([str(self.executable), '-I', '-B', str(Path(compute_observation.__file__).resolve())],
                env={}, capture_output=True, text=True, timeout=30, check=False)
            if result.returncode:
                raise Invalid('Compute dependencies are missing or cannot import; rebuild a new profile')
            self.require(json.loads(result.stdout))
        except (OSError, subprocess.TimeoutExpired, ValueError) as error:
            raise Invalid(f'Compute profile unavailable: {error}') from error

    def execute(self, engine, model, parameters, scenario, directory, cancelled, native=None):
        directory = Path(directory).resolve()
        directory.mkdir(parents=True, exist_ok=True)
        (directory / 'compute-profile.json').write_bytes(self.payload)
        if native:
            (directory / 'native-executable.json').write_bytes(canonical(native.to_dict()))
        (directory / 'compute-input.json').write_bytes(canonical(dict(
            engine=engine, model=model, parameters=parameters, scenario=scenario)))
        if cancelled.is_set():
            raise engines.EngineCancelled('Cancelled before compute launch')
        # No inherited Python, index, model credential or App token environment.
        environment = {key: os.environ[key] for key in ('HOME', 'TMPDIR') if key in os.environ}
        environment['MPLCONFIGDIR'] = str(directory / '.matplotlib')
        with (directory / 'compute-stdout.log').open('wb') as stdout, (directory / 'compute-stderr.log').open('wb') as stderr:
            process = subprocess.Popen([str(self.executable), '-E', '-s', '-B', '-m',
                'control_lab.compute_runtime', str(directory)], cwd=Path(__file__).resolve().parents[1],
                env=environment, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr)
            deadline = time.monotonic() + 120
            try:
                while process.poll() is None:
                    if cancelled.wait(.025):
                        raise engines.EngineCancelled('Scientific Python computation cancelled')
                    if time.monotonic() >= deadline:
                        raise engines.EngineError('Scientific Python exceeded its 120-second deadline')
                if cancelled.is_set():
                    raise engines.EngineCancelled('Cancelled before accepting compute evidence')
                if process.returncode:
                    raise engines.EngineError(f'Scientific Python failed ({process.returncode}); inspect compute-stderr.log')
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
        return json.loads((directory / 'compute-result.json').read_text())


def selected(root):
    path = Path(root) / '.compute' / 'binding.json'
    if not path.exists():
        return None
    try:
        return ComputeProfile.parse(json.loads(path.read_bytes()))
    except (OSError, ValueError) as error:
        raise Invalid(f'Cannot read compute binding: {error}') from error


@dataclass(frozen=True)
class ComputeBinding:
    profile: ComputeProfile | None
    native: NativeExecutable | None

    def execute(self, engine, model, parameters, scenario, directory, cancelled):
        execute = self.profile.execute if self.profile else engines.execute
        return execute(engine, model, parameters, scenario, directory, cancelled, native=self.native)


def admit(root, record, engine):
    native = NativeExecutable.observe() if engine == 'ngspice' else None
    if native:
        if 'nativeExecutable' in record:
            NativeExecutable.parse(record['nativeExecutable']).require(native)
        elif record['trials']:
            raise Invalid('Historical circuit has no frozen executable identity; create a new experiment. Old evidence remains readable.')
    profile = selected(root)
    identity = profile.identity if profile else None
    if ('computeProfile' in record and record['computeProfile'] != identity
            or 'computeProfile' not in record and record['trials'] and identity is not None):
        raise Invalid('Compute selection changed; create a new experiment. Historical trials are unchanged.')
    if profile:
        profile.inspect()
    record['computeProfile'] = identity
    if native:
        record['nativeExecutable'] = native.to_dict()
    return ComputeBinding(profile, native) if profile or native else None


if __name__ == '__main__':
    from .compute_observation import observe
    directory = Path(sys.argv[1])
    profile = ComputeProfile.parse(json.loads((directory / 'compute-profile.json').read_bytes()))
    profile.require(observe())
    inputs = json.loads((directory / 'compute-input.json').read_bytes())
    native_path = directory / 'native-executable.json'
    native = NativeExecutable.parse(json.loads(native_path.read_bytes())) if native_path.exists() else None
    output = engines.execute(**inputs, directory=directory, cancelled=threading.Event(), native=native)
    (directory / 'compute-result.json').write_bytes(canonical(output))
