"""Real SQLite home projections; no model execution is claimed."""
import copy
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from document import NotebookDocument
from notebook_home import notebook_home
from store import EntryStore


class NotebookHomeChecksTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.entries = EntryStore(self.temp.name)
        self.document = {'schemaVersion': 1, 'title': 'Local source', 'metadata': {'project': 'Project A', 'author': 'Local researcher', 'tags': ['tag']},
                         'content': {'type': 'doc', 'content': [{'type': 'paragraph'}]}}
        self.entry = self.entries.create(NotebookDocument.parse(self.document))

    def test_home_projects_current_saved_labels_without_inventing_identity(self):
        changed = copy.deepcopy(self.document); changed['metadata']['project'] = 'Project B'
        self.entries.commit(self.entry.identity, 1, lambda _: NotebookDocument.parse(changed))
        home = notebook_home(self.entries)
        self.assertEqual(home['scope'], 'local-display-labels')
        self.assertFalse(home['limited'])
        self.assertEqual(home['entries'], [{'entryId': self.entry.identity, 'title': 'Local source', 'revision': 2, 'project': 'Project B', 'author': 'Local researcher'}])
        self.assertNotIn('authenticated', str(home))
        self.assertEqual(self.entries.read(self.entry.identity, 1).document.metadata.project, 'Project A')
