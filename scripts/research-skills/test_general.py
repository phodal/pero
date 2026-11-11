"""General discovery keeps the research inventory and stable source pins intact."""
import json
import unittest
from copy import deepcopy
from pathlib import Path

from catalog import runtime_catalog
from general import merge_catalog

ROOT = Path(__file__).resolve().parents[2]


class GeneralCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.research = json.loads((ROOT / 'docs/design-docs/research-skills-catalog.json').read_text())
        cls.general = json.loads((ROOT / 'docs/design-docs/general-skills-catalog.json').read_text())

    def test_review_inventory(self):
        general = self.general
        self.assertEqual(len(general['skills']), 12)
        self.assertGreaterEqual(len({item['category'] for item in general['skills']}), 6)
        self.assertEqual({item['id'] for item in general['reviews']}, {item['id'] for item in self.research['exclusions'] if item['kind'] == 'nonresearch'})
        index = (ROOT / 'docs/design-docs/general-skills-catalog.md').read_text()
        for item in general['skills']:
            self.assertIn(item['source']['url'], index)
            self.assertIn(item['license']['evidence_url'], index)
            self.assertEqual(len(item['source']['sha256']), 64)
            self.assertEqual(len(item['source']['resource_fingerprint']), 64)
            self.assertEqual(len(item['license_review']['sha256']), 64)
            self.assertIn(item['compatibility']['status'], ['static_instructions', 'requires_adaptation'])
            self.assertEqual(item['verification']['runtime'], 'not_run')

    def test_old_pins_and_shared_identity_survive_projection(self):
        merged = merge_catalog(self.research, self.general)
        by_id = {item['id']: item for item in merged['skills']}
        for old in self.research['skills']:
            for field in ['source', 'kind', 'license']:
                self.assertEqual(by_id[old['id']][field], old[field])
        self.assertEqual(len(merged['skills']), len(self.research['skills']) + 12)
        projected = {item['id']: item for item in runtime_catalog(merged)['skills']}
        for identity in self.general['shared_ids']:
            self.assertEqual(projected[identity]['discovery_scopes'], ['general', 'research'])
        self.assertTrue(all('frontmatter_yaml' not in item for item in projected.values()))

    def test_dedup_requires_both_fingerprints_and_preserves_first_identity(self):
        original = self.research['skills'][0]
        for same_resources, added in [(True, 0), (False, 1)]:
            other = deepcopy(original)
            other['id'] = 'other/skill'
            other['source']['repository'] = 'other/repository'
            if not same_resources:
                other['source']['resource_fingerprint'] = 'different'
            other['sources'] = [other['source']]
            general = {**self.general, 'skills': [other]}
            merged = merge_catalog(self.research, general)
            self.assertEqual(len(merged['skills']), len(self.research['skills']) + added)
            if same_resources:
                kept = next(item for item in merged['skills'] if item['id'] == original['id'])
                self.assertEqual(kept['source'], original['source'])
                self.assertIn(other['source'], kept['sources'])
        with self.assertRaisesRegex(ValueError, 'Duplicate skill identity'):
            merge_catalog(self.research, {**self.general, 'skills': [original]})
