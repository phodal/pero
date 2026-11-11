"""Historical blocks keep the document parser. The catalog does not become a second checker."""

from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import scientific_block  # noqa: F401  (registers the historical catalog)
from block_registry import block, reference_capability
from document import BLOCKS, NotebookDocument

ORIGIN = {'templateId': 'template-1', 'revision': 1, 'instanceId': 'instance-1', 'parameterValues': {}, 'idMap': {}}


class BlockCatalogTests(unittest.TestCase):
    def test_every_stored_type_has_one_historical_or_definition_owner(self):
        for name in BLOCKS:
            self.assertIsNotNone(block(name), name)
        self.assertIsNotNone(reference_capability('evidence'))
        self.assertIsNotNone(reference_capability('experiment'))
        for name in BLOCKS - {'evidence', 'experiment'}:
            self.assertIsNone(reference_capability(name), name)
        self.assertTrue(block('paragraph').historical)
        self.assertFalse(block('noteCard').historical)

    def test_old_prose_and_reference_json_round_trips_without_a_projection(self):
        document = {'schemaVersion': 1, 'title': 'Method', 'content': {'type': 'doc', 'content': [
            {'type': 'heading', 'attrs': {'blockId': 'title', 'level': 2, 'templateOrigin': ORIGIN}, 'content': [
                {'type': 'text', 'text': 'Preparation'},
            ]},
            {'type': 'paragraph', 'attrs': {'blockId': 'body'}, 'content': [{'type': 'text', 'text': 'Record the lot.'}]},
            {'type': 'evidence', 'attrs': {
                'blockId': 'paper-block', 'label': 'Imported report', 'snapshot': None,
                'source': {'app': 'paper-agent', 'kind': 'report-citation', 'id': 'a' * 64, 'version': 'a' * 64,
                           'locator': 'pero-app-location://paper-agent/main/report/' + 'a' * 64 + '/citation/0'},
            }},
        ]}}
        parsed = NotebookDocument.parse(document)
        self.assertEqual(parsed.wire(), document)
        with tempfile.TemporaryDirectory() as directory:
            from store import EntryStore
            store = EntryStore(directory)
            created = store.create(parsed)
            reopened = store.read(created.identity)
            self.assertEqual(reopened.document.wire(), document)
            self.assertEqual(reopened.document.block('title')['attrs']['templateOrigin'], ORIGIN)
            self.assertEqual(reopened.document.block('body')['attrs']['blockId'], 'body')
