"""Published local templates, query revisions, and fixed search snapshots."""
from copy import deepcopy
from pathlib import Path
import sqlite3
import json
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import threading
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from document import NotebookDocument
from saved_search import SavedSearchDefinition, SavedSearchStore, parse_saved_search_attributes
from store import EntryStore, RevisionConflict, StoredDocumentError
from server import handler
from templates import TemplateDefinition, TemplateStore, parse_template_origin, preserve_template_origins


def document(title='Experiment', text='Measured sample', tags=None):
    return dict(schemaVersion=1, title=title, metadata=dict(project='', author='', tags=tags or []), content=dict(type='doc', content=[
        dict(type='paragraph', attrs=dict(blockId='text'), content=[dict(type='text', text=text)]),
        dict(type='spreadsheet', attrs=dict(blockId='sheet', label='Inputs', sheet=dict(rows=2, columns=2, cells={'A1': '5', 'B1': '=A1*2'}), annotations={})),
    ]))


def definition():
    return dict(name='Template', description='Local protocol', kind='entry', collections=['Protocols'], document=document(), parameters=[
        dict(key='amount', label='Amount', type='decimal', required=True, target=dict(kind='spreadsheet-cell', blockId='sheet', address='A1'), default=2.5),
    ])


def search(text='', title='', tags=None):
    return SavedSearchDefinition.parse(dict(name='Saved query', query=dict(scope='entries', text=text, title=title, tags=tags or [], sort='title-asc')))


