"""Procedure rich content reuses Notes validation and immutable revision storage."""
from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from document import NotebookDocument
from store import EntryStore


def protocol():
    return {'schemaVersion': 1, 'title': 'Protocol', 'content': {'type': 'doc', 'content': [
        {'type': 'paragraph', 'attrs': {'blockId': 'notes'}}]},
        'procedures': [{'id': 'procedure', 'title': 'Method', 'description': '', 'materials': [], 'steps': [
            {'id': kind, 'kind': kind, 'text': '', 'level': 'step', 'critical': False, 'pause': False,
             'minutes': 2, 'completed': False, 'content': {'type': 'doc', 'content': [
                 {'type': 'paragraph', 'attrs': {'blockId': f'{kind}-body'}, 'content': [
                     {'type': 'text', 'text': 'Instruction', 'marks': [{'type': 'bold'}]}]}]},
             **({'timer': {'elapsedMs': 1250, 'startedAt': 10000}} if kind == 'timer' else {})}
            for kind in ('header', 'step', 'description', 'image', 'table', 'timer')]}]}


class ProcedureStepsTest(unittest.TestCase):
    def test_rich_steps_round_trip_and_reopen(self):
        value = protocol()
        with tempfile.TemporaryDirectory() as directory:
            entry = EntryStore(directory).create(NotebookDocument.parse(value))
            self.assertEqual(EntryStore(directory).read(entry.identity).document.wire(), value)

    def test_strict_step_schema_and_shared_node_boundary(self):
        value = protocol()
        for patch in ({'kind': 'unknown'}, {'timer': {'elapsedMs': True, 'startedAt': None}},
                      {'timer': {'elapsedMs': -1, 'startedAt': None}},
                      {'timer': {'elapsedMs': 0, 'startedAt': float('inf')}},
                      {'content': None}, {'content': {'type': 'script'}}, {'extra': True}):
            bad = deepcopy(value)
            bad['procedures'][0]['steps'][-1].update(patch)
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                NotebookDocument.parse(bad)
        bad = deepcopy(value)
        bad['procedures'][0]['steps'][0]['content']['content'][0]['content'][0]['marks'] = [
            {'type': 'link', 'attrs': {'href': 'javascript:alert(1)'}}]
        with self.assertRaises(ValueError):
            NotebookDocument.parse(bad)

    def test_block_ids_cannot_collide_between_steps_or_main_notes(self):
        for identity in ('notes', 'header-body', 'procedure', 'timer'):
            value = protocol()
            value['procedures'][0]['steps'][-1]['content']['content'][0]['attrs']['blockId'] = identity
            with self.subTest(identity=identity), self.assertRaises(ValueError):
                NotebookDocument.parse(value)

    def test_rich_step_blocks_support_bounded_agent_reads_edits_and_search(self):
        from agent_read import AgentRead
        from operations import apply_operations, parse_operations
        from saved_search import entry_search_text
        value = protocol()
        step = value['procedures'][0]['steps'][0]
        step['text'] = 'obsolete legacy instruction'
        step['content']['content'].append({'type': 'spreadsheet', 'attrs': {
            'blockId': 'step-sheet', 'sheet': {'rows': 1, 'columns': 1, 'cells': {'A1': 'reagent'}}}})
        document = NotebookDocument.parse(value)
        index = AgentRead(view='index').read(document)
        self.assertIn({'blockId': 'header-body', 'type': 'paragraph'}, index['blocks'])
        self.assertIn({'blockId': 'step-sheet', 'type': 'spreadsheet'}, index['blocks'])
        self.assertEqual(AgentRead(block_identity='step-sheet').read(document)['block']['attrs']['sheet']['cells'], {'A1': 'reagent'})
        operations = parse_operations([
            {'op': 'replace_text', 'blockId': 'header-body', 'match': 'Instruction', 'replacement': 'Incubation'},
            {'op': 'set_cells', 'blockId': 'step-sheet', 'cells': {'A1': 'buffer'}},
        ], lambda: 'fresh-id')
        changed = apply_operations(document, operations)
        self.assertEqual(changed.block('step-sheet')['attrs']['sheet']['cells'], {'A1': 'buffer'})
        self.assertEqual(document.block('step-sheet')['attrs']['sheet']['cells'], {'A1': 'reagent'})
        text = entry_search_text(changed)
        self.assertIn('Incubation', text)
        self.assertIn('buffer', text)
        self.assertNotIn('obsolete legacy instruction', text)
        with self.assertRaises(ValueError):
            parse_operations([{'op': 'set_cells', 'blockId': 'step-sheet', 'cells': {'A1': '=WEBSERVICE("https://example.com")'}}], lambda: 'fresh-id')

    def test_procedure_citations_prevent_deleting_their_notes_evidence(self):
        from operations import apply_operations, parse_operations
        value = protocol()
        value['content']['content'].append({'type': 'evidence', 'attrs': {
            'blockId': 'source', 'label': 'Paper', 'source': {
                'app': 'paper', 'kind': 'paper', 'id': 'paper1', 'version': 'v1', 'locator': ''}}})
        value['procedures'][0]['steps'][0]['content']['content'].append({'type': 'finding', 'attrs': {
            'blockId': 'step-finding', 'claim': 'Supported', 'limitations': '', 'evidenceIds': ['source']}})
        with self.assertRaises(ValueError):
            apply_operations(NotebookDocument.parse(value), parse_operations([
                {'op': 'delete_block', 'blockId': 'source'}], lambda: 'fresh-id'))
