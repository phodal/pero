"""An observed native solver identity, not a reproducible native installation."""
from dataclasses import asdict, dataclass
import hashlib
from pathlib import Path
import shutil
import subprocess

from .experiments import Invalid


@dataclass(frozen=True)
class NativeExecutable:
    path: str
    sha256: str
    version: str

    @classmethod
    def observe(cls, path=None):
        path = path or shutil.which('ngspice')
        if not path:
            raise Invalid('ngspice is missing; install it explicitly before creating a circuit experiment')
        try:
            path = Path(path).resolve(strict=True)
            probe = subprocess.run([str(path), '-v'], capture_output=True, text=True, timeout=3, check=False)
            version = next((line.strip(' *') for line in probe.stdout.splitlines()
                            if 'ngspice-' in line.lower()), None)
            if probe.returncode or not version:
                raise Invalid('ngspice version could not be observed; no calculation started')
            return cls(str(path), hashlib.sha256(path.read_bytes()).hexdigest(), version)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise Invalid(f'ngspice could not be observed: {error}') from error

    @classmethod
    def parse(cls, value):
        if (not isinstance(value, dict) or set(value) != {'path', 'sha256', 'version'}
                or not all(isinstance(v, str) and v for v in value.values())
                or not Path(value['path']).is_absolute() or len(value['sha256']) != 64
                or any(c not in '0123456789abcdef' for c in value['sha256'])):
            raise Invalid('Invalid frozen ngspice identity')
        return cls(**value)

    def to_dict(self):
        return asdict(self)

    def require(self, observed):
        if self != observed:
            raise Invalid('ngspice executable changed; create and approve a new experiment. Historical evidence is unchanged.')
