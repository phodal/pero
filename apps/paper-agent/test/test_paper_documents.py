"""Actual store, worker and authenticated HTTP with self-authored HTML only."""
from dataclasses import dataclass, replace
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import multiprocessing
from pathlib import Path
import tempfile
import threading
import unittest

from test_scientific_document import SOURCE, URL
from paper_agent.http import handler
from paper_agent.model import Invalid, digest
from paper_agent.paper_documents import PaperDocuments
from paper_agent.research_resources import ImportDraft, ResearchResource
from paper_agent.resource_fetch import SourceResponse
from paper_agent.store import ResearchStore

NOW = '2026-11-01T00:00:00Z'
SEED = 'https://research.example/structured-reading'


@dataclass
class HtmlTransport:
    data: bytes
    calls: str
    final: str | None = None
    mime: str = 'text/html'
    entered: object = None
    release: object = None

    def fetch_html(self, url):
        if self.entered is not None: self.entered.set()
        if self.release is not None: self.release.wait()
        path = Path(self.calls)
        count = int(path.read_text()) if path.exists() else 0
        path.write_text(str(count + 1))
        return SourceResponse(self.final or url, self.data, self.mime)


def save_bundle(store, approved=False, revision='v2'):
    resource = replace(ResearchResource.linked('https://arxiv.org/abs/2606.03979' + revision, SEED, 'Scientific fixture'),
                       excerpt='Self-authored metadata fixture, not paper content.', contentKind='abstract')
    draft = ImportDraft.create(SEED, NOW).finish((resource,), ())
    store.imports._replace('import-drafts', draft.id, draft.to_dict())
    bundle = store.imports.commit(dict(draftId=draft.id, resourceIds=[resource.id],
        htmlIds=[resource.id] if approved else [], confirmedDownloads=approved), NOW)
    saved = next(r for r in bundle.resources if r.id == resource.id)
    return dict(operation='prepare', bundleId=bundle.id, resourceId=resource.id, paperId=saved.paperId)


