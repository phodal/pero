import importlib.util
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'backend'))
from conversation import KIND, project, project_preview
from molecules import MoleculeRequest


SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'


class MoleculeConversationTest(unittest.TestCase):
    def test_changed_record_and_invalid_row_do_not_inherit_a_drawing(self):
        request = MoleculeRequest.parse({'format': 'smiles', 'records': ['CCO', 'invalid@@']})
        preview = {'engine': {'name': 'RDKit', 'version': 'test'}, 'rows': [
            {'input': 'CCO', 'svg': SVG, 'descriptors': {'MolWt': 46.069, 'TPSA': 20.23}},
            {'input': 'invalid@@', 'error': 'Invalid molecule'},
        ]}
        first = project_preview(request, preview)
        again = project_preview(request, preview)
        self.assertEqual(again, first)
        self.assertEqual(first['kind'], KIND)
        self.assertEqual(first['status'], 'partial')
        self.assertIs(first['inheritedCheck'], False)
        self.assertNotIn('svg', first['rows'][1])
        self.assertNotIn('descriptors', first['rows'][1])
        self.assertIsNone(first['rows'][1].get('descriptors'))
        self.assertEqual(first['rows'][0]['descriptors']['MolWt']['unit'], 'g/mol')
        self.assertEqual(first['rows'][0]['descriptors']['TPSA']['unit'], 'Å²')
        changed = MoleculeRequest.parse({'format': 'smiles', 'records': ['CCN', 'invalid@@']})
        moved = {'engine': preview['engine'], 'rows': [
            {'input': 'CCN', 'svg': SVG, 'descriptors': {'MolWt': 46.069}},
            preview['rows'][1],
        ]}
        second = project_preview(changed, moved)
        self.assertNotEqual(second['version'], first['version'])
        self.assertNotEqual(second['rows'][0]['input'], first['rows'][0]['input'])
        self.assertNotIn(first['version'], json.dumps(second['rows']))

    def test_real_rdkit_depicts_ethanol_and_keeps_the_invalid_record(self):
        if importlib.util.find_spec('rdkit') is None:
            self.skipTest('RDKit is not installed')
        receipt = project({'format': 'smiles', 'records': ['CCO', 'C[C@H](O)C(=O)O', 'invalid@@']})
        self.assertEqual(receipt['engine']['version'], '2026.09.1')
        self.assertEqual(receipt['status'], 'partial')
        ethanol, lactic, invalid = receipt['rows']
        self.assertIn('<svg', ethanol['svg'])
        self.assertAlmostEqual(ethanol['descriptors']['MolWt']['value'], 46.069, places=3)
        self.assertEqual(ethanol['descriptors']['NumHDonors']['value'], 1)
        self.assertEqual(lactic['input'], 'C[C@H](O)C(=O)O')
        self.assertIn('<svg', lactic['svg'])
        self.assertEqual(invalid, {'input': 'invalid@@', 'status': 'invalid', 'error': 'Invalid molecule'})
        self.assertEqual(project({'format': 'smiles', 'records': ['CCO', 'C[C@H](O)C(=O)O', 'invalid@@']})['version'], receipt['version'])
        self.assertLess(len(json.dumps(receipt).encode()), 2 * 1024 * 1024)
