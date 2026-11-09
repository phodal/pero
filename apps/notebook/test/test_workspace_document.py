"""New authoring components round trip through the same immutable revision boundary."""

import base64
from copy import deepcopy
from hashlib import sha256
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from document import NotebookDocument
from operations import apply_operations, parse_operations
from server import handler
from store import EntryStore


def workspace_document():
    data = b'local measurement\n'
    return {'schemaVersion': 1, 'title': 'Expanded record',
            'metadata': {'project': 'Local study', 'author': 'Display name', 'tags': ['calibration']},
            'procedures': [{'id': 'method', 'title': 'Method', 'description': 'Recorded manual steps',
                            'materials': [{'id': 'sample', 'name': 'Sample', 'quantity': '1 mL'}],
                            'steps': [{'id': 'step', 'text': 'Observe', 'level': 'step', 'critical': True,
                                       'pause': False, 'minutes': 2.5, 'completed': False}]}],
            'content': {'type': 'doc', 'content': [
                {'type': 'section', 'attrs': {'blockId': 'day', 'label': 'Day 1', 'date': '2026-11-09'}, 'content': [
                    {'type': 'paragraph', 'attrs': {'blockId': 'text'}, 'content': [
                        {'type': 'text', 'text': 'Evidence', 'marks': [
                            {'type': 'underline'}, {'type': 'superscript'}, {'type': 'textColor', 'attrs': {'tone': 'blue'}},
                            {'type': 'link', 'attrs': {'href': 'https://example.org/evidence', 'target': '_blank',
                                                     'rel': 'noopener noreferrer nofollow', 'class': None, 'title': None}},
                        ]}]},
                    {'type': 'attachment', 'attrs': {'blockId': 'file', 'filename': 'measurement.txt',
                        'mime': 'text/plain', 'data': base64.b64encode(data).decode(), 'caption': 'Original bytes',
                        'sha256': sha256(data).hexdigest()}},
                ]},
            ]}}


class WorkspaceDocumentTest(unittest.TestCase):
    def test_components_survive_revisions_and_scoped_agent_edits(self):
        value = workspace_document()
        original = NotebookDocument.parse(value)
        edited = apply_operations(original, parse_operations([
            {'op': 'replace_text', 'blockId': 'text', 'match': 'Evidence', 'replacement': 'Recorded evidence'},
        ], lambda: 'unused'))
        self.assertEqual(original.wire(), value)
        self.assertEqual(edited.wire()['metadata'], value['metadata'])
        self.assertEqual(edited.wire()['procedures'], value['procedures'])
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            entry = store.create(original)
            store.commit(entry.identity, 1, lambda _: edited)
            reopened = EntryStore(directory)
            self.assertEqual(reopened.read(entry.identity, 1).document.wire(), value)
            self.assertEqual(reopened.read(entry.identity).document.wire(), edited.wire())

    def test_component_boundaries_reject_bad_dates_files_marks_and_procedure_values(self):
        cases = [
            (('content', 'content', 0, 'attrs', 'date'), '2026-02-30'),
            (('content', 'content', 0, 'content', 1, 'attrs', 'sha256'), '0' * 64),
            (('content', 'content', 0, 'content', 1, 'attrs', 'data'), 'data:text/plain;base64,YQ=='),
            (('content', 'content', 0, 'content', 1, 'attrs', 'filename'), '../escape.txt'),
            (('content', 'content', 0, 'content', 1, 'attrs', 'mime'), 'image/svg+xml'),
            (('content', 'content', 0, 'content', 0, 'content', 0, 'marks', 3, 'attrs', 'href'), 'javascript:alert(1)'),
            (('content', 'content', 0, 'content', 0, 'content', 0, 'marks', 2, 'attrs', 'tone'), 'expression(evil)'),
            (('procedures', 0, 'steps', 0, 'minutes'), -1),
            (('procedures', 0, 'steps', 0, 'completed'), 'yes'),
            (('procedures', 0, 'steps', 0, 'id'), 'sample'),
            (('metadata', 'author'), 'a' * 201),
        ]
        for path, replacement in cases:
            with self.subTest(path=path):
                value = workspace_document()
                target = value
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = replacement
                with self.assertRaises(ValueError):
                    NotebookDocument.parse(value)

    def test_json_import_is_atomic_and_never_normalizes_unknown_content(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            with ThreadingHTTPServer(('127.0.0.1', 0), handler(store, 'fixture')) as server:
                worker = threading.Thread(target=server.serve_forever, daemon=True)
                worker.start()
                try:
                    def post(value):
                        connection = HTTPConnection('127.0.0.1', server.server_port)
                        body = json.dumps({'document': value})
                        connection.request('POST', '/api/entries', body, {'Content-Type': 'application/json', 'X-Pero-App-Token': 'fixture'})
                        response = connection.getresponse()
                        result = (response.status, json.loads(response.read()))
                        connection.close()
                        return result
                    valid = workspace_document()
                    invalid = deepcopy(valid)
                    invalid['content']['content'].append({'type': 'futureWidget'})
                    self.assertEqual(post(invalid)[0], 400)
                    self.assertEqual(store.list(), [])
                    status, entry = post(valid)
                    self.assertEqual(status, 201)
                    self.assertEqual(entry['document'], valid)
                    self.assertEqual(len(store.list()), 1)
                finally:
                    server.shutdown()
                    worker.join(3)


if __name__ == '__main__':
    unittest.main()
