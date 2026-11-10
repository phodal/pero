"""Recovery survives restarts without mutating published revision history."""
import json
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from document import NotebookDocument
from drafts import Draft, DraftStore, StoredDraftError
from store import EntryStore, RevisionConflict
from server import handler


def document(title='Saved'):
    return {'schemaVersion': 1, 'title': title, 'content': {'type': 'doc', 'content': [{'type': 'paragraph'}]}}


class DraftTests(unittest.TestCase):
    def test_restart_conflict_validation_and_corrupt_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            entries = EntryStore(directory)
            entry = entries.create(NotebookDocument.parse(document()))
            drafts = DraftStore(entries)
            drafts.save(entry.identity, Draft.parse({'baseRevision': 1, 'document': document('Local')}))
            self.assertEqual(DraftStore(EntryStore(directory)).read(entry.identity)['document']['title'], 'Local')
            self.assertEqual(len(entries.history(entry.identity)), 1)
            with self.assertRaises(ValueError):
                drafts.save(entry.identity, Draft.parse({'baseRevision': 1, 'document': document('')}))
            self.assertEqual(drafts.read(entry.identity)['document']['title'], 'Local')
            entries.commit(entry.identity, 1, lambda _: NotebookDocument.parse(document('Other writer')))
            with self.assertRaises(RevisionConflict):
                drafts.save(entry.identity, Draft.parse({'baseRevision': 1, 'document': document('Stale')}))
            self.assertEqual(drafts.read(entry.identity)['baseRevision'], 1)
            with entries._connect() as connection:
                connection.execute('UPDATE drafts SET document = ? WHERE entry_id = ?', ('{broken', entry.identity))
            with self.assertRaises(StoredDraftError) as failure:
                drafts.read(entry.identity)
            self.assertEqual(failure.exception.raw, '{broken')
            with self.assertRaises(StoredDraftError):
                drafts.save(entry.identity, Draft.parse({'baseRevision': 2, 'document': document('Replacement')}))
            drafts.discard(entry.identity, 2)
            self.assertIsNone(drafts.read(entry.identity))

    def test_authenticated_draft_routes_and_explicit_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            entries = EntryStore(directory)
            entry = entries.create(NotebookDocument.parse(document()))
            path = f'/api/entries/{entry.identity}'
            with ThreadingHTTPServer(('127.0.0.1', 0), handler(entries, 'secret')) as server:
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                def request(method, route, data=None):
                    connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                    try:
                        connection.request(method, route, json.dumps(data) if data is not None else None,
                                           {'Content-Type': 'application/json', 'X-Pero-App-Token': 'secret'})
                        response = connection.getresponse()
                        return response.status, json.loads(response.read())
                    finally:
                        connection.close()
                try:
                    self.assertEqual(request('GET', path + '/draft'), (200, {'draft': None}))
                    local = {'baseRevision': 1, 'document': document('Local')}
                    self.assertEqual(request('POST', path + '/draft', local)[0], 200)
                    self.assertEqual(request('GET', path + '/draft')[1]['draft']['document'], local['document'])
                    self.assertEqual(request('GET', path)[1]['revision'], 1)
                    self.assertEqual(request('POST', path, local)[1]['revision'], 2)
                    self.assertEqual(request('GET', path + '/draft'), (200, {'draft': None}))
                    self.assertEqual(request('POST', path + '/draft', local)[0], 409)
                    local['baseRevision'] = 2
                    self.assertEqual(request('POST', path + '/draft', local)[0], 200)
                    with entries._connect() as connection:
                        connection.execute('UPDATE drafts SET document = ?', ('broken JSON',))
                    status, failure = request('GET', path + '/draft')
                    self.assertEqual((status, failure['code'], failure['recovery']), (409, 'stored-draft-error', 'broken JSON'))
                    self.assertEqual(request('POST', path + '/draft', local)[0], 409)
                    self.assertEqual(request('POST', path + '/draft/discard', {'baseRevision': 2})[0], 200)
                    self.assertEqual(len(entries.history(entry.identity)), 2)
                finally:
                    server.shutdown()
                    thread.join()
