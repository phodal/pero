import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app_canvas import AppCanvasBinding


class AppCanvasTest(unittest.TestCase):
    def test_navigation_binding_admission(self):
        value = {'id': 'binding-1', 'app': 'control-lab', 'panel': 'main'}
        self.assertEqual(AppCanvasBinding.parse(value).app, 'control-lab')
        self.assertIsNone(AppCanvasBinding.parse(None))
        for bad in ({**value, 'app': 'javascript:alert(1)'}, {**value, 'panel': '../main'}, {**value, 'action': 'run'}, {**value, 'id': ''}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                AppCanvasBinding.parse(bad)
