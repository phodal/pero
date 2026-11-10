"""Host reference proposals against a real owner export, plus registry extension."""

from dataclasses import dataclass
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from block_registry import register_block, register_operation, unregister_block, unregister_operation
from document import NotebookDocument, block_id
from server import handler
from store import EntryStore

FIXTURE = json.loads((Path(__file__).resolve().parents[3] / 'packages/notebook/test/fixtures/snapshot-contract.json').read_text())
REPORT = FIXTURE['bases']['paper']['reportId']
SOURCE = {
    'app': 'paper-agent', 'kind': 'report-citation', 'id': REPORT, 'version': REPORT,
    'locator': f'pero-app-location://paper-agent/main/report/{REPORT}/citation/{FIXTURE["bases"]["paper"]["citationIndex"]}',
}


def entry_document():
    return {'schemaVersion': 1, 'title': 'Paper evidence', 'content': {'type': 'doc', 'content': [
        {'type': 'paragraph', 'attrs': {'blockId': 'intro'}, 'content': [{'type': 'text', 'text': 'Opened from the owner export.'}]},
        {'type': 'evidence', 'attrs': {'blockId': 'paper-block', 'label': 'Imported report', 'source': SOURCE, 'snapshot': None}},
    ]}}


class Gauge:
    type_name = 'gaugeReading'

    def validate(self, value):
        version = value.get('schemaVersion', 1)
        if type(version) is not int or version < 1:
            raise ValueError('Invalid block schema version')
        block_id(value['blockId'])
        if version != 1:
            return
        if not isinstance(value.get('reading'), str) or not value['reading']:
            raise ValueError('Invalid gauge reading')


@dataclass
class Mark:
    identity: str
    registry_op: str = 'mark_block'


def parse_mark(value, _new_id):
    from document import fields
    fields(value, {'op', 'blockId'})
    return Mark(block_id(value['blockId']))


def apply_mark(document, operation):
    if not isinstance(operation, Mark):
        return
    document.block(operation.identity)['attrs']['label'] = 'marked'


class ScientificBlockTests(unittest.TestCase):
    def setUp(self):
        register_block(Gauge())
        register_operation('mark_block', parse_mark, apply_mark)

    def tearDown(self):
        unregister_block('gaugeReading')
        unregister_operation('mark_block')

    def test_registered_block_keeps_a_future_schema_and_a_new_operation_needs_no_dispatcher_edit(self):
        future = {'schemaVersion': 1, 'title': 'Gauge', 'content': {'type': 'doc', 'content': [
            {'type': 'gaugeReading', 'attrs': {'blockId': 'gauge', 'schemaVersion': 2, 'reading': 'kept', 'unit': 'mg'}},
        ]}}
        self.assertEqual(NotebookDocument.parse(future).wire(), future)
        with self.assertRaisesRegex(ValueError, 'gauge reading'):
            NotebookDocument.parse({'schemaVersion': 1, 'title': 'Gauge', 'content': {'type': 'doc', 'content': [
                {'type': 'gaugeReading', 'attrs': {'blockId': 'gauge', 'schemaVersion': 1}},
            ]}})
        from operations import apply_operations, parse_operations
        document = NotebookDocument.parse(entry_document())
        operations = parse_operations([{'op': 'mark_block', 'blockId': 'paper-block'}], lambda: 'unused')
        self.assertEqual(apply_operations(document, operations).block('paper-block')['attrs']['label'], 'marked')
        self.assertEqual(document.block('paper-block')['attrs']['label'], 'Imported report')

    def test_host_proposal_reviews_the_real_paper_reference(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            with ThreadingHTTPServer(('127.0.0.1', 0), handler(store, 'test-secret')) as server:
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    def request(method, path, data=None, authorized=True):
                        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                        try:
                            headers = {'Content-Type': 'application/json'}
                            if authorized:
                                headers['X-Pero-App-Token'] = 'test-secret'
                            body = json.dumps(data).encode() if data is not None else None
                            connection.request(method, path, body, headers)
                            response = connection.getresponse()
                            return response.status, json.loads(response.read())
                        finally:
                            connection.close()

                    self.assertEqual(request('POST', '/api/entries', {'document': entry_document()}, authorized=False)[0], 401)
                    status, created = request('POST', '/api/entries', {'document': entry_document()})
                    self.assertEqual(status, 201)
                    entry_id = created['id']
                    reopened = request('GET', f'/api/entries/{entry_id}')[1]
                    evidence = reopened['document']['content']['content'][1]
                    self.assertEqual(evidence['attrs']['blockId'], 'paper-block')
                    self.assertEqual(evidence['attrs']['source']['id'], REPORT)
                    self.assertNotEqual(evidence['attrs']['blockId'], evidence['attrs']['source']['version'])
                    proposal = {'proposalId': 'proposal-1', 'expectedRevision': 1, 'blockId': 'paper-block',
                                'decision': 'reject', 'label': 'Should not apply', 'source': SOURCE}
                    status, rejected = request('POST', f'/api/entries/{entry_id}/block-proposals', proposal)
                    self.assertEqual((status, rejected['proposal']['revision'], rejected['entry']['revision']), (200, 1, 1))
                    self.assertEqual(rejected['entry']['document']['content']['content'][1]['attrs']['label'], 'Imported report')
                    status, replay = request('POST', f'/api/entries/{entry_id}/block-proposals', proposal)
                    self.assertEqual((status, replay['replayed'], replay['entry']['revision']), (200, True, 1))
                    conflict = dict(proposal, proposalId='proposal-2', decision='accept', expectedRevision=4, label='Pinned report')
                    self.assertEqual(request('POST', f'/api/entries/{entry_id}/block-proposals', conflict)[0], 409)
                    denied = dict(proposal, proposalId='proposal-3', authorized=True)
                    self.assertEqual(request('POST', f'/api/entries/{entry_id}/block-proposals', denied)[0], 400)
                    accept = dict(proposal, proposalId='proposal-4', decision='accept', label='Pinned report')
                    status, accepted = request('POST', f'/api/entries/{entry_id}/block-proposals', accept)
                    self.assertEqual((status, accepted['entry']['revision']), (200, 2))
                    saved = accepted['entry']['document']['content']['content'][1]['attrs']
                    self.assertEqual(saved['label'], 'Pinned report')
                    self.assertEqual(saved['source'], SOURCE)
                    self.assertEqual(request('GET', f'/api/entries/{entry_id}/revisions/1')[1]['document']['content']['content'][1]['attrs']['label'], 'Imported report')
                    status, again = request('POST', f'/api/entries/{entry_id}/block-proposals', accept)
                    self.assertEqual((status, again['replayed'], again['entry']['revision']), (200, True, 2))
                    self.assertEqual(len(store.history(entry_id)), 2)
                finally:
                    server.shutdown()


if __name__ == '__main__':
    unittest.main()
