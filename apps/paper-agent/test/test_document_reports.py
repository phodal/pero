"""Shared report owner through document commands/CLI; only authored offline bytes."""
from importlib.util import module_from_spec, spec_from_file_location
from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest

from test_paper_documents import HtmlTransport, NOW, SOURCE, save_bundle
from paper_agent.model import Invalid
from paper_agent.paper_documents import PaperDocuments
from paper_agent.research_commands import execute
from paper_agent.source_reports import source_report
from paper_agent.store import ResearchStore


class DocumentReports(unittest.TestCase):
    def test_typed_read_shared_report_export_and_offline_restore_permission(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(directory)
            calls = Path(directory) / 'calls'
            transport = HtmlTransport(SOURCE, str(calls))
            documents = PaperDocuments(store, transport)
            request = save_bundle(store, True)
            prepared = documents.command(request, NOW)
            identity = prepared['documentId']
            doc, _ = documents.read(identity)
            self.assertEqual(store._list('source-observations'), [])
            self.assertNotIn('observationId', documents.command(dict(operation='outline', documentId=identity), NOW))
            self.assertTrue(documents.command(dict(operation='source', documentId=identity), NOW)['observationId'])
            table = next(b for b in doc.blocks if b.kind == 'table')
            read_request = dict(operation='read', documentId=identity, blockId=table.id,
                                bundleId=request['bundleId'], resourceId=request['resourceId'])
            window = documents.command(read_request, NOW)
            self.assertEqual(window['evidenceAdmission'], 'tool-observed-scope')
            report = source_report(store, dict(operation='create', bundleId=request['bundleId'],
                title='Authored table window', observationIds=[window['observationId']]), NOW)
            self.assertEqual(report['verification'], 'tool_observed_scopes_only')
            self.assertTrue(report['currentAvailability'][0]['available'])
            scope = report['observations'][0]['anchor']['documentScopes'][0]
            self.assertEqual(scope['documentId'], identity)
            self.assertEqual(scope['sourceDigest'], doc.source.digest)
            self.assertEqual(scope['parserRevision'], doc.parser)
            exported = execute(store, 'export', dict(bundleId=request['bundleId']))
            self.assertEqual(exported['sourceReports'][0]['id'], report['id'])
            self.assertNotIn('sourceBytes', json.dumps(exported))
            self.assertNotIn('−1.20', json.dumps(exported, ensure_ascii=False))
            for changed in (dict(read_request, bundleId=None, resourceId=None), dict(read_request, bundleId='f' * 64), dict(read_request, resourceId='e' * 64),
                            dict(read_request, documentId='d' * 64), dict(read_request, blockId='fabricated')):
                with self.subTest(changed=changed), self.assertRaises((Invalid, ValueError)):
                    documents.command(changed, NOW)
            self.assertEqual(len(store._list('source-observations')), 2)
            save_bundle(store, False, 'v3')
            reopen = dict(operation='read', bundleId=request['bundleId'], reportId=report['id'])
            self.assertTrue(source_report(store, reopen, NOW)['currentAvailability'][0]['available'])
            original_path = store.root / 'scientific-documents' / (identity + '.json')
            original_path.unlink()
            unavailable = source_report(store, reopen, NOW)
            self.assertEqual(unavailable['observations'], report['observations'])
            self.assertFalse(unavailable['currentAvailability'][0]['available'])
            with self.assertRaises(Invalid): documents.prepare(dict(request, refresh=True), NOW)
            self.assertEqual(calls.read_text(), '1')
            restored_permission = save_bundle(store, True)
            transport.data = SOURCE + b'\n'
            changed = documents.prepare(dict(restored_permission, refresh=True), NOW)
            self.assertNotEqual(changed.id, identity)
            self.assertFalse(source_report(store, reopen, NOW)['currentAvailability'][0]['available'])
            transport.data = SOURCE
            self.assertEqual(documents.prepare(dict(restored_permission, refresh=True), NOW).id, identity)
            self.assertTrue(source_report(store, reopen, NOW)['currentAvailability'][0]['available'])
            self.assertEqual(calls.read_text(), '3')

    def test_raw_source_short_window_report_reopens_without_broadening_or_new_journal(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(directory)
            request = save_bundle(store, True)
            documents = PaperDocuments(store, HtmlTransport(SOURCE, str(Path(directory) / 'calls')))
            doc = documents.prepare(request, NOW)
            window = execute(store, 'document', dict(operation='source', documentId=doc.id, start=13, limit=17,
                bundleId=request['bundleId'], resourceId=request['resourceId']))
            self.assertEqual(window['content'], SOURCE.decode()[13:30])
            self.assertEqual(window['unit'], 'original-html')
            report = execute(store, 'source-report', dict(operation='create', bundleId=request['bundleId'],
                title='Raw markup only', observationIds=[window['observationId']]))
            scope = report['observations'][0]['anchor']['documentScopes'][0]
            self.assertEqual(scope['blockId'], '')
            reopened = execute(store, 'document', dict(operation='source', documentId=scope['documentId'],
                start=scope['start'], limit=scope['end'] - scope['start'],
                bundleId=request['bundleId'], resourceId=request['resourceId']))
            self.assertEqual(reopened['content'], window['content'])
            self.assertEqual(reopened['observationId'], window['observationId'])
            self.assertEqual(store._list('source-observations'), [window['observationId']])
            with self.assertRaises(Invalid):
                execute(store, 'document', dict(operation='source', documentId=doc.id, start=13, limit=17,
                    bundleId='f' * 64, resourceId=request['resourceId']))

    def test_local_json_cli_reads_same_scope_and_reopens_same_report(self):
        spec = spec_from_file_location('paper_document_cli', Path(__file__).parents[1] / 'tools' / 'research.py')
        cli = module_from_spec(spec); spec.loader.exec_module(cli)
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(directory)
            request = save_bundle(store, True)
            documents = PaperDocuments(store, HtmlTransport(SOURCE, str(Path(directory) / 'calls')))
            doc = documents.prepare(request, NOW)
            block = next(b for b in doc.blocks if b.kind == 'figure')
            def command(action, value):
                output = StringIO()
                code = cli.main([], store=store, stdin=StringIO(json.dumps(dict(action=action, input=value))), stdout=output)
                result = json.loads(output.getvalue())
                self.assertEqual(code, 0, result)
                return result['result']
            raw_request = dict(operation='source', documentId=doc.id, start=13, limit=17)
            raw = command('document', raw_request)
            self.assertEqual(raw['content'], SOURCE.decode()[13:30])
            self.assertEqual(command('document', raw_request)['observationId'], raw['observationId'])
            window = command('document', dict(operation='read', documentId=doc.id, blockId=block.id))
            report = command('source-report', dict(operation='create', bundleId=request['bundleId'],
                title='Figure metadata only', observationIds=[window['observationId']]))
            anchor = report['observations'][0]['anchor']
            self.assertEqual(anchor['visualReview'], 'not_reviewed')
            self.assertEqual(anchor['delivery'], 'image_metadata_only')
            reopened = command('source-report', dict(operation='read', bundleId=request['bundleId'], reportId=report['id']))
            self.assertEqual(reopened['observations'], report['observations'])
            self.assertEqual(command('export', dict(bundleId=request['bundleId']))['sourceReports'][0]['id'], report['id'])


if __name__ == '__main__': unittest.main()