class ScientificDocuments(unittest.TestCase):
    def test_explicit_grant_immutable_store_restart_and_typed_read(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(directory)
            calls = Path(directory) / 'calls'
            documents = PaperDocuments(store, HtmlTransport(SOURCE, str(calls)))
            request = save_bundle(store)
            with self.assertRaises(Invalid): documents.command(request, NOW)
            self.assertFalse(calls.exists())
            self.assertEqual(store._list('scientific-documents'), [])
            request = save_bundle(store, True)
            result = documents.command(request, NOW)
            self.assertEqual(result['evidenceAdmission'], 'not-observed-in-study')
            identity = result['documentId']
            doc, original = documents.read(identity)
            self.assertEqual(original, SOURCE)
            self.assertEqual(doc.source.digest, digest(SOURCE))
            self.assertEqual(calls.read_text(), '1')
            self.assertEqual(doc.source_identity, 'response-explicit-version')
            self.assertEqual(doc.source.requested_url, URL)
            table = next(b for b in doc.blocks if b.kind == 'table')
            read = documents.command(dict(operation='read', documentId=identity, blockId=table.id), NOW)
            self.assertEqual(read['unit'], 'cells')
            self.assertEqual([item['text'] for item in read['items']], [cell.text for cell in table.cells])
            self.assertEqual(read['evidenceAdmission'], 'tool-observed-scope')
            self.assertTrue(read['observationId'])
            raw = documents.command(dict(operation='source', documentId=identity, blockId=table.id), NOW)
            self.assertEqual(raw['content'], SOURCE.decode()[table.locator.start:table.locator.start + 4800])
            self.assertEqual(raw['sourceDigest'], digest(SOURCE))
            reopened = PaperDocuments(ResearchStore(directory), HtmlTransport(b'not acquired', str(calls)))
            self.assertEqual(reopened.command(request, 'later')['documentId'], identity)
            self.assertEqual(calls.read_text(), '1')
            self.assertEqual(reopened.read(identity)[1], SOURCE)
            self.assertEqual(set(store._list('source-observations')), {read['observationId'], raw['observationId']})

    def test_refresh_preserves_old_versions_and_rejects_wrong_response_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(directory)
            request = save_bundle(store, True)
            transport = HtmlTransport(SOURCE, str(Path(directory) / 'calls'))
            documents = PaperDocuments(store, transport)
            old = documents.prepare(request, NOW)
            transport.data = SOURCE + b'\n'
            new = documents.prepare(dict(request, refresh=True), '2026-11-01T00:01:00Z')
            self.assertNotEqual(new.id, old.id)
            self.assertEqual(documents.read(old.id)[1], SOURCE)
            for broken in (SOURCE.replace(b'2606.03979v2', b'2606.03979v1'), b'<h1>Error page</h1>',
                           SOURCE.replace(b'2606.03979v2', b'2606.03979')):
                transport.data = broken
                with self.subTest(broken=broken[:60]), self.assertRaises(Invalid):
                    documents.prepare(dict(request, refresh=True), 'later')
                self.assertEqual(documents.read(new.id)[1], SOURCE + b'\n')
            self.assertEqual(len(documents.overview(request['paperId'])['revisions']), 2)

    def test_old_offline_document_survives_new_version_without_inheriting_fetch_grant(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(directory)
            calls = Path(directory) / 'calls'
            documents = PaperDocuments(store, HtmlTransport(SOURCE, str(calls)))
            request = save_bundle(store, True)
            old = documents.prepare(request, NOW)
            newer_request = save_bundle(store, False, 'v3')
            self.assertEqual(newer_request['resourceId'], request['resourceId'])
            self.assertEqual(documents.read(old.id)[1], SOURCE)
            with self.assertRaises(Invalid): documents.prepare(newer_request, 'later')
            with self.assertRaises(Invalid): documents.prepare(dict(request, refresh=True), 'later')
            self.assertEqual(calls.read_text(), '1')
            # A missing original never triggers a historical-consent fetch.
            (store.root / 'scientific-documents' / (old.id + '.json')).unlink()
            with self.assertRaises(Invalid): documents.read(old.id)
            with self.assertRaises(Invalid): documents.prepare(dict(request, refresh=True), 'later')
            self.assertEqual(calls.read_text(), '1')

    def test_unrelated_unpinned_and_redirected_pdf_receipts_do_not_associate_html(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(directory)
            request = save_bundle(store, True)
            documents = PaperDocuments(store)
            urls = ('https://example.org/paper.pdf', 'https://arxiv.org/pdf/2606.03979',
                    'https://arxiv.org/pdf/2606.03979v2')
            for url in urls:
                resource = ResearchResource.linked(url, SEED + '/pdf', 'PDF fixture')
                draft = ImportDraft.create(SEED + '/pdf', NOW).finish((resource,), ())
                store.imports._replace('import-drafts', draft.id, draft.to_dict())
                bundle = store.imports.commit(dict(draftId=draft.id, resourceIds=[resource.id]), NOW)
                identity = digest(dict(bundleId=bundle.id, resourceId=resource.id))
                for final in ('https://arxiv.org/pdf/2606.03979v1', 'https://elsewhere.example/paper.pdf'):
                    store.imports._replace('pdf-downloads', identity, dict(receipt=dict(requestUrl=url,
                        finalUrl=final, paperId=request['paperId'])))
                    with self.subTest(url=url, final=final):
                        self.assertEqual(len(documents.overview(request['paperId'])['sources']), 1)
                if url.endswith('v2'):
                    store.imports._replace('pdf-downloads', identity, dict(receipt=dict(requestUrl=url,
                        finalUrl=url, paperId=request['paperId'])))
                    self.assertEqual(len(documents.overview(request['paperId'])['sources']), 2)

    def test_tampering_and_arbitrary_urls_are_rejected_without_new_fetch(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(directory)
            calls = Path(directory) / 'calls'
            documents = PaperDocuments(store, HtmlTransport(SOURCE, str(calls)))
            request = save_bundle(store, True)
            with self.assertRaises(Invalid): documents.prepare(dict(request, url=URL), NOW)
            self.assertFalse(calls.exists())
            doc = documents.prepare(request, NOW)
            path = store.root / 'scientific-documents' / (doc.id + '.json')
            record = json.loads(path.read_text()); record['sourceBytes'] = 'aW52YWxpZA=='
            path.write_text(json.dumps(record))
            with self.assertRaisesRegex(Invalid, 'integrity'): documents.read(doc.id)
            self.assertEqual(calls.read_text(), '1')

    def test_authorization_change_during_acquisition_does_not_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(directory)
            request = save_bundle(store, True)
            context = multiprocessing.get_context('spawn')
            entered, release = context.Event(), context.Event()
            transport = HtmlTransport(SOURCE, str(Path(directory) / 'calls'), entered=entered, release=release)
            documents, errors = PaperDocuments(store, transport), []
            def acquire():
                try: documents.prepare(request, NOW)
                except Invalid as error: errors.append(error)
            worker = threading.Thread(target=acquire)
            worker.start()
            try:
                self.assertTrue(entered.wait(8))
                save_bundle(store, False, 'v3')
            finally:
                release.set(); worker.join(timeout=10)
            self.assertFalse(worker.is_alive())
            self.assertEqual(len(errors), 1)
            self.assertEqual(store._list('scientific-documents'), [])
            self.assertEqual(store._list('document-receipts'), [])

    def test_receipt_before_write_failure_does_not_publish_half_document(self):
        class FailingStore(ResearchStore):
            fail = True
            def _write(self, kind, identity, value):
                if kind == 'scientific-documents' and self.fail:
                    self.fail = False
                    raise OSError('Synthetic storage failure')
                return super()._write(kind, identity, value)
        with tempfile.TemporaryDirectory() as directory:
            store = FailingStore(directory)
            request = save_bundle(store, True)
            documents = PaperDocuments(store, HtmlTransport(SOURCE, str(Path(directory) / 'calls')))
            with self.assertRaises(OSError): documents.prepare(request, NOW)
            self.assertEqual(documents.overview(request['paperId'])['revisions'], [])
            self.assertEqual(len(store._list('document-receipts')), 1)
            doc = documents.prepare(request, 'later')
            self.assertEqual(documents.read(doc.id)[1], SOURCE)
            self.assertEqual(len(store._list('document-receipts')), 1)

    def test_authenticated_http_preparation_and_source_reveal(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(directory)
            documents = PaperDocuments(store, HtmlTransport(SOURCE, str(Path(directory) / 'calls')))
            request = save_bundle(store, True)
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(store, 'fixture-secret', documents=documents, now=lambda: NOW))
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            def call(method, path, value=None, secret='fixture-secret'):
                connection = HTTPConnection(*server.server_address, timeout=60)
                try:
                    connection.request(method, path, json.dumps(value) if value is not None else None,
                        {'X-Pero-App-Token': secret, 'Content-Type': 'application/json'})
                    response = connection.getresponse(); data = response.read()
                    return response.status, json.loads(data) if response.getheader('Content-Type', '').startswith('application/json') else data
                finally: connection.close()
            try:
                self.assertEqual(call('POST', '/api/paper-document', request, 'wrong')[0], 401)
                self.assertEqual(call('POST', '/api/paper-document', [])[0], 400)
                status, prepared = call('POST', '/api/paper-document', request)
                self.assertEqual(status, 200, prepared)
                identity = prepared['documentId']
                status, doc = call('GET', '/api/paper-documents/' + identity)
                self.assertEqual(status, 200)
                self.assertEqual(doc['source']['digest'], digest(SOURCE))
                self.assertEqual(call('GET', '/api/paper-documents/' + identity + '/original')[1], SOURCE)
                status, outline = call('POST', '/api/paper-document', dict(operation='outline', documentId=identity))
                self.assertEqual(status, 200); self.assertTrue(outline['items'])
                self.assertNotIn('observationId', outline)
                table = next(b for b in doc['blocks'] if b['kind'] == 'table')
                status, window = call('POST', '/api/paper-document', dict(operation='read', documentId=identity, blockId=table['id']))
                self.assertEqual(status, 200); self.assertEqual(window['unit'], 'cells')
                status, report = call('POST', '/api/research/source-report', dict(operation='create',
                    bundleId=request['bundleId'], title='HTTP typed table', observationIds=[window['observationId']]))
                self.assertEqual(status, 200, report)
                self.assertEqual(report['observations'][0]['anchor']['documentScopes'][0]['documentId'], identity)
                reopened = call('POST', '/api/research/source-report', dict(operation='read', bundleId=request['bundleId'], reportId=report['id']))
                self.assertEqual(reopened[1]['observations'], report['observations'])
                raw_request = dict(operation='source', documentId=identity, start=13, limit=17,
                    bundleId=request['bundleId'], resourceId=request['resourceId'])
                status, raw = call('POST', '/api/paper-document', raw_request)
                self.assertEqual(status, 200); self.assertEqual(raw['content'], SOURCE.decode()[13:30])
                raw_report = call('POST', '/api/research/source-report', dict(operation='create',
                    bundleId=request['bundleId'], title='HTTP raw markup', observationIds=[raw['observationId']]))[1]
                self.assertEqual(raw_report['observations'][0]['anchor']['documentScopes'][0]['unit'], 'original-html')
                self.assertEqual(call('POST', '/api/paper-document', raw_request)[1]['observationId'], raw['observationId'])
                self.assertEqual(call('POST', '/api/paper-document', dict(operation='source', documentId=identity, start=-1))[0], 400)
            finally:
                server.shutdown(); server.server_close(); thread.join(timeout=5)


if __name__ == '__main__': unittest.main()