class TemplateSearchTest(unittest.TestCase):
    def test_publications_are_immutable_with_conflicts_archive_and_reopen(self):
        with tempfile.TemporaryDirectory() as directory:
            entries = EntryStore(directory)
            templates = TemplateStore(entries)
            raw = definition()
            first = templates.publish(TemplateDefinition.parse(raw))
            raw['document']['title'] = 'Second version'
            second = templates.publish(TemplateDefinition.parse(raw), first['id'], 1)
            self.assertEqual(second['revision'], 2)
            self.assertEqual(templates.read(first['id'], 1), first)
            with self.assertRaises(RevisionConflict):
                templates.publish(TemplateDefinition.parse(raw), first['id'], 1)
            templates.archive(first['id'], True)
            self.assertTrue(templates.read(first['id'], 1)['archived'])
            with self.assertRaisesRegex(ValueError, 'Restore'):
                templates.publish(TemplateDefinition.parse(raw), first['id'], 2)
            templates.archive(first['id'], False)
            reopened = TemplateStore(EntryStore(directory))
            self.assertEqual(reopened.read(first['id'], 1), first)
            self.assertEqual(reopened.list()[0]['revision'], 2)
            self.assertNotIn('document', reopened.list()[0])

    def test_typed_parameters_reject_stale_calculated_or_invalid_bindings(self):
        for mutation in [
            lambda p: p.update(default=True), lambda p: p.update(default='2'),
            lambda p: p.update(target=dict(kind='spreadsheet-cell', blockId='sheet', address='B1')),
            lambda p: p.update(target=dict(kind='spreadsheet-cell', blockId='sheet', address='Z1')),
            lambda p: p.update(target=dict(kind='block-text', blockId='gone')),
            lambda p: p.update(target=dict(kind='block-attribute', blockId='sheet', field='source')),
        ]:
            raw = definition(); mutation(raw['parameters'][0])
            with self.subTest(parameter=raw['parameters']), self.assertRaises(ValueError):
                TemplateDefinition.parse(raw)
        raw = definition(); raw['kind'] = 'fragment'
        raw['parameters'][0].update(type='text', default='x', target=dict(kind='title'))
        with self.assertRaisesRegex(ValueError, 'entry text'):
            TemplateDefinition.parse(raw)

    def test_lineage_changes_are_rejected_but_removal_is_allowed(self):
        origin = dict(templateId='source', revision=1, instanceId='instance', parameterValues={'amount': 0, 'flag': False}, idMap={'old': 'new'})
        self.assertEqual(parse_template_origin(origin), origin)
        before = document(); before['templateOrigin'] = origin
        after = deepcopy(before); after['templateOrigin']['revision'] = 2
        with self.assertRaisesRegex(ValueError, 'immutable'):
            preserve_template_origins(before, after)
        with self.assertRaisesRegex(ValueError, 'immutable'):
            preserve_template_origins(before, document())
        block_before = document(); block_before['content']['content'][0]['attrs']['templateOrigin'] = origin
        block_after = document(); block_after['content']['content'].pop(0)
        preserve_template_origins(block_before, block_after)
        # Rich procedure content has the same immutable fragment lineage as Notes.
        procedure_before = document()
        procedure_before['procedures'] = [dict(id='procedure', title='Method', description='', materials=[], steps=[
            dict(id='step', text='', level='step', critical=False, pause=False, minutes=None, completed=False,
                 kind='description', content=dict(type='doc', content=[dict(type='paragraph', attrs=dict(
                     blockId='procedure-text', templateOrigin=origin), content=[])]))])]
        NotebookDocument.parse(procedure_before)
        for change in ('revision', 'remove'):
            procedure_after = deepcopy(procedure_before)
            attrs = procedure_after['procedures'][0]['steps'][0]['content']['content'][0]['attrs']
            if change == 'revision':
                attrs['templateOrigin']['revision'] = 2
            else:
                del attrs['templateOrigin']
            NotebookDocument.parse(procedure_after)
            with self.assertRaisesRegex(ValueError, 'immutable'):
                preserve_template_origins(procedure_before, procedure_after)
        procedure_removed = deepcopy(procedure_before)
        procedure_removed['procedures'][0]['steps'] = []
        preserve_template_origins(procedure_before, procedure_removed)
        invalid = deepcopy(origin); invalid['idMap']['another'] = 'new'
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            parse_template_origin(invalid)

    def test_live_query_tracks_actual_heads_while_snapshots_and_query_revisions_stay_fixed(self):
        with tempfile.TemporaryDirectory() as directory:
            entries = EntryStore(directory); queries = SavedSearchStore(entries)
            first = entries.create(NotebookDocument.parse(document('Alpha assay', 'Enzyme measured', ['DNA'])))
            entries.create(NotebookDocument.parse(document('Other', 'Other sample', ['RNA'])))
            query = queries.save(search('enzyme', 'assay', ['dna']))
            snapshot = queries.run(query['id'], 1)
            self.assertEqual([(row['entryId'], row['revision']) for row in snapshot['results']], [(first.identity, 1)])
            attrs = dict(blockId='query-block', label='Enzyme', queryId=query['id'], queryRevision=1, mode='snapshot', snapshot=snapshot)
            parse_saved_search_attributes(attrs)
            entries.commit(first.identity, 1, lambda _: NotebookDocument.parse(document('Changed', 'Removed', ['DNA'])))
            second = entries.create(NotebookDocument.parse(document('Beta assay', 'Enzyme measured again', ['DNA'])))
            current = queries.run(query['id'], 1)
            self.assertEqual([row['entryId'] for row in current['results']], [second.identity])
            self.assertEqual(snapshot['results'][0]['title'], 'Alpha assay')
            self.assertEqual(entries.read(snapshot['results'][0]['entryId'], snapshot['results'][0]['revision']).document.title, 'Alpha assay')
            revised = queries.save(search('removed'), query['id'], 1)
            self.assertEqual(revised['revision'], 2)
            self.assertEqual(queries.read(query['id'], 1), query)
            with self.assertRaises(RevisionConflict):
                queries.save(search(), query['id'], 1)
            self.assertEqual(SavedSearchStore(EntryStore(directory)).read(query['id']), revised)
            self.assertEqual(queries.run(query['id'], 2)['results'][0]['entryId'], first.identity)

    def test_query_empty_and_invalid_source_are_different_outcomes(self):
        with tempfile.TemporaryDirectory() as directory:
            entries = EntryStore(directory); queries = SavedSearchStore(entries)
            query = queries.save(search('absent'))
            self.assertEqual(queries.run(query['id'], 1)['results'], [])
            entry = entries.create(NotebookDocument.parse(document()))
            with sqlite3.connect(entries.path) as connection:
                connection.execute('UPDATE revisions SET document = ? WHERE entry_id = ?', ('{}', entry.identity))
            with self.assertRaises(StoredDocumentError):
                queries.run(query['id'], 1)

    def test_snapshot_validation_cannot_relabel_live_results_or_wrong_query(self):
        attrs = dict(blockId='block', label='Query', queryId='query', queryRevision=1, mode='live', snapshot=None)
        parse_saved_search_attributes(attrs)
        attrs['snapshot'] = dict(queryId='query', queryRevision=1, results=[], refreshedAt='2026-01-01T00:00:00Z')
        with self.assertRaisesRegex(ValueError, 'Live query'):
            parse_saved_search_attributes(attrs)
        attrs['mode'] = 'snapshot'; parse_saved_search_attributes(attrs)
        attrs['snapshot']['queryRevision'] = 2
        with self.assertRaisesRegex(ValueError, 'does not match'):
            parse_saved_search_attributes(attrs)


