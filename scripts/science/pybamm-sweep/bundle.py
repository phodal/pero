"""Load the on-disk frozen method bundle once at a CLI/ACP boundary."""
import json
from pathlib import Path

from contract import Environment, Method, MethodIdentity, digest, encoded

ROOT = Path(__file__).resolve().parent


def load_identity() -> MethodIdentity:
    files = {name: (ROOT / name).read_bytes() for name in
             ('manifest.json', 'requirements.lock', 'contract.py', 'bundle.py', 'run.py')}
    method = Method.parse(json.loads(files['manifest.json']))
    packages = tuple(tuple(line.split('==')) for line in files['requirements.lock'].decode().splitlines()
                     if line and not line.startswith('#'))
    return MethodIdentity(method, digest(encoded({name: digest(data) for name, data in files.items()})),
                          Environment(method.python, packages))
