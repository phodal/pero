"""Environment metadata is evidence only; it never installs or runs a solver."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from control_lab import environment, engines


class EnvironmentTests(unittest.TestCase):
    def test_declared_requirements_and_observed_identity(self):
        with patch.object(environment.metadata, 'version', return_value='observed-version'), \
                patch.object(environment.shutil, 'which', return_value=None), \
                patch.object(environment.subprocess, 'run') as process:
            first = environment.inspect_environment('ngspice')
            second = environment.inspect_environment('ngspice')
            process.assert_not_called()
        self.assertEqual(first['profile_id'], second['profile_id'])
        self.assertEqual(first['profile']['native']['ngspice']['status'], 'missing' if environment.os.name != 'nt' else 'unsupported')
        manifest = json.loads((Path(__file__).resolve().parents[1] / 'app.json').read_text())
        self.assertEqual([r['name'] + '==' + r['version'] for r in first['required'] if r['kind'] == 'package'], manifest['backend']['dependencies'])
        self.assertTrue(all(v == 'observed-version' for v in first['profile']['packages'].values()))
        with patch.object(environment.metadata, 'version', side_effect=environment.metadata.PackageNotFoundError):
            changed = environment.inspect_environment('python-control')
        self.assertNotEqual(first['profile_id'], changed['profile_id'])
        self.assertTrue(all(v is None for v in changed['profile']['packages'].values()))
        self.assertEqual(first['profile_id'], hashlib.sha256(json.dumps(first['profile'], sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest())
        self.assertNotIn(sys.executable, json.dumps(first))
        self.assertEqual(first['evidence'], 'metadata_only')

    @unittest.skipIf(environment.os.name == 'nt', 'Existing Windows ngspice policy disables probing')
    def test_native_probe_records_content_and_failure_without_solver(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / 'ngspice'; binary.write_bytes(b'fixed executable fixture')
            for output, status in [(subprocess.CompletedProcess([], 0, 'ngspice-44\n', ''), 'observed'),
                                   (subprocess.CompletedProcess([], 1, '', ''), 'probe_failed')]:
                with self.subTest(status=status), patch.object(environment.shutil, 'which', return_value=str(binary)), \
                        patch.object(environment.subprocess, 'run', return_value=output) as run:
                    native = environment.inspect_environment('ngspice')['profile']['native']['ngspice']
                    self.assertEqual(native['status'], status)
                    self.assertEqual(native['sha256'], hashlib.sha256(binary.read_bytes()).hexdigest())
                    self.assertEqual(run.call_args.args[0], [str(binary), '-v'])

    def test_calculation_saves_optional_metadata_without_changing_solver_result(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(engines, '_python_control', return_value={'actual': 'solver-output'}) as solve:
            result = engines.execute('python-control', 'p-golden', {}, {}, Path(directory), threading.Event())
            saved = json.loads((Path(directory) / 'environment-observation.json').read_text())
            self.assertEqual(result, {'actual': 'solver-output'})
            self.assertEqual(saved['method'], 'control-lab.python-control')
            solve.assert_called_once()
