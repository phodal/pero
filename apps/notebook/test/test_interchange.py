"""Retention envelope accepted by the Notebook document parser."""

import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from document import BLOCKS, NotebookDocument


def document(content):
    return {'schemaVersion': 1, 'title': 'Interchange', 'content': {'type': 'doc', 'content': content}}


class InterchangeTests(unittest.TestCase):
    def test_retained_block_round_trips_and_unknown_type_is_rejected(self):
        payload = {'type': 'instrumentReading', 'attrs': {'blockId': 'inst-1', 'reading': 'kept'},
                   'content': [{'type': 'paragraph', 'attrs': {'blockId': 'p1'}, 'content': [{'type': 'text', 'text': 'raw'}]}]}
        value = document([{'type': 'retainedBlock', 'attrs': {'blockId': 'inst-1', 'originalType': 'instrumentReading', 'payload': payload}}])
        self.assertEqual(NotebookDocument.parse(value).wire(), value)
        self.assertIn('retainedBlock', BLOCKS)
        with self.assertRaises(ValueError):
            NotebookDocument.parse(document([payload]))

    def test_retention_envelope_rejects_a_known_type_or_a_mismatched_id(self):
        payload = {'type': 'paragraph', 'attrs': {'blockId': 'p1'}}
        with self.assertRaisesRegex(ValueError, 'retained block type'):
            NotebookDocument.parse(document([{'type': 'retainedBlock', 'attrs': {'blockId': 'p1', 'originalType': 'paragraph', 'payload': payload}}]))
        foreign = {'type': 'instrumentReading', 'attrs': {'blockId': 'other', 'reading': 'kept'}}
        with self.assertRaisesRegex(ValueError, 'does not match'):
            NotebookDocument.parse(document([{'type': 'retainedBlock', 'attrs': {'blockId': 'inst-1', 'originalType': 'instrumentReading', 'payload': foreign}}]))
        huge = {'type': 'instrumentReading', 'attrs': {'blockId': 'inst-1', 'reading': 'x' * 70_000}}
        with self.assertRaisesRegex(ValueError, 'too large'):
            NotebookDocument.parse(document([{'type': 'retainedBlock', 'attrs': {'blockId': 'inst-1', 'originalType': 'instrumentReading', 'payload': huge}}]))

    def test_existing_evidence_identity_is_unchanged(self):
        source = {'app': 'control-lab', 'kind': 'verification-report', 'id': 'a' * 32, 'version': 'b' * 64, 'locator': ''}
        value = document([{'type': 'evidence', 'attrs': {'blockId': 'block-1', 'label': 'Control receipt', 'source': source, 'snapshot': None}}])
        parsed = NotebookDocument.parse(value).wire()
        self.assertEqual(parsed['content']['content'][0]['attrs']['blockId'], 'block-1')
        self.assertEqual(parsed['content']['content'][0]['attrs']['source']['version'], 'b' * 64)
        self.assertNotEqual(parsed['content']['content'][0]['attrs']['blockId'], parsed['content']['content'][0]['attrs']['source']['version'])


if __name__ == '__main__':
    unittest.main()
