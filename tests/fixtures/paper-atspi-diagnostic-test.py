"""Synthetic metadata only: never launches a desktop or connects to D-Bus."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('diagnostic', Path(__file__).with_name('paper-atspi-diagnostic.py'))
diagnostic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)


class DiagnosticTest(unittest.TestCase):
    def test_distinguishes_binding_failures_without_input(self):
        for owner, extents, count, broken, expected in (
            (8, [10, 20, 100, 80], 1, None, 'no-exact-pid-application'),
            (7, [13, 20, 100, 80], 1, None, 'no-exact-geometry-frame'),
            (7, [12, 18, 102, 78], 1, None, 'one-frame-matches-inspect-root-facts'),
            (7, [10, 20, 100, 80], 2, None, 'ambiguous-exact-geometry'),
            (7, [10, 20, 100, 80], 1, 'GetRole', 'incomplete-getters-or-budget'),
            (7, [10, 20, 100, 80], 1, 'GetChildren', 'registry-read-incomplete'),
        ):
            with self.subTest(expected=expected):
                def call(node, interface, method, signature, args):
                    self.assertTrue(method.startswith('Get'))
                    if method == broken:
                        raise RuntimeError('must not leak arbitrary remote content')
                    if method == 'GetChildren':
                        return [('fixture', '/app')] if node[0] == diagnostic.REGISTRY else [('fixture', f'/frame{i}') for i in range(count)]
                    return {'GetConnectionUnixProcessID': owner, 'GetExtents': extents,
                            'GetRole': 23, 'GetRoleName': 'dialog', 'GetInterfaces': [],
                            'GetState': [(1 << 25) | (1 << 30), 0]}[method]
                result = diagnostic.collect(call, 7, [10, 20, 100, 80])
                self.assertEqual(result['classification'], expected)
                self.assertNotIn('must not leak', str(result))

    def test_registry_budget_is_explicit(self):
        def call(node, interface, method, signature, args):
            if method == 'GetChildren':
                return [('fixture', '/app')] * 40
            return 8
        result = diagnostic.collect(call, 7, [0, 0, 100, 80])
        self.assertEqual(len(result['registry']), 32)
        self.assertTrue(result['truncated'])
        self.assertEqual(result['classification'], 'incomplete-getters-or-budget')

    def test_action_name_failure_is_not_a_successful_root_read(self):
        def call(node, interface, method, signature, args):
            if method == 'GetChildren':
                return [('fixture', '/app')] if node[0] == diagnostic.REGISTRY else [('fixture', '/frame')]
            if method == 'GetName':
                raise RuntimeError('remote payload not copied')
            return {'GetConnectionUnixProcessID': 7, 'GetExtents': [0, 0, 100, 80],
                    'GetRole': 23, 'GetRoleName': 'dialog', 'GetInterfaces': ['org.a11y.atspi.Action'],
                    'GetState': [0, 0], 'Get': 1}[method]
        result = diagnostic.collect(call, 7, [0, 0, 100, 80])
        self.assertEqual(result['matchingFrames'], 1)
        self.assertEqual(result['classification'], 'incomplete-getters-or-budget')
        self.assertEqual(result['errors'][0]['getter'], 'GetName')


if __name__ == '__main__':
    unittest.main()
