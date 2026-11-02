"""Fixed ReFrame subprocess composition; never accepts commands from an API request."""
from dataclasses import dataclass
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import time

from domain import Invalid, Verification

REQUIRED_REFRAME = '4.10.4'
ENTRYPOINT = 'from reframe.frontend.cli import main; raise SystemExit(main())'
BENCHMARK_ROOT = Path(__file__).resolve().parents[1] / 'benchmarks' / 'local-reference'
DEFINITIONS = (BENCHMARK_ROOT / 'benchmark.json', BENCHMARK_ROOT.parent / 'poisson1d' / 'benchmark.json')


@dataclass(frozen=True)
class Runtime:
    python: str
    version: str | None
    message: str

    @property
    def available(self):
        return self.version == REQUIRED_REFRAME

    @staticmethod
    def inspect(python=None):
        executable = python or sys.executable
        result = subprocess.run([executable, '-c',
                                 'import importlib.metadata; print(importlib.metadata.version("reframe-hpc"))'],
                                capture_output=True, text=True, timeout=10)
        version = result.stdout.strip() if result.returncode == 0 else None
        message = ('Ready for the fixed local CPU reference' if version == REQUIRED_REFRAME else
                   f'Install reframe-hpc=={REQUIRED_REFRAME} in the App Python environment and reopen the App')
        return Runtime(executable, version, message)

    def view(self):
        return dict(mode='local-reference', reframeAvailable=self.available,
                    reframeVersion=self.version, requiredReframeVersion=REQUIRED_REFRAME,
                    message=self.message, capabilities=[dict(id='slurm-openfoam', available=False,
                    reason='No authorized Slurm site is configured. OpenFOAM/MPI submission is not connected.')])


def command(args, directory, output, cancelled, environment=None, timeout=180):
    """Wait for the owned process, cancellation or the fixed operation deadline."""
    with output.open('ab') as log:
        process = subprocess.Popen(args, cwd=directory, stdout=log, stderr=subprocess.STDOUT,
                                   env=environment, start_new_session=os.name != 'nt')
        deadline = time.monotonic() + timeout
        stopped = False
        while process.poll() is None:
            if cancelled.is_set() or time.monotonic() >= deadline:
                stopped = True
                if os.name == 'nt':
                    process.terminate()
                else:
                    os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    if os.name == 'nt':
                        process.kill()
                    else:
                        os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=3)
                break
            try:
                process.wait(timeout=.1)
            except subprocess.TimeoutExpired:
                continue
        if stopped and not cancelled.is_set():
            raise Invalid('The fixed local reference exceeded its three-minute time limit')
        return process.returncode


def execute(runtime, directory, cancelled, benchmark_id):
    if not runtime.available:
        raise Invalid(runtime.message)
    bundle = directory / 'bundle'
    log = directory / 'reframe.log'
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(('PERO_', 'RFM_'))}
    environment['PERO_HPC_RUN_DIR'] = str(bundle)
    definition = next((path for path in DEFINITIONS if json.loads(path.read_text())['id'] == benchmark_id), None)
    if definition is None:
        raise Invalid('Unknown fixed benchmark definition')
    code = command([runtime.python, str(BENCHMARK_ROOT / 'prepare.py'), '--output', str(bundle),
                    '--definition', str(definition)],
                   directory, log, cancelled, environment, timeout=15)
    if code != 0 or cancelled.is_set():
        return code
    check = directory / 'reframe-check.py'
    settings = directory / 'reframe-settings.py'
    shutil.copyfile(BENCHMARK_ROOT / 'reframe_check.py', check)
    shutil.copyfile(Path(__file__).with_name('reframe_settings.py'), settings)
    return command([runtime.python, '-c', ENTRYPOINT,
                    '-C', str(settings), '-c', str(check), '-r',
                    '--system=pero-local:cpu', '-p', 'builtin',
                    '--prefix', str(directory / 'reframe'),
                    '--report-file', str(directory / 'reframe-report.json'),
                    '--keep-stage-files', '--max-retries=0', '--nocolor'],
                   directory, log, cancelled, environment)


def verify(runtime, directory, cancelled):
    bundle = directory / 'bundle'
    # Any failed recheck invalidates the previous decision, including hash failures.
    report_path = bundle / 'verification.json'
    report_path.unlink(missing_ok=True)
    manifest_path = bundle / 'manifest.json'
    if not manifest_path.is_file():
        raise Invalid('No prepared result bundle is available to verify')
    # Frozen code is an input to rechecking; verify it before executing it.
    import hashlib
    manifest = json.loads(manifest_path.read_text())
    for name, digest in manifest['files'].items():
        path = bundle / name
        if Path(name).name != name or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise Invalid('Frozen benchmark input/program hash mismatch: ' + name)
    command([runtime.python, str(bundle / 'verify.py'), str(bundle), '--write'], directory,
            directory / 'verification.log', cancelled, timeout=30)
    if cancelled.is_set() or not report_path.is_file():
        raise Invalid('Independent verification did not produce a new report')
    return read_verification(directory)


def read_verification(directory):
    path = directory / 'bundle' / 'verification.json'
    return Verification.admit(json.loads(path.read_text())) if path.is_file() else None
