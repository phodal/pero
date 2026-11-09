"""Value transitions plus real SQLite and authenticated HTTP table/collection seams."""
from copy import deepcopy
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from catalog import CatalogStore, StructuredTableDraft
from catalog_archive import CatalogArchiveStore
from document import NotebookDocument
from server import handler
from store import EntryStore, MissingEntry, RevisionConflict
from table_workflows import TableSourcePolicy, TableWorkflowStore, SourceRecord, plan_table_resync
from template_collections import CollectionChange, CollectionLibrary, TemplateCollectionStore, change_collection_library
from templates import TemplateDefinition, TemplateStore


def table(identity='target', value=None):
    return dict(id=identity, name=identity, schema=dict(id=identity + '-schema', revision=1, columns=[
        dict(id='name', name='Name', type='text', required=True, options=[], units=[]),
        dict(id='note', name='Note', type='text', required=False, options=[], units=[])]),
        rows=[] if value is None else [dict(id='row', cells={'name': value, 'note': ''})])


def policy(**patch):
    return dict(query=dict(schemaId='source-schema', text='', limit=200), mappings=[dict(sourceColumnId='name', targetColumnId='name')],
                addNew=True, updateExisting=True, missing='keep', **patch)


def notebook_document(draft=None):
    return dict(schemaVersion=1, title='Imported table', content=dict(type='doc', content=[
        dict(type='inputTable', attrs=dict(blockId='input', table=draft or table(), receipts=[]))]))


def configure(store, entry_id, identity, revision, source):
    return store.configure(entry_id, identity, dict(expectedRevision=revision, table=table(identity), change=dict(type='source', source=source)))


class CollectionDomainTest(unittest.TestCase):
    def test_hierarchy_memberships_and_named_destinations(self):
        state = CollectionLibrary()
        changes = [({'type': 'create', 'name': 'Assays', 'parentId': None}, 'root'),
                   ({'type': 'create', 'name': 'PCR', 'parentId': 'root'}, 'child'),
                   ({'type': 'create', 'name': 'Other', 'parentId': None}, 'other'),
                   ({'type': 'assign-template', 'templateId': 'template', 'collectionId': 'child'}, ''),
                   ({'type': 'rename', 'id': 'root', 'name': 'Protocols'}, ''),
                   ({'type': 'move', 'id': 'child', 'parentId': 'other'}, '')]
        for raw, identity in changes:
            state = change_collection_library(state, CollectionChange.parse(raw), identity)
        self.assertEqual(dict(state.memberships), {'template': 'child'})
        self.assertEqual({item.identity: item.parent for item in state.collections}, {'root': None, 'other': None, 'child': 'other'})
        for raw, message in [({'type': 'move', 'id': 'other', 'parentId': 'child'}, 'descendant'),
                             ({'type': 'move', 'id': 'child', 'parentId': 'child'}, 'itself'),
                             ({'type': 'create', 'name': 'protocols', 'parentId': None}, 'already exists'),
                             ({'type': 'move', 'id': 'child', 'parentId': 'gone'}, 'no longer exists')]:
            with self.subTest(raw=raw), self.assertRaisesRegex(ValueError, message):
                change_collection_library(state, CollectionChange.parse(raw), 'fresh')
        unchanged = change_collection_library(state, CollectionChange.parse({'type': 'assign-template', 'templateId': 'template', 'collectionId': None}), '')
        self.assertFalse(unchanged.memberships)


