"""The SDK and persisted Notebook document accept the same MyST source wires."""

import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import scientific_block  # Register the Notebook scientific/document block types.
from document import NotebookDocument
from store import EntryStore

FIXTURE = Path(__file__).resolve().parents[3] / 'packages/notebook/test/fixtures/myst-document-contract.json'


class MystDocumentContractTests(unittest.TestCase):
    def test_source_wire_corpus_survives_persistence(self):
        fixture = json.loads(FIXTURE.read_text(encoding='utf-8'))
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            for case in fixture['cases']:
                with self.subTest(case=case['name']):
                    wire = {**fixture['document'], 'content': {'type': 'doc', 'content': [
                        {'type': 'mystDocument', 'attrs': case['attrs']},
                    ]}}
                    if not case['accepted']:
                        with self.assertRaises(ValueError):
                            NotebookDocument.parse(wire)
                        continue
                    created = store.create(NotebookDocument.parse(wire))
                    reopened = EntryStore(directory).read(created.identity).document.wire()
                    self.assertEqual(reopened, wire)
                    self.assertEqual(reopened['content']['content'][0]['attrs']['source'].encode('utf-8'),
                                     case['attrs']['source'].encode('utf-8'))

    def test_utf8_source_wire_budget(self):
        fixture = json.loads(FIXTURE.read_text(encoding='utf-8'))
        boundary = fixture['utf8Boundary']
        source = boundary['unit'] * boundary['repeat'] + boundary['suffix']
        self.assertEqual(len(source.encode('utf-8')), boundary['maxBytes'])
        attrs = {'blockId': 'utf8-contract', 'schemaVersion': 1, 'source': source}
        wire = {**fixture['document'], 'content': {'type': 'doc', 'content': [
            {'type': 'mystDocument', 'attrs': attrs},
        ]}}
        serialized = NotebookDocument.parse(wire).serialized()
        self.assertEqual(NotebookDocument.parse(json.loads(serialized)).wire(), wire)
        attrs['source'] += boundary['overflow']
        with self.assertRaises(ValueError):
            NotebookDocument.parse(wire)
