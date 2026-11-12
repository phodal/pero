"""Opt-in network probe: can Pixi preserve #59's frozen PyBaMM dependencies?

Uses a caller-supplied Pixi 0.84.2, never PATH lookup or global installation.
This is a resolver experiment, not a Host software preparer or scientific run.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pixi', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path,
                        help='New evidence directory; refuses existing paths')
    parser.add_argument('--platform', required=True,
                        choices=('osx-arm64', 'linux-64', 'linux-aarch64'))
    args = parser.parse_args()
    pixi = args.pixi.resolve(strict=True)
    version = subprocess.check_output([str(pixi), '--version'], text=True).strip()
    if version != 'pixi 0.84.2':
        parser.error(f'Expected pixi 0.84.2, observed {version}')
    output = args.output.absolute()
    output.mkdir(parents=True, exist_ok=False)
    root = Path(__file__).resolve().parents[2]
    requirements = root / 'scripts/science/pybamm-sweep/requirements.lock'
    pins = dict(line.split('==') for line in requirements.read_text().splitlines() if line)
    conda = {'python': '3.12.11', 'numpy': pins['numpy'],
             'scipy': pins['scipy'], 'casadi': pins['casadi']}
    common = ('[workspace]\nname = "pero-pybamm-fit"\nversion = "0.1.0"\n'
              'channels = ["https://conda.anaconda.org/conda-forge"]\n'
              f'platforms = ["{args.platform}"]\n\n[dependencies]\n')
    cases = {
        'conda-solver': common + 'python = "==3.12.11"\npybammsolvers = "==0.3.3"\n',
        'mixed-frozen': common + ''.join(f'{k} = "=={v}"\n' for k, v in conda.items())
        + '\n[pypi-options]\nindex-url = "https://pypi.org/simple"\nno-build = true\n'
        + '\n[pypi-dependencies]\n'
        + ''.join(f'{k} = "=={v}"\n' for k, v in pins.items() if k not in conda),
        'conda-python-pypi': common + 'python = "==3.12.11"\n'
        + '\n[pypi-options]\nindex-url = "https://pypi.org/simple"\nno-build = true\n'
        + '\n[pypi-dependencies]\n'
        + ''.join(f'{k} = "=={v}"\n' for k, v in pins.items()),
    }
    env = dict(os.environ, PIXI_CACHE_DIR=str(output / 'cache'),
               PIXI_NO_CONFIG='true', PIXI_NO_PROGRESS='true', PIXI_COLOR='never')
    receipt = {'pixi_version': version,
               'pixi_sha256': hashlib.sha256(pixi.read_bytes()).hexdigest(),
               'requirements_sha256': hashlib.sha256(requirements.read_bytes()).hexdigest(),
               'host': {'system': platform.system(), 'machine': platform.machine()},
               'target_platform': args.platform, 'cases': []}
    for name, manifest in cases.items():
        case = output / name
        case.mkdir()
        path = case / 'pixi.toml'
        path.write_text(manifest)
        command = [str(pixi), '--no-progress', '--color', 'never',
                   'lock', '--no-config', '--no-install', '--manifest-path', str(path)]
        started = time.monotonic()
        with (case / 'solve.log').open('w') as log:
            try:
                result = subprocess.run(command, env=env, stdout=log,
                                        stderr=subprocess.STDOUT, timeout=240)
                status = {'exit_code': result.returncode}
            except subprocess.TimeoutExpired:
                status = {'exit_code': None, 'error': 'timeout'}
        lock = case / 'pixi.lock'
        row = {'name': name, 'command': command, **status,
               'elapsed_s': time.monotonic() - started,
               'manifest_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
               'lock_sha256': hashlib.sha256(lock.read_bytes()).hexdigest() if lock.exists() else None}
        receipt['cases'].append(row)
        (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps(row), flush=True)
    # Failed resolution is evidence, not success. Inspect solve.log to distinguish
    # dependency unavailability from transport/configuration failures.
    return 0 if all(row['exit_code'] == 0 for row in receipt['cases']) else 1


if __name__ == '__main__':
    raise SystemExit(main())