class TableResyncDomainTest(unittest.TestCase):
    def test_manual_cells_deletions_and_missing_sources_are_preserved(self):
        target = StructuredTableDraft.parse(table())
        options = TableSourcePolicy.parse(policy())
        source = SourceRecord('record', 1, (('name', 'text'),), (('name', 'A'),))
        first = plan_table_resync(target, options, (), (source,))
        row = first.table.wire()['rows'][0]
        row['cells'].update(name='Manual', note='Observed')
        edited = first.table.wire(); edited['rows'] = [row]
        newer = SourceRecord('record', 2, (('name', 'text'),), (('name', 'B'),))
        next_plan = plan_table_resync(StructuredTableDraft.parse(edited), options, first.baseline, (newer,))
        self.assertEqual(next_plan.table.wire(), edited)
        self.assertEqual([item.kind for item in next_plan.changes], ['preserve-manual'])
        self.assertEqual(next_plan.baseline[0].version, 2)
        self.assertEqual(next_plan.baseline[0].overrides, ('name',))
        equal_source = SourceRecord('record', 3, (('name', 'text'),), (('name', 'Manual'),))
        equal_plan = plan_table_resync(next_plan.table, options, next_plan.baseline, (equal_source,))
        later = plan_table_resync(equal_plan.table, options, equal_plan.baseline, (newer,))
        self.assertEqual(later.table.wire(), edited, 'A source catching up to a manual value must not erase the override')
        updated = plan_table_resync(first.table, options, first.baseline, (newer,))
        self.assertEqual(updated.table.wire()['rows'][0]['cells']['name'], 'B')
        removed = plan_table_resync(target, options, first.baseline, (newer,))
        self.assertFalse(removed.table.rows)
        self.assertEqual(removed.changes[0].kind, 'preserve-deleted-row')
        missing = TableSourcePolicy.parse({**policy(), 'missing': 'remove-unedited'})
        self.assertFalse(plan_table_resync(first.table, missing, first.baseline, ()).table.rows)
        kept = plan_table_resync(StructuredTableDraft.parse(edited), missing, first.baseline, ())
        self.assertEqual(kept.changes[0].kind, 'preserve-manual-row')
        self.assertEqual(kept.table.wire(), edited)

    def test_invalid_source_mapping_and_limits_do_not_partially_apply(self):
        options = TableSourcePolicy.parse(policy())
        for source in [SourceRecord('record', 1, (('name', 'decimal'),), (('name', '1'),)),
                       SourceRecord('record', 1, (('gone', 'text'),), (('gone', 'A'),))]:
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, 'source field'):
                plan_table_resync(StructuredTableDraft.parse(table()), options, (), (source,))
        invalid = policy(); invalid['mappings'] *= 2
        with self.assertRaisesRegex(ValueError, 'same target'):
            TableSourcePolicy.parse(invalid)
        target = table(); target['rows'] = [dict(id=f'row-{index}', cells={}) for index in range(200)]
        with self.assertRaisesRegex(ValueError, '200-row'):
            plan_table_resync(StructuredTableDraft.parse(target), options, (), (SourceRecord('record', 1, (('name', 'text'),), (('name', 'A'),)),))


class WorkflowPersistenceTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.entries = EntryStore(self.directory.name)
        self.entry = self.entries.create(NotebookDocument.parse(notebook_document()))
        self.catalog = CatalogStore(self.entries.path)
        self.workflows = TableWorkflowStore(self.entries, self.catalog)
        self.source = table('source', 'A')
        self.receipt = self.catalog.register(dict(submissionId='initial', table=self.source))

    def test_saved_views_and_explicit_resync_are_durable_guarded_and_recoverable(self):
        draft = table()
        saved = configure(self.workflows, self.entry.identity, 'target', 0, policy())
        view = dict(id='view', name='Names', columns=['name'], text='A', sortColumn='name', descending=False)
        saved = self.workflows.configure(self.entry.identity, 'target', dict(expectedRevision=saved['revision'], table=draft, change=dict(type='save-view', view=view)))
        self.assertEqual(TableWorkflowStore(self.entries, self.catalog).read(self.entry.identity, 'target')['views'], [view])
        preview = self.workflows.preview(self.entry.identity, 'target', dict(expectedRevision=saved['revision'], table=draft))
        self.assertFalse(self.workflows.read(self.entry.identity, 'target')['baseline'], 'preview must not commit source tracking')
        changed = deepcopy(draft); changed['name'] = 'Changed'
        with self.assertRaisesRegex(ValueError, 'table changed'):
            self.workflows.apply(self.entry.identity, 'target', dict(previewId=preview['id'], table=changed))
        result = self.workflows.apply(self.entry.identity, 'target', dict(previewId=preview['id'], table=draft))
        self.assertEqual(result['table']['rows'][0]['cells'], {'name': 'A'})
        self.assertEqual(self.workflows.apply(self.entry.identity, 'target', dict(previewId=preview['id'], table=draft)), result)
        self.assertEqual(self.workflows.read(self.entry.identity, 'target')['lastApplied'], result)
        self.assertEqual(result['workflow']['baseline'][0]['recordId'], self.receipt['records'][0]['recordId'])
        stale = self.workflows.preview(self.entry.identity, 'target', dict(expectedRevision=result['workflow']['revision'], table=result['table']))
        self.source['rows'][0]['cells']['name'] = 'B'
        self.catalog.register(dict(submissionId='second', table=self.source))
        with self.assertRaisesRegex(ValueError, 'source changed'):
            self.workflows.apply(self.entry.identity, 'target', dict(previewId=stale['id'], table=result['table']))
        with self.assertRaises(RevisionConflict):
            configure(self.workflows, self.entry.identity, 'target', 0, policy())
        preview = self.workflows.preview(self.entry.identity, 'target', dict(expectedRevision=result['workflow']['revision'], table=result['table']))
        configure(self.workflows, self.entry.identity, 'target', result['workflow']['revision'], policy())
        with self.assertRaises(RevisionConflict):
            self.workflows.apply(self.entry.identity, 'target', dict(previewId=preview['id'], table=result['table']))

    def test_two_imported_entries_isolate_settings_previews_and_recovery_without_changing_documents(self):
        imported = self.entries.create(NotebookDocument.parse(self.entry.document.wire()))
        first_id, second_id = self.entry.identity, imported.identity
        self.assertNotEqual(first_id, second_id)
        self.assertEqual(self.entry.document.wire(), imported.document.wire())
        draft = table()
        view = dict(id='view', name='First entry view', columns=['name'], text='A', sortColumn='name', descending=False)
        configure(self.workflows, first_id, 'target', 0, policy())
        self.workflows.configure(first_id, 'target', dict(expectedRevision=1, table=draft, change=dict(type='save-view', view=view)))
        preview = self.workflows.preview(first_id, 'target', dict(expectedRevision=2, table=draft))
        result = self.workflows.apply(first_id, 'target', dict(previewId=preview['id'], table=draft))
        first = self.workflows.read(first_id, 'target')
        self.assertEqual(result['entryId'], first_id)
        self.assertEqual(self.workflows.read(second_id, 'target'), dict(revision=0, views=[], source=None, baseline=[], lastApplied=None))
        with self.assertRaisesRegex(ValueError, 'preview does not exist'):
            self.workflows.apply(second_id, 'target', dict(previewId=preview['id'], table=draft))
        other_policy = policy(); other_policy['query']['text'] = 'another query'
        configure(self.workflows, second_id, 'target', 0, other_policy)
        self.workflows.configure(second_id, 'target', dict(expectedRevision=1, table=draft,
            change=dict(type='save-view', view={**view, 'name': 'Second entry view'})))
        reopened = TableWorkflowStore(self.entries, self.catalog)
        self.assertEqual(reopened.read(first_id, 'target'), first)
        self.assertEqual(reopened.read(second_id, 'target')['views'][0]['name'], 'Second entry view')
        self.assertIsNone(reopened.read(second_id, 'target')['lastApplied'])
        self.assertEqual(self.entries.read(first_id).revision, 1)
        self.assertEqual(self.entries.read(second_id).revision, 1)
        # A newly inserted, unsaved table may configure under a real entry; a missing entry may not.
        configure(self.workflows, second_id, 'unsaved-table', 0, policy())
        self.assertEqual(self.workflows.read(second_id, 'unsaved-table')['revision'], 1)
        for action in [lambda: self.workflows.read('0' * 32, 'target'),
                       lambda: configure(self.workflows, '0' * 32, 'target', 0, policy()),
                       lambda: self.workflows.preview('0' * 32, 'target', dict(expectedRevision=0, table=draft)),
                       lambda: self.workflows.apply('0' * 32, 'target', dict(previewId=preview['id'], table=draft))]:
            with self.assertRaises(MissingEntry):
                action()
        with self.assertRaisesRegex(ValueError, 'identity does not match'):
            self.workflows.configure(first_id, 'different', dict(expectedRevision=0, table=draft, change=dict(type='source', source=None)))

    def test_archive_hides_actual_records_but_keeps_snapshots_receipts_and_versions(self):
        archives = CatalogArchiveStore(self.catalog)
        record_id = self.receipt['records'][0]['recordId']
        snapshot = self.catalog.lookup(policy()['query'])
        archived = archives.apply(record_id, dict(expectedVersion=1, expectedArchiveRevision=0, archived=True, reason='Superseded'))
        self.assertTrue(archived['archived'])
        self.assertEqual(self.catalog.lookup(policy()['query'])['total'], 0)
        self.assertEqual(snapshot['records'][0], archived['record'])
        self.assertEqual(self.catalog.register(dict(submissionId='initial', table=self.source)), self.receipt)
        with self.assertRaisesRegex(ValueError, 'Restore'):
            self.catalog.register(dict(submissionId='blocked', table=self.source))
        with self.assertRaises(RevisionConflict):
            archives.apply(record_id, dict(expectedVersion=1, expectedArchiveRevision=0, archived=False, reason='Restore'))
        restored = archives.apply(record_id, dict(expectedVersion=1, expectedArchiveRevision=1, archived=False, reason='Rechecked'))
        self.assertFalse(restored['archived']); self.assertEqual(len(restored['history']), 2)
        self.assertEqual(self.catalog.lookup(policy()['query'])['records'], snapshot['records'])

    def test_truncated_or_self_referential_sources_are_rejected(self):
        source = deepcopy(self.source); source['rows'].append(dict(id='row-2', cells={'name': 'B'}))
        self.catalog.register(dict(submissionId='two', table=source))
        configured = policy(); configured['query']['limit'] = 1
        configure(self.workflows, self.entry.identity, 'target', 0, configured)
        with self.assertRaisesRegex(ValueError, 'exceed'):
            self.workflows.preview(self.entry.identity, 'target', dict(expectedRevision=1, table=table()))
        configure(self.workflows, self.entry.identity, 'source', 0, policy())
        with self.assertRaisesRegex(ValueError, 'own registered'):
            self.workflows.preview(self.entry.identity, 'source', dict(expectedRevision=1, table=source))

    def test_collection_history_preserves_published_template_content(self):
        templates = TemplateStore(self.entries); collections = TemplateCollectionStore(self.entries, templates)
        doc = dict(schemaVersion=1, title='Protocol', content=dict(type='doc', content=[dict(type='paragraph', attrs=dict(blockId='text'))]))
        published = templates.publish(TemplateDefinition.parse(dict(name='Protocol', description='', kind='entry', collections=[], document=doc, parameters=[])))
        root = collections.apply(dict(expectedRevision=0, change=dict(type='create', name='Protocols', parentId=None)))
        identity = root['collections'][0]['id']
        assigned = collections.apply(dict(expectedRevision=1, change=dict(type='assign-template', templateId=published['id'], collectionId=identity)))
        collections.apply(dict(expectedRevision=2, change=dict(type='rename', id=identity, name='Methods')))
        reopened = TemplateCollectionStore(self.entries, templates)
        self.assertEqual(reopened.read(1), root)
        self.assertEqual(reopened.read(2), assigned)
        self.assertEqual(len(reopened.history()), 3)
        self.assertEqual(reopened.history()[1]['destination'], ['Protocols'], 'History must not use a later collection name')
        self.assertEqual(reopened.history()[0]['subject'], 'Methods')
        self.assertEqual(templates.read(published['id'], 1), published)
        with self.assertRaises(RevisionConflict):
            collections.apply(dict(expectedRevision=1, change=dict(type='rename', id=identity, name='Lost')))


