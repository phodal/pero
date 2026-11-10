"""Actual SQLite revision/audit persistence, recovery conflicts and HTTP composition."""
from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from document import NotebookDocument
from drafts import Draft, DraftStore
from store import EntryStore, RevisionConflict
from worksheet_amendments import WorksheetAmendment, WorksheetAmendmentStore, worksheet_amendment_route


def document():
    return {'schemaVersion': 1, 'title': 'Audited worksheet', 'content': {'type': 'doc', 'content': [
        {'type': 'spreadsheet', 'attrs': {'blockId': 'sheet', 'label': 'Measured inputs', 'sheet': {'rows': 2, 'columns': 2, 'cells': {'A1': '2', 'A2': '=A1*2'}}, 'annotations': {'A1': {'unit': 'mL', 'evidenceIds': []}}}},
        {'type': 'paragraph', 'content': [{'type': 'text', 'text': 'Receipt remains historical'}]}]}}


def request(**patch):
    return WorksheetAmendment.parse(dict(operationId='amendment-1', expectedRevision=1, worksheetId='sheet', edits={'A1': '3'}, author='Local researcher', reason='Correct transcription against the original measurement', **patch))


class WorksheetAmendmentsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.entries = EntryStore(self.temp.name); self.owner = WorksheetAmendmentStore(self.entries)
        self.entry = self.entries.create(NotebookDocument.parse(document()))

    def test_new_revision_preserves_historical_content_and_audits_exact_before_after(self):
        original = self.entry.document.serialized()
        result = self.owner.amend(self.entry.identity, request())
        self.assertEqual(result['entry']['revision'], 2)
        self.assertEqual(result['amendment']['changes'], [{'address': 'A1', 'before': '2', 'after': '3'}])
        self.assertEqual(result['amendment']['baseRevision'], 1)
        self.assertEqual(result['amendment']['attribution'], 'local-user-label-not-authenticated-signature')
        self.assertEqual(self.entries.read(self.entry.identity, 1).document.serialized(), original)
        latest = self.entries.read(self.entry.identity).document.wire()
        expected = document(); expected['content']['content'][0]['attrs']['sheet']['cells']['A1'] = '3'
        self.assertEqual(latest, expected)
        reopened = WorksheetAmendmentStore(EntryStore(self.temp.name))
        self.assertEqual(reopened.list(self.entry.identity), [result['amendment']])
        self.assertEqual(reopened.amend(self.entry.identity, request()), result)
        self.assertEqual(len(self.entries.history(self.entry.identity)), 2)

    def test_invalid_changes_stale_revision_and_durable_draft_never_append_partial_audit(self):
        base = request().wire()
        for patch in [{'edits': {'C1': '3'}}, {'edits': {'A1': '2'}}, {'worksheetId': 'missing'}, {'edits': {}}, {'author': ' '}, {'reason': ''}, {'edits': {'A1': 'x' * 4097}}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                self.owner.amend(self.entry.identity, WorksheetAmendment.parse({**base, **patch}))
        self.assertEqual(self.owner.list(self.entry.identity), [])
        drafts = DraftStore(self.entries); drafts.save(self.entry.identity, Draft(1, self.entry.document))
        with self.assertRaisesRegex(ValueError, 'draft'):
            self.owner.amend(self.entry.identity, request())
        self.assertEqual(len(self.entries.history(self.entry.identity)), 1)
        drafts.discard(self.entry.identity, 1)
        self.owner.amend(self.entry.identity, request())
        with self.assertRaises(RevisionConflict):
            self.owner.amend(self.entry.identity, WorksheetAmendment.parse({**base, 'operationId': 'amendment-2'}))
        with self.assertRaisesRegex(ValueError, 'different inputs'):
            self.owner.amend(self.entry.identity, WorksheetAmendment.parse({**base, 'reason': 'Different'}))
        self.assertEqual(len(self.owner.list(self.entry.identity)), 1)

    def test_selected_procedure_worksheet_and_blank_input_apply_in_place_only_to_new_revision(self):
        raw = document(); raw['procedures'] = [{'id': 'procedure', 'title': 'Procedure', 'description': '', 'materials': [], 'steps': [
            {'id': 'step', 'text': '', 'level': 'step', 'critical': False, 'pause': False, 'minutes': None, 'completed': False,
             'content': {'type': 'doc', 'content': [deepcopy(raw['content']['content'][0])]}}]}]
        raw['procedures'][0]['steps'][0]['content']['content'][0]['attrs']['blockId'] = 'step-sheet'
        entry = self.entries.create(NotebookDocument.parse(raw))
        change = WorksheetAmendment.parse({**request().wire(), 'worksheetId': 'step-sheet', 'edits': {'A1': ''}})
        result = self.owner.amend(entry.identity, change)
        self.assertNotIn('A1', result['entry']['document']['procedures'][0]['steps'][0]['content']['content'][0]['attrs']['sheet']['cells'])
        self.assertEqual(result['entry']['document']['content']['content'][0]['attrs']['sheet']['cells']['A1'], '2')
        self.assertEqual(self.entries.read(entry.identity, 1).document.wire(), raw)

    def test_route_uses_same_owner_and_reports_actual_receipt(self):
        path = f'/api/entries/{self.entry.identity}/amendments'
        status, result = worksheet_amendment_route(self.owner, 'POST', path, lambda: request().wire())
        self.assertEqual(status, 200)
        self.assertEqual(worksheet_amendment_route(self.owner, 'GET', path, lambda: None)[1]['amendments'], [result['amendment']])
        self.assertIsNone(worksheet_amendment_route(self.owner, 'GET', path + '?bad=yes', lambda: None))

if __name__ == '__main__':
    unittest.main()
