import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from document import NotebookDocument


class NamedReferenceTests(unittest.TestCase):
    def test_authored_card_round_trip_and_invalid_fields(self):
        value = {'schemaVersion': 1, 'title': 'Entry cards', 'content': {'type': 'doc', 'content': [
            {'type': 'namedReference', 'attrs': {'blockId': 'card-1', 'kind': 'entry', 'name': 'Preparation', 'notes': 'Record settings.'}}
        ]}}
        self.assertEqual(NotebookDocument.parse(value).wire(), value)
        for patch in ({'kind': 'paper'}, {'name': ' '}, {'notes': ''}, {'name': 'x' * 201}, {'notes': 'x' * 20001}, {'source': {}}):
            with self.subTest(patch=next(iter(patch))):
                invalid = copy.deepcopy(value)
                invalid['content']['content'][0]['attrs'].update(patch)
                with self.assertRaises(ValueError):
                    NotebookDocument.parse(invalid)

    def test_validation_transport_is_authenticated_and_never_creates_entries(self):
        import json
        import tempfile
        import threading
        from http.client import HTTPConnection
        from http.server import ThreadingHTTPServer
        from server import handler
        from store import EntryStore
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            with ThreadingHTTPServer(('127.0.0.1', 0), handler(store, 'test-secret')) as server:
                thread = threading.Thread(target=server.serve_forever)
                thread.start()
                try:
                    valid = {'schemaVersion': 1, 'title': 'Validated only', 'content': {'type': 'doc', 'content': [{'type': 'paragraph'}]}}
                    for authorized, value, expected in [(False, valid, 401), (True, valid, 200), (True, {**valid, 'schemaVersion': 99}, 400)]:
                        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                        try:
                            headers = {'Content-Type': 'application/json'}
                            if authorized:
                                headers['X-Pero-App-Token'] = 'test-secret'
                            connection.request('POST', '/api/document/validate', json.dumps({'document': value}), headers)
                            response = connection.getresponse()
                            result = json.loads(response.read())
                            self.assertEqual(response.status, expected, result)
                            if expected == 200:
                                self.assertEqual(result['document'], valid)
                        finally:
                            connection.close()
                    self.assertEqual(store.list(), [])
                finally:
                    server.shutdown()
                    thread.join(timeout=3)
