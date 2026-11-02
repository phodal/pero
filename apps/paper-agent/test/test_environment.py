"""PC-Gym metadata probe does not create an experiment or import science engines."""
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent import environment
from paper_agent.pcgym_domain import REQUIRED_PACKAGES


class EnvironmentTests(unittest.TestCase):
    def test_metadata_requirements_keep_scientific_profile_out(self):
        packages = {name: 'MISSING' for name in REQUIRED_PACKAGES}
        packages['numpy'] = '2.2.6'
        with patch.object(environment, 'package_inventory', return_value=packages):
            first = environment.inspect_environment()
            second = environment.inspect_environment()
        self.assertEqual(first['profile_id'], second['profile_id'])
        self.assertEqual(first['profile']['packages']['numpy'], '2.2.6')
        self.assertIsNone(first['profile']['packages']['torch'])
        self.assertEqual(first['required'], [dict(kind='package', name=name, version=None) for name in REQUIRED_PACKAGES])
        self.assertEqual(first['profile_id'], hashlib.sha256(json.dumps(first['profile'], sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest())
        self.assertEqual(first['evidence'], 'metadata_only')
        self.assertNotIn(sys.executable, json.dumps(first))
        self.assertNotIn('smoke', json.dumps(first))
        packages['torch'] = '2.0.0'
        with patch.object(environment, 'package_inventory', return_value=packages):
            self.assertNotEqual(first['profile_id'], environment.inspect_environment()['profile_id'])
