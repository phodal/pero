"""Formatting metadata is bounded without altering scientific grid source cells."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from document import NotebookDocument


class GridDocumentTest(unittest.TestCase):
    def test_presentation_roundtrips_and_invalid_metadata_is_rejected(self):
        attrs = {'blockId': 'grid', 'sheet': {'rows': 3, 'columns': 3, 'cells': {'A1': '2.22', 'B1': '=A1*2'}},
                 'formats': {'A1': {'bold': True, 'precision': 1, 'foreground': 'blue', 'background': 'green', 'align': 'right'}},
                 'rowHeights': {'0': 100}, 'columnWidths': {'1': 200},
                 'merges': [{'start': {'column': 0, 'row': 1}, 'end': {'column': 1, 'row': 1}}]}
        def document(value):
            return {'schemaVersion': 1, 'title': 'Grid', 'content': {'type': 'doc', 'content': [{'type': 'spreadsheet', 'attrs': value}]}}
        self.assertEqual(NotebookDocument.parse(document(attrs)).wire(), document(attrs))
        identified = document(attrs)
        identified['identity'] = {'code': 'EXP25000012', 'status': 'in_progress'}
        identified['notices'] = [{'id': 'mention-1', 'name': 'Ada', 'at': '2026-11-10T00:00:00.000Z', 'note': 'check the table'}]
        self.assertEqual(NotebookDocument.parse(identified).wire(), identified)
        cases = [
            ('formats', {'D1': {'bold': True}}), ('formats', {'A1': {'bold': 1}}),
            ('formats', {'A1': {'precision': 13}}), ('formats', {'A1': {'foreground': 'red'}}),
            ('formats', {'A1': {'onclick': 'unsafe'}}), ('formats', None),
            ('rowHeights', {'00': 24}), ('rowHeights', {'0': 241}), ('columnWidths', {'3': 100}),
            ('merges', [{'start': {'column': 0, 'row': 0}, 'end': {'column': 0, 'row': 0}}]),
            ('merges', [attrs['merges'][0], attrs['merges'][0]]),
            ('merges', [{'start': {'column': 0, 'row': 0}, 'end': {'column': 3, 'row': 2}}]),
        ]
        for key, value in cases:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                changed = deepcopy(attrs); changed[key] = value
                NotebookDocument.parse(document(changed))

