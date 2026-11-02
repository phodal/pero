"""Synthetic metadata only: never launches a desktop or connects to D-Bus."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('diagnostic', Path(__file__).with_name('paper-atspi-diagnostic.py'))
diagnostic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)


class MetadataBus:
    def __init__(self, children=None, extents=None, owners=None, broken=None):
        self.children = children or {('fixture', '/app'): [('fixture', '/frame')]}
        self.extents = extents or {}
        self.owners = owners or {'fixture': 7}
        self.broken = broken
        self.calls = []

    def __call__(self, node, interface, method, signature, args):
        self.calls.append((node, interface, method))
        assert interface != 'org.a11y.atspi.Action'
        assert method in ('GetChildren', 'GetConnectionUnixProcessID', 'GetRole',
                          'GetRoleName', 'GetState', 'GetInterfaces', 'GetExtents')
        if method == self.broken:
            raise RuntimeError('remote payload must not leak')
        if method == 'GetConnectionUnixProcessID':
            return self.owners.get(args[0], 8)
        if method == 'GetChildren':
            return [('fixture', '/app')] if node[0] == diagnostic.REGISTRY else self.children.get(node, [])
        return {'GetExtents': self.extents.get(node, [10, 20, 100, 80]),
                'GetRole': 23, 'GetRoleName': 'dialog',
                'GetInterfaces': [diagnostic.COMPONENT, 'org.a11y.atspi.Action'],
                'GetState': [(1 << 25) | (1 << 30), 0]}[method]


class DiagnosticTest(unittest.TestCase):
    def collect(self, bus):
        return diagnostic.collect(bus, 7, [10, 20, 100, 80])

    def test_binding_and_getter_outcomes(self):
        for bus, expected in (
            (MetadataBus(owners={'fixture': 8}), 'no-exact-pid-application'),
            (MetadataBus(extents={('fixture', '/frame'): [13, 20, 100, 80]}), 'no-exact-geometry-node-in-owned-subtree'),
            (MetadataBus(extents={('fixture', '/frame'): [12, 18, 102, 78]}), 'one-exact-geometry-node-not-an-input-grant'),
            (MetadataBus(broken='GetRole'), 'incomplete-getters-or-budget'),
            (MetadataBus(broken='GetChildren'), 'registry-read-incomplete'),
        ):
            with self.subTest(expected=expected):
                result = self.collect(bus)
                self.assertEqual(result['classification'], expected)
                self.assertNotIn('remote payload', str(result))

    def test_nested_candidate_preserves_zero_immediate_matches(self):
        bus = MetadataBus(children={('fixture', '/app'): [('fixture', '/frame')],
                                    ('fixture', '/frame'): [('fixture', '/dialog')]},
                          extents={('fixture', '/frame'): [0, 0, 480, 320]})
        result = self.collect(bus)
        self.assertEqual(result['matchingFrames'], 0)
        self.assertEqual(result['matchingNestedNodes'], 1)
        self.assertFalse(result['truncated'])
        self.assertEqual(result['classification'], 'one-exact-geometry-node-not-an-input-grant')

    def test_foreign_child_is_never_read_and_same_pid_bus_is_allowed(self):
        bus = MetadataBus(children={('fixture', '/app'): [('fixture', '/frame')],
                                    ('fixture', '/frame'): [('renderer', '/foreign'), ('samepid', '/nested')]},
                          owners={'fixture': 7, 'renderer': 8, 'samepid': 7})
        result = self.collect(bus)
        self.assertEqual(result['skippedForeignPid'], 1)
        self.assertFalse(any(node[0] == 'renderer' for node, _, _ in bus.calls))
        self.assertTrue(any(node[0] == 'samepid' for node, _, _ in bus.calls))
        self.assertEqual(result['classification'], 'ambiguous-exact-geometry-nodes')

    def test_node_and_rpc_budgets_fail_closed(self):
        bus = MetadataBus(children={('fixture', '/app'): [('fixture', f'/n{i}') for i in range(100)]})
        result = self.collect(bus)
        self.assertTrue(result['truncated'])
        self.assertIn('node-count', result['budgetReasons'])
        self.assertIn('rpc-count', result['budgetReasons'])
        self.assertLessEqual(result['calls'], 128)
        self.assertLessEqual(len(result['nodes']), 64)
        self.assertEqual(result['classification'], 'incomplete-getters-or-budget')

    def test_depth_budget_and_cycles(self):
        children = {('fixture', '/app'): [('fixture', '/n1')]}
        children.update({('fixture', f'/n{i}'): [('fixture', f'/n{i+1}')] for i in range(1, 5)})
        bus = MetadataBus(children=children)
        result = self.collect(bus)
        self.assertIn('depth', result['budgetReasons'])
        self.assertEqual(max(n['depth'] for n in result['nodes']), 4)
        self.assertFalse(any(node[1] == '/n5' for node, _, _ in bus.calls))
        bus.children[('fixture', '/n4')] = []
        bus.children[('fixture', '/n3')].append(('fixture', '/n1'))
        self.assertFalse(self.collect(bus)['truncated'])

    def test_elapsed_time_budget(self):
        with patch.object(diagnostic.time, 'monotonic', side_effect=[0, 0, 0, 0, 9]):
            result = self.collect(MetadataBus())
        self.assertIn('elapsed-time', result['budgetReasons'])
        self.assertEqual(result['classification'], 'incomplete-getters-or-budget')


if __name__ == '__main__':
    unittest.main()
