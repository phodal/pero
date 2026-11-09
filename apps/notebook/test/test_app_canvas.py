import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app_canvas import AppCanvasBinding


class AppCanvasTest(unittest.TestCase):
    def test_navigation_binding_admission(self):
        value = {'id': 'binding-1', 'app': 'control-lab', 'panel': 'main'}
        self.assertEqual(AppCanvasBinding.parse(value).app, 'control-lab')
        self.assertIsNone(AppCanvasBinding.parse(None))
        for bad in ({**value, 'app': 'javascript:alert(1)'}, {**value, 'panel': '../main'}, {**value, 'action': 'run'}, {**value, 'id': ''}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                AppCanvasBinding.parse(bad)

    def test_saved_sources_cover_all_roots_and_readonly_never_grants_write(self):
        from copy import deepcopy
        import tempfile
        from document import NotebookDocument
        from store import EntryStore
        from app_canvas import verify_source
        binding = dict(id='binding', app='data', panel='main', view='dataset-inspector', declaration='a' * 64, inputs={'datasetId': 'ds-' + 'b' * 32})
        def root(identity):
            return {'type': 'doc', 'content': [{'type': 'appCanvas', 'attrs': {'blockId': identity, 'label': 'Data', 'binding': {**binding, 'receipt': {'unverified': 'imported'}}}}]}
        doc = dict(schemaVersion=1, title='Canvas sources', content=root('notes'), procedures=[dict(id='procedure', title='Procedure', description='',
            introduction=root('introduction'), materials=[dict(id='material', name='Sample', quantity='1', content=root('material-note'),
                children=[dict(id='child', name='Child', quantity='2', content=root('child-note'))])],
            steps=[dict(id='step', text='', level='step', critical=False, pause=False, minutes=None, completed=False, content=root('step-note'))])])
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            first = store.create(NotebookDocument.parse(doc))
            source = dict(entryId=first.identity, revision=1, blockId='notes', binding=binding, readOnly=False, write=True)
            for identity in ['notes', 'introduction', 'material-note', 'child-note', 'step-note']:
                self.assertEqual(verify_source(store, {**source, 'blockId': identity}), {'valid': True})
            for change in [dict(readOnly=True), dict(blockId='absent'), dict(binding={**binding, 'inputs': {'datasetId': 'ds-' + 'c' * 32}}), dict(binding={**binding, 'receipt': {}})]:
                with self.subTest(change=change), self.assertRaises(ValueError):
                    verify_source(store, {**source, **change})
            changed = deepcopy(doc); changed['content']['content'][0]['attrs']['binding'] = None
            store.commit(first.identity, 1, lambda _: NotebookDocument.parse(changed))
            with self.assertRaises(ValueError):
                verify_source(store, source)
            self.assertEqual(verify_source(store, {**source, 'readOnly': True, 'write': False}), {'valid': True})
            with self.assertRaises(ValueError):
                verify_source(store, {**source, 'revision': 2})

    def test_internal_source_route_requires_host_token(self):
        from http.client import HTTPConnection
        from http.server import ThreadingHTTPServer
        import json
        import tempfile
        import threading
        from document import NotebookDocument
        from server import handler
        from store import EntryStore
        binding = dict(id='binding', app='data', panel='main', view='dataset-inspector', declaration='a' * 64, inputs={'datasetId': 'ds-' + 'b' * 32})
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            entry = store.create(NotebookDocument.parse(dict(schemaVersion=1, title='Source', content={'type': 'doc', 'content': [
                {'type': 'appCanvas', 'attrs': {'blockId': 'canvas', 'label': '', 'binding': binding}}]})))
            with ThreadingHTTPServer(('127.0.0.1', 0), handler(store, 'private-host-token')) as server:
                thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
                try:
                    body = json.dumps(dict(entryId=entry.identity, revision=1, blockId='canvas', binding=binding, readOnly=True, write=False))
                    for token, expected in [('', 401), ('private-host-token', 200)]:
                        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                        connection.request('POST', '/internal/canvas/source', body, {'Content-Type': 'application/json', 'X-Pero-App-Token': token})
                        response = connection.getresponse(); result = json.loads(response.read())
                        self.assertEqual(response.status, expected)
                        if expected == 200:
                            self.assertEqual(result, {'valid': True})
                        connection.close()
                finally:
                    server.shutdown(); thread.join(timeout=3)
