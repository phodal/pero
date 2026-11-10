"""Real SQLite projections and check recovery; no model execution is claimed."""
import copy
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from ai_proposals import AIProposalStore, ProposalConflict
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

    def test_check_request_reuses_durable_recovery_and_freezes_goal(self):
        store = AIProposalStore(self.entries)
        record = {'frozen': {'requestId': 'check-1', 'agentId': 'configured', 'target': {'entryId': self.entry.identity, 'revision': 1},
                            'content': '{"type":"doc","content":[]}', 'prompt': 'Review exact input', 'mode': 'checks', 'goal': 'Review omissions'},
                  'sessionId': 'host-session', 'status': 'completed', 'transcript': '{"checks":[]}', 'decisions': {}, 'application': 'reviewing'}
        saved = store.save(self.entry.identity, {'expectedVersion': 0, 'record': record})
        self.assertEqual(AIProposalStore(self.entries).read(self.entry.identity), saved)
        modified = copy.deepcopy(record); modified['frozen']['goal'] = 'Different goal'
        with self.assertRaises(ProposalConflict): store.save(self.entry.identity, {'expectedVersion': 1, 'record': modified})
        record['decisions'] = {'check-1': 'accepted'}
        store.save(self.entry.identity, {'expectedVersion': 1, 'record': record})
        self.assertEqual(AIProposalStore(self.entries).read(self.entry.identity)['record']['decisions'], record['decisions'])
        for patch in ({'goal': ''}, {'table': {}}, {'mode': 'unknown'}):
            modified = copy.deepcopy(record); modified['frozen'].update(patch)
            with self.assertRaises(ValueError): store.save(self.entry.identity, {'expectedVersion': 2, 'record': modified})