class TemplateSearchTransportTest(unittest.TestCase):
    def test_real_routes_publish_instantiate_save_snapshot_import_and_reject_stale_lineage(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EntryStore(directory)
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(store, 'local-test'))
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                def request(method, path, body=None, token='local-test'):
                    connection = HTTPConnection('127.0.0.1', server.server_port, timeout=5)
                    raw = json.dumps(body).encode() if body is not None else None
                    connection.request(method, path, body=raw, headers={'Content-Type': 'application/json', 'X-Pero-App-Token': token})
                    response = connection.getresponse(); value = json.loads(response.read()); status = response.status
                    connection.close()
                    return status, value

                self.assertEqual(request('GET', '/api/templates', token='wrong')[0], 401)
                status, published = request('POST', '/api/templates', definition()); self.assertEqual(status, 201)
                self.assertEqual(request('GET', '/api/templates')[1]['templates'][0]['id'], published['id'])
                status, prior = request('GET', '/api/templates/' + published['id'] + '?revision=1')
                self.assertEqual((status, prior), (200, published))
                status, revised = request('POST', '/api/templates/' + published['id'] + '/revisions', {'expectedRevision': 1, 'definition': definition()})
                self.assertEqual((status, revised['revision']), (201, 2))
                self.assertEqual(request('POST', '/api/templates/' + published['id'] + '/revisions', {'expectedRevision': 1, 'definition': definition()})[0], 409)
                self.assertTrue(request('POST', '/api/templates/' + published['id'] + '/archive', {'archived': True})[1]['archived'])
                self.assertFalse(request('POST', '/api/templates/' + published['id'] + '/archive', {'archived': False})[1]['archived'])

                instance = document()
                origin = dict(templateId=published['id'], revision=1, instanceId='instance', parameterValues={'amount': 0}, idMap={'source': 'text'})
                instance['templateOrigin'] = origin
                instance['content']['content'][0]['attrs']['templateOrigin'] = origin
                status, entry = request('POST', '/api/entries', {'document': instance}); self.assertEqual(status, 201)
                self.assertEqual(entry['document'], instance)
                status, query = request('POST', '/api/saved-searches', {'name': 'Experiments', 'query': search('sample').query.wire()})
                self.assertEqual(status, 201)
                self.assertEqual(request('GET', '/api/saved-searches')[1]['searches'][0], query)
                status, projection = request('POST', '/api/saved-searches/' + query['id'] + '/run', {'revision': 1})
                self.assertEqual((status, projection['results'][0]['entryId']), (200, entry['id']))
                attrs = dict(blockId='query', label=query['name'], queryId=query['id'], queryRevision=1, mode='snapshot', snapshot=projection)
                instance['content']['content'].append(dict(type='savedSearch', attrs=attrs))
                status, updated = request('POST', '/api/entries/' + entry['id'], {'baseRevision': 1, 'document': instance})
                self.assertEqual((status, updated.get('revision')), (200, 2))
                self.assertEqual(request('GET', '/api/entries/' + entry['id'] + '/revisions/2')[1]['document'], instance)
                status, imported = request('POST', '/api/entries', {'document': updated['document']})
                self.assertEqual(status, 201); self.assertNotEqual(imported['id'], entry['id'])
                self.assertEqual(imported['document']['content']['content'][-1]['attrs']['snapshot'], projection)
                invalid = deepcopy(instance); invalid['templateOrigin']['revision'] = 2
                self.assertEqual(request('POST', '/api/entries/' + entry['id'], {'baseRevision': 2, 'document': invalid})[0], 400)
                self.assertEqual(store.read(entry['id']).revision, 2)
                self.assertEqual(request('GET', '/api/saved-searches/' + query['id'] + '?revision=2')[0], 404)
                self.assertEqual(request('GET', '/api/catalog/lookup?limit=1&limit=2')[0], 400)
            finally:
                server.shutdown(); thread.join(timeout=5); server.server_close()


if __name__ == '__main__':
    unittest.main()