class WorkflowTransportTest(unittest.TestCase):
    def test_real_authenticated_routes_reopen_preview_confirm_and_reject_stale_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            entries = EntryStore(directory)
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(entries, 'workflow-test'))
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                def request(method, path, value=None, token='workflow-test'):
                    connection = HTTPConnection('127.0.0.1', server.server_port, timeout=5)
                    connection.request(method, path, body=json.dumps(value).encode() if value is not None else None,
                                       headers={'Content-Type': 'application/json', 'X-Pero-App-Token': token})
                    response = connection.getresponse(); result = json.loads(response.read()); status = response.status
                    connection.close(); return status, result
                self.assertEqual(request('GET', '/api/template-collections', token='wrong')[0], 401)
                status, initial = request('GET', '/api/template-collections'); self.assertEqual((status, initial['revision']), (200, 0))
                self.assertEqual(request('POST', '/api/template-collections', dict(expectedRevision=0, change=dict(type='create', name='Methods', parentId=None)))[0], 200)
                self.assertEqual(len(request('GET', '/api/template-collections/history')[1]['history']), 1)
                self.assertEqual(request('GET', '/api/template-collections/revisions/0')[1]['collections'], [])
                status, receipt = request('POST', '/api/catalog/register', dict(submissionId='register', table=table('source', 'A'))); self.assertEqual(status, 200)
                _, entry = request('POST', '/api/entries', dict(document=notebook_document()))
                root = '/api/entries/' + entry['id'] + '/table-workflows/target'
                status, state = request('POST', root, dict(expectedRevision=0, table=table(), change=dict(type='source', source=policy()))); self.assertEqual(status, 200)
                status, preview = request('POST', root + '/preview', dict(expectedRevision=state['revision'], table=table())); self.assertEqual(status, 200)
                self.assertEqual(request('GET', root)[1]['baseline'], [])
                status, applied = request('POST', root + '/apply', dict(previewId=preview['id'], table=table())); self.assertEqual(status, 200)
                self.assertEqual(applied['table']['rows'][0]['cells']['name'], 'A')
                self.assertEqual(request('GET', root)[1]['lastApplied'], applied)
                _, copied = request('POST', '/api/entries', dict(document=entry['document']))
                second_root = '/api/entries/' + copied['id'] + '/table-workflows/target'
                before = request('GET', root)[1]
                self.assertEqual(request('GET', second_root)[1]['revision'], 0)
                self.assertIsNone(request('GET', second_root)[1]['lastApplied'])
                self.assertEqual(request('POST', second_root + '/apply', dict(previewId=preview['id'], table=table()))[0], 400)
                self.assertEqual(request('POST', second_root, dict(expectedRevision=0, table=table(), change=dict(type='source', source=None)))[0], 200)
                self.assertEqual(request('GET', root)[1], before)
                self.assertEqual(request('GET', '/api/table-workflows/target')[0], 404)
                self.assertEqual(request('GET', '/api/entries/' + '0' * 32 + '/table-workflows/target')[0], 404)
                self.assertEqual(request('POST', root, dict(expectedRevision=0, table=table(), change=dict(type='source', source=None)))[0], 409)
                record = '/api/catalog/records/' + receipt['records'][0]['recordId']
                self.assertEqual(request('GET', record)[1]['record']['version'], 1)
                self.assertEqual(request('POST', record + '/archive', dict(expectedVersion=1, expectedArchiveRevision=0, archived=True, reason='Obsolete'))[0], 200)
                self.assertEqual(request('GET', '/api/catalog/lookup')[1]['total'], 0)
                self.assertEqual(request('GET', '/api/catalog/records/missing')[0], 404)
            finally:
                server.shutdown(); thread.join(timeout=5); server.server_close()


if __name__ == '__main__':
    unittest.main()
