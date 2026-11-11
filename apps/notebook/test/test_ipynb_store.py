"""Notebook sources use the existing revision owner, not a second notebook store."""
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import scientific_block
from document import NotebookDocument
from store import EntryStore, RevisionConflict
from ipynb_document import IpynbDocumentSource
SOURCE = (Path(__file__).resolve().parents[3] / 'packages/notebook/test/fixtures/ipynb-contract.json').read_text()

def document(source=SOURCE):
    return {'schemaVersion': 1, 'title': 'Notebook', 'content': {'type': 'doc', 'content': [
        {'type': 'ipynbDocument', 'attrs': {'blockId': 'ipynb-1', 'schemaVersion': 1, 'source': source}}]}}

class IpynbStoreTest(unittest.TestCase):
    def test_actual_revisions_preserve_exact_sources_and_reject_stale_save(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            parsed = NotebookDocument.parse(document())
            created = store.create(parsed)
            changed = document(SOURCE.replace('print', 'never_execute'))
            saved = store.commit(created.identity, 1, lambda _: NotebookDocument.parse(changed))
            self.assertEqual(saved.revision, 2)
            reopened = EntryStore(directory)
            self.assertEqual(reopened.read(created.identity, 1).document.wire(), document())
            self.assertEqual(reopened.read(created.identity).document.wire(), changed)
            with self.assertRaises(RevisionConflict):
                reopened.commit(created.identity, 1, lambda _: parsed)
            self.assertEqual(len(reopened.history(created.identity)), 2)

    def test_future_schema_and_escaped_scalar_budget_fail_before_storage(self):
        for schema in (True, 2):
            invalid = document()
            invalid['content']['content'][0]['attrs']['schemaVersion'] = schema
            with self.assertRaises(ValueError):
                NotebookDocument.parse(invalid)
        # JSON whitespace can fit the raw limit while its escaped scalar cannot.
        with self.assertRaises(ValueError):
            IpynbDocumentSource('\t' * (800 * 1024) + SOURCE)
        # JSON has one number kind; integral exponent/decimal forms match JS.
        self.assertEqual(IpynbDocumentSource(SOURCE.replace('"nbformat_minor":5', '"nbformat_minor":5.0')).source.count('5.0'), 1)
