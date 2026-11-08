"""Notebook revision semantics and the authenticated UI/Agent transport."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from hashlib import sha256
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import sqlite3
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from agent_read import AgentRead
from document import NotebookDocument
from operations import apply_operations, parse_operations
from server import handler
from store import EntryStore, RevisionConflict, StoredDocumentError


def document(title='Research log'):
    return {'schemaVersion': 1, 'title': title, 'content': {'type': 'doc', 'content': [
        {'type': 'paragraph', 'attrs': {'blockId': 'paragraph'}, 'content': [
            {'type': 'text', 'text': '样品 ', 'marks': [{'type': 'bold'}]},
            {'type': 'text', 'text': 'A、A'},
        ]},
        {'type': 'spreadsheet', 'attrs': {
            'blockId': 'inputs', 'label': 'Inputs', 'sheet': {'rows': 2, 'columns': 2, 'cells': {'A1': '=1+2'}},
            'annotations': {'A1': {'unit': 'µL', 'evidenceIds': ['source']}},
        }},
        {'type': 'evidence', 'attrs': {'blockId': 'source', 'label': 'Paper', 'source': {
            'app': 'paper-agent', 'kind': 'paper', 'id': 'p-1', 'version': 'sha256:abc', 'locator': 'page 3',
        }}},
    ]}}


class NotebookTest(unittest.TestCase):
    def test_revisions_survive_reopen_and_competing_saves_have_one_winner(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            first = store.create(NotebookDocument.parse(document()))
            second = store.create(NotebookDocument.parse(document('Independent record')))
            self.assertNotEqual(first.identity, second.identity)
            barrier = threading.Barrier(2)

            def save(title):
                snapshot = NotebookDocument.parse(document(title))
                barrier.wait(timeout=3)
                try:
                    return store.commit(first.identity, 1, lambda _old: snapshot)
                except RevisionConflict as error:
                    return error.current_revision

            with ThreadPoolExecutor(max_workers=2) as pool:
                attempts = list(pool.map(save, ['One', 'Two']))
            self.assertEqual(attempts.count(2), 1)
            reopened = EntryStore(directory)
            self.assertEqual(len(reopened.list()), 2)
            self.assertEqual([item['revision'] for item in reopened.history(first.identity)], [2, 1])
            self.assertEqual(reopened.read(first.identity, 1).wire(), first.wire())
            self.assertEqual(reopened.read(second.identity).wire(), second.wire())

    def test_stored_documents_refuse_unsupported_content_without_rewriting_it(self):
        future = document()
        future['schemaVersion'] = 2
        unknown_attribute = document()
        unknown_attribute['content']['content'][0]['attrs']['futureFormat'] = 'preserve me'
        for raw, error in [(json.dumps(future), 'Unsupported Notebook document version'),
                           (json.dumps(unknown_attribute), 'Invalid object fields'),
                           ('{', 'Expecting property name')]:
            with self.subTest(raw=raw), tempfile.TemporaryDirectory() as directory:
                store = EntryStore(directory)
                entry = store.create(NotebookDocument.parse(document()))
                # Simulate a revision persisted by a newer app, not an accepted v1 write.
                with closing(sqlite3.connect(store.path)) as connection, connection:
                    connection.execute('UPDATE revisions SET document = ? WHERE entry_id = ?',
                                       (raw, entry.identity))
                for revision in (None, 1):
                    with self.assertRaisesRegex(StoredDocumentError, error):
                        store.read(entry.identity, revision)
                with self.assertRaisesRegex(StoredDocumentError, error):
                    store.commit(entry.identity, 1, lambda _old: NotebookDocument.parse(document('Replacement')))
                self.assertEqual(len(store.history(entry.identity)), 1)
                with closing(sqlite3.connect(store.path)) as connection:
                    self.assertEqual(connection.execute('SELECT document FROM revisions').fetchone()[0], raw)

    def test_document_roundtrips_annotations_and_rejects_unknown_or_invalid_content(self):
        original = document()
        self.assertEqual(NotebookDocument.parse(original).wire(), original)
        cases = [
            ({'type': 'arbitraryScript'}, 'type'),
            ({'type': 'paragraph', 'attrs': {'blockId': 'paragraph'}}, 'Duplicate block ID'),
            ({'type': 'spreadsheet', 'attrs': {'blockId': 'new', 'sheet': {'rows': 2, 'columns': 2, 'cells': {}},
                                             'annotations': {'C1': {'unit': 'L', 'evidenceIds': []}}}}, 'outside'),
        ]
        for node, error in cases:
            with self.subTest(node=node):
                invalid = document()
                invalid['content']['content'].append(node)
                with self.assertRaisesRegex(ValueError, error):
                    NotebookDocument.parse(invalid)

    def test_ordered_list_starts_roundtrip_without_relaxing_other_integer_bounds(self):
        for start in (0, -3, 1, -2_147_483_648, 2_147_483_647,
                      -2_147_483_649, 2_147_483_648, True, 0.5, '0', None):
            with self.subTest(start=start):
                original = document()
                original['content']['content'].append({
                    'type': 'orderedList', 'attrs': {'blockId': 'steps', 'start': start},
                    'content': [{'type': 'listItem', 'content': [{'type': 'paragraph'}]}],
                })
                if type(start) is not int or not -2_147_483_648 <= start <= 2_147_483_647:
                    with self.assertRaisesRegex(ValueError, 'Invalid list start'):
                        NotebookDocument.parse(original)
                    continue
                with tempfile.TemporaryDirectory() as directory:
                    store = EntryStore(directory)
                    entry = store.create(NotebookDocument.parse(document()))
                    store.commit(entry.identity, 1, lambda _old: NotebookDocument.parse(original))
                    self.assertEqual(EntryStore(directory).read(entry.identity).document.wire(), original)
        for node, message in [
            ({'type': 'heading', 'attrs': {'level': 0}}, 'heading level'),
            ({'type': 'spreadsheet', 'attrs': {'blockId': 'zero-rows',
                'sheet': {'rows': 0, 'columns': 1, 'cells': {}}}}, 'row count'),
        ]:
            with self.subTest(node=node):
                original = document()
                original['content']['content'].append(node)
                with self.assertRaisesRegex(ValueError, message):
                    NotebookDocument.parse(original)
        with self.assertRaisesRegex(ValueError, 'Invalid revision'):
            AgentRead(revision=0)

    def test_imported_evidence_stays_bound_to_its_exact_source_and_check_values(self):
        original = document()
        nodes = original['content']['content']
        paper = nodes[-1]['attrs']
        report_id = 'a' * 64
        paper['source'] = dict(app='paper-agent', kind='report-citation', id=report_id,
                               version=report_id, locator=f'pero-app-location://paper-agent/main/report/{report_id}/citation/0')
        paper['snapshot'] = dict(kind='paper-report', reportId=report_id, intentId='b' * 64,
                                 exportSha256='c' * 64, citationIndex=0, paperId='d' * 64,
                                 paperContentDigest='sha256:' + 'e' * 64, passageId='f' * 64,
                                 documentId='1' * 64, fileDigest='2' * 64, page=3, start=10, end=12,
                                 quote='样品', occurrences=1)
        run, trial, observation = '3' * 32, '4' * 32, '5' * 64
        check = dict(name='Steady state', verdict='PASS', actual=1.0, limit=0.5, message='结果')
        body = dict(candidateId='baseline', specHash='6' * 64, verdict='PASS',
                    verifierVersion='control-lab-verifier-v1', checks=[check], evidence=[observation])
        digest = sha256(json.dumps(body, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        receipt = dict(kind='control-receipt', trialId=trial, observationId=observation,
                       candidateId='baseline', scenarioId='nominal', phase='verification', specHash='6' * 64,
                       inputDigest='7' * 64, reportId=digest, verifierVersion='control-lab-verifier-v1',
                       verdict='PASS', checks=[dict(check, actual='1.0', limit='0.5')], exportSha256='8' * 64)
        nodes.append({'type': 'experiment', 'attrs': dict(
            blockId='trial', label='Control run', snapshot=receipt,
            source=dict(app='control-lab', kind='verification-report', id=run, version=digest,
                        locator=f'pero-app-location://control-lab/main/experiment/{run}/trial/{trial}'))})
        parsed = NotebookDocument.parse(original)
        self.assertEqual(parsed.wire(), original)
        edits = parse_operations([{'op': 'set_cells', 'blockId': 'inputs', 'cells': {'A1': '=2+3'}}], lambda: 'unused')
        self.assertEqual(apply_operations(parsed, edits).block('trial')['attrs']['snapshot'], receipt)
        receipt['checks'][0]['actual'] = '1.1'
        with self.assertRaisesRegex(ValueError, 'report digest'):
            NotebookDocument.parse(original)
        receipt['checks'][0]['actual'] = '1.0'
        paper['source']['version'] = '9' * 64
        with self.assertRaisesRegex(ValueError, 'source reference'):
            NotebookDocument.parse(original)

    def test_scoped_edits_preserve_marks_and_unchanged_scientific_metadata(self):
        original = NotebookDocument.parse(document())
        ops = parse_operations([
            {'op': 'replace_text', 'blockId': 'paragraph', 'match': '样品', 'replacement': '实验样品'},
            {'op': 'set_cells', 'blockId': 'inputs', 'cells': {'A1': '=2+4', 'B2': '6'}},
            {'op': 'add_finding', 'claim': 'Observed change', 'limitations': 'Single run', 'evidenceIds': ['source']},
        ], lambda: 'finding')
        result = apply_operations(original, ops)
        self.assertEqual(result.block('paragraph')['content'][0],
                         {'type': 'text', 'text': '实验样品 ', 'marks': [{'type': 'bold'}]})
        self.assertEqual(result.block('inputs')['attrs']['annotations'], original.block('inputs')['attrs']['annotations'])
        self.assertEqual(original.block('inputs')['attrs']['sheet']['cells'], {'A1': '=1+2'})
        self.assertEqual(result.block('inputs')['attrs']['sheet']['cells'], {'A1': '=2+4', 'B2': '6'})
        self.assertEqual(result.block('finding')['attrs']['evidenceIds'], ['source'])
        for match in ('A', '样品 A'):
            with self.subTest(match=match):
                edit = parse_operations([{'op': 'replace_text', 'blockId': 'paragraph',
                                          'match': match, 'replacement': 'new'}], lambda: 'unused')
                with self.assertRaises(ValueError):
                    apply_operations(original, edit)

    def test_agent_reads_discover_blocks_and_reconstruct_large_unicode_content(self):
        original = document()
        # One valid spreadsheet itself exceeds the adapter's one-megabyte limit.
        original['content']['content'][1]['attrs']['sheet'] = {
            'rows': 200, 'columns': 2,
            'cells': {f'{column}{row}': '样品\n"' * 250
                      for row in range(1, 201) for column in ('A', 'B')},
        }
        parsed = NotebookDocument.parse(original)
        index = AgentRead().read(parsed)
        self.assertEqual(index['format'], 'block-index')
        self.assertEqual([item['blockId'] for item in index['blocks']], ['paragraph', 'inputs', 'source'])
        self.assertIsNone(index['nextOffset'])
        for block_identity, expected in [(None, original), ('inputs', parsed.block('inputs'))]:
            with self.subTest(block=block_identity):
                selection = AgentRead(block_identity=block_identity, offset=0)
                chunks = []
                while True:
                    page = selection.read(parsed)
                    self.assertEqual(page['format'], 'json-chunk')
                    self.assertLess(len(json.dumps(page, ensure_ascii=False).encode()), 900_000)
                    chunks.append(page['content'])
                    if page['nextOffset'] is None:
                        break
                    selection = AgentRead(revision=7, block_identity=block_identity, offset=page['nextOffset'])
                self.assertEqual(json.loads(''.join(chunks)), expected)
        self.assertEqual(AgentRead(block_identity='inputs').read(parsed)['format'], 'json-chunk')
        self.assertEqual(AgentRead().read(NotebookDocument.parse(document())), {'document': document()})

    def test_agent_index_pages_nested_blocks_and_requires_pinned_continuations(self):
        original = document()
        original['content']['content'] = [{'type': 'blockquote', 'attrs': {'blockId': 'quote'},
            'content': [{'type': 'paragraph', 'attrs': {'blockId': f'p-{index}'}} for index in range(205)]}]
        parsed = NotebookDocument.parse(original)
        discovered = []
        selection = AgentRead(view='index')
        while True:
            page = selection.read(parsed)
            self.assertLessEqual(len(page['blocks']), 100)
            discovered.extend(item['blockId'] for item in page['blocks'])
            if page['nextOffset'] is None:
                break
            selection = AgentRead(revision=1, view='index', offset=page['nextOffset'])
        self.assertEqual(discovered, ['quote'] + [f'p-{index}' for index in range(205)])
        for arguments in ({'offset': 1}, {'offset': -1}, {'offset': True}, {'offset': 0.5},
                          {'view': 'unknown'}, {'view': 'index', 'block_identity': 'quote'},
                          {'revision': 1, 'offset': 10_000_000}):
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                AgentRead(**arguments).read(parsed)
        with self.assertRaises(LookupError):
            AgentRead(block_identity='missing').read(parsed)
        # Even documents without any IDs have a complete chunked read path.
        parsed = NotebookDocument.parse({'schemaVersion': 1, 'title': 'No IDs',
                                         'content': {'type': 'doc', 'content': [{'type': 'paragraph'}]}})
        self.assertEqual(AgentRead(view='index').read(parsed)['blocks'], [])
        self.assertEqual(json.loads(AgentRead(offset=0).read(parsed)['content']), parsed.wire())

    def test_authenticated_routes_and_atomic_agent_batch(self):
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
                            connection.request(method, path, json.dumps(data, ensure_ascii=False).encode() if data is not None else None, headers)
                            response = connection.getresponse()
                            return response.status, json.loads(response.read())
                        finally:
                            connection.close()

                    self.assertEqual(request('GET', '/api/entries', authorized=False)[0], 401)
                    status, entry = request('POST', '/api/entries', {'title': 'Notebook'})
                    self.assertEqual((status, entry['revision']), (201, 1))
                    entry_id = entry['id']
                    path = f'/api/entries/{entry_id}'
                    status, entry = request('POST', path, {'baseRevision': 1, 'document': document()})
                    self.assertEqual((status, entry['revision']), (200, 2))
                    status, block = request('POST', '/api/agent-read', {'entryId': entry_id, 'blockId': 'inputs'})
                    self.assertEqual((status, block['block']['attrs']['blockId']), (200, 'inputs'))

                    ops = [
                        {'op': 'set_cells', 'blockId': 'inputs', 'cells': {'A1': '=3+4'}},
                        {'op': 'set_cells', 'blockId': 'inputs', 'cells': {'C1': 'invalid'}},
                    ]
                    apply = {'entryId': entry_id, 'baseRevision': 2, 'operations': ops}
                    self.assertEqual(request('POST', '/api/agent-apply', apply)[0], 400)
                    self.assertEqual(request('GET', path), (200, entry))
                    apply['operations'] = ops[:1]
                    status, receipt = request('POST', '/api/agent-apply', apply)
                    self.assertEqual((status, receipt['revision'], receipt['blockIds']), (200, 3, ['inputs']))
                    status, conflict = request('POST', '/api/agent-apply', apply)
                    self.assertEqual((status, conflict['code'], conflict['currentRevision']), (409, 'revision-conflict', 3))
                    self.assertEqual(request('GET', f'{path}/revisions/2'), (200, entry))
                    self.assertEqual(request('GET', f'{path}/revisions')[1]['revisions'][0]['revision'], 3)
                    status, page = request('POST', '/api/agent-read', {
                        'entryId': entry_id, 'revision': 2, 'offset': 0,
                    })
                    self.assertEqual((status, page['revision'], page['format']), (200, 2, 'json-chunk'))
                    self.assertEqual(json.loads(page['content']), entry['document'])
                    for invalid in ({'offset': 1}, {'revision': None}, {'offset': None}, {'blockId': None}):
                        self.assertEqual(request('POST', '/api/agent-read', {'entryId': entry_id, **invalid})[0], 400)
                    status, index = request('POST', '/api/agent-read', {'entryId': entry_id, 'view': 'index'})
                    self.assertEqual((status, index['revision'], index['blocks'][1]['blockId']), (200, 3, 'inputs'))


                    apply['baseRevision'] = 3
                    insert = {'op': 'insert_text_block', 'kind': 'heading', 'text': 'Results\nSummary',
                              'afterBlockId': 'paragraph'}
                    apply['operations'] = [insert, {'op': 'delete_block', 'blockId': 'source'}]
                    self.assertEqual(request('POST', '/api/agent-apply', apply)[0], 400)
                    self.assertEqual(request('GET', path)[1]['revision'], 3)
                    apply['operations'] = [insert,
                        {'op': 'insert_spreadsheet', 'name': 'Summary', 'rows': 2, 'columns': 1, 'cells': {'A1': '=Inputs!A1'}},
                        {'op': 'move_block', 'blockId': 'source', 'anchorBlockId': 'inputs', 'side': 'before'},
                        {'op': 'delete_block', 'blockId': 'paragraph'},
                    ]
                    status, receipt = request('POST', '/api/agent-apply', apply)
                    self.assertEqual((status, receipt['revision']), (200, 4))
                    heading_id, sheet_id, _, _ = receipt['blockIds']
                    blocks = request('GET', path)[1]['document']['content']['content']
                    self.assertEqual([node['attrs']['blockId'] for node in blocks], [heading_id, 'source', 'inputs', sheet_id])
                    self.assertEqual(blocks[0]['content'][1], {'type': 'hardBreak'})
                    self.assertEqual(blocks[3]['attrs']['sheet']['cells'], {'A1': '=Inputs!A1'})

                    large = document()
                    large['content']['content'][1]['attrs']['sheet'] = {
                        'rows': 200, 'columns': 2,
                        'cells': {f'{column}{row}': '样' * 1000
                                  for row in range(1, 201) for column in ('A', 'B')},
                    }
                    self.assertEqual(request('POST', path, {'baseRevision': 4, 'document': large})[0], 200)
                    status, index = request('POST', '/api/agent-read', {'entryId': entry_id})
                    self.assertEqual((status, index['format'], index['revision']), (200, 'block-index', 5))
                    selected = index['blocks'][1]['blockId']
                    status, page = request('POST', '/api/agent-read', {'entryId': entry_id, 'blockId': selected})
                    self.assertEqual((status, page['format']), (200, 'json-chunk'))
                    fragments = [page['content']]
                    # A concurrent edit cannot alter the revision being reconstructed.
                    self.assertEqual(request('POST', path, {'baseRevision': 5, 'document': document()})[0], 200)
                    while page['nextOffset'] is not None:
                        status, page = request('POST', '/api/agent-read', {
                            'entryId': entry_id, 'revision': 5, 'blockId': selected, 'offset': page['nextOffset'],
                        })
                        self.assertEqual((status, page['revision']), (200, 5))
                        self.assertLess(len(json.dumps(page, ensure_ascii=False).encode()), 1_000_000)
                        fragments.append(page['content'])
                    self.assertEqual(json.loads(''.join(fragments)), large['content']['content'][1])

                    future = document()
                    future['schemaVersion'] = 2
                    raw = json.dumps(future)
                    with closing(sqlite3.connect(store.path)) as connection, connection:
                        connection.execute('UPDATE revisions SET document = ? WHERE entry_id = ? AND revision = 6',
                                           (raw, entry_id))
                    for method, route, data in [
                        ('GET', path, None),
                        ('POST', '/api/agent-read', {'entryId': entry_id}),
                        ('POST', path, {'baseRevision': 6, 'document': document()}),
                    ]:
                        status, failure = request(method, route, data)
                        self.assertEqual((status, failure['code'], failure['revision'], failure['entryId']),
                                         (500, 'stored-document-error', 6, entry_id))
                        self.assertIn('Unsupported Notebook document version', failure['detail'])
                    status, failure = request('POST', path, {'baseRevision': 6, 'document': future})
                    self.assertEqual((status, failure['code']), (400, 'invalid-request'))
                    self.assertEqual(len(store.history(entry_id)), 6)
                    with closing(sqlite3.connect(store.path)) as connection:
                        self.assertEqual(connection.execute(
                            'SELECT document FROM revisions WHERE entry_id = ? AND revision = 6',
                            (entry_id,)).fetchone()[0], raw)


                finally:
                    server.shutdown()
                    thread.join(3)


if __name__ == '__main__':
    unittest.main()
