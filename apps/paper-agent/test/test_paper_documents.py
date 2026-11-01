"""Source acquisition and existing-store seam contracts; no external network."""
from dataclasses import replace
from email.message import Message
import io
import json
from pathlib import Path
import sys
import threading
from types import SimpleNamespace
import unittest
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.paper_documents import ArxivHtml, PaperDocuments, arxiv_identity
from paper_agent.scientific_document import DocumentError, ParseLimits
from test_scientific_document import SOURCE, URL


class FixtureResponse(io.BytesIO):
    def __init__(self, url, data, mime='text/html', status=200, encoding='identity'):
        super().__init__(data)
        self.url, self.status = url, status
        self.headers = Message()
        self.headers['Content-Type'] = mime
        self.headers['Content-Encoding'] = encoding

    def geturl(self):
        return self.url


class FixtureSource:
    def __init__(self, replies):
        self.replies, self.urls = replies, []

    def __call__(self, request, timeout):
        self.urls.append(request.full_url)
        reply = self.replies[request.full_url]
        if isinstance(reply, Exception):
            raise reply
        return FixtureResponse(request.full_url, reply) if isinstance(reply, bytes) else FixtureResponse(**reply)


class StoreSeam:
    """One fake at the existing immutable-store seam; not a persistence test."""
    def __init__(self):
        self.lock, self.records = threading.RLock(), {}
        self.snapshot = SimpleNamespace(id='a' * 64, source='alphaxiv', source_id='2606.03979',
                                        url='https://arxiv.org/abs/2606.03979', pdf_url=None,
                                        source_revision=None)

    def paper(self, identity):
        if identity != self.snapshot.id:
            raise DocumentError('Unknown saved paper', status=404)
        return self.snapshot

    def _list(self, kind):
        return [identity for collection, identity in self.records if collection == kind]

    def _read(self, kind, identity):
        return json.loads(self.records[(kind, identity)])

    def _write(self, kind, identity, value):
        serialized = json.dumps(value, sort_keys=True)
        previous = self.records.get((kind, identity))
        if previous and previous != serialized:
            raise DocumentError('Immutable conflict', status=409)
        self.records[(kind, identity)] = serialized


class PaperDocumentsTests(unittest.TestCase):
    def test_resolves_and_freezes_a_unique_explicit_version(self):
        abstract = 'https://arxiv.org/abs/2606.03979'
        source = FixtureSource({abstract: b'<a href="/html/2606.03979v2">HTML</a>', URL: SOURCE})
        acquired = ArxivHtml(source).acquire('2606.03979')
        self.assertEqual(acquired.requested_url, abstract)
        self.assertEqual(acquired.source_url, URL)
        self.assertEqual(acquired.data, SOURCE)
        self.assertEqual(source.urls, [abstract, URL])

    def test_explicit_version_never_silently_requests_latest(self):
        source = FixtureSource({URL: SOURCE})
        acquired = ArxivHtml(source).acquire('2606.03979v2')
        self.assertEqual(acquired.source_url, URL)
        self.assertEqual(source.urls, [URL])

    def test_missing_wrong_or_ambiguous_versions_are_not_selected(self):
        abstract = 'https://arxiv.org/abs/2606.03979'
        for body in (b'<p>No HTML</p>', b'<a href="/html/2606.00000v2">other paper</a>',
                     b'<a href="https://evil.invalid/html/2606.03979v2">remote</a>',
                     b'<a href="/html/2606.03979v1">v1</a><a href="/html/2606.03979v2">v2</a>'):
            with self.subTest(body=body), self.assertRaises(DocumentError):
                ArxivHtml(FixtureSource({abstract: body})).acquire('2606.03979')

    def test_response_identity_type_completeness_and_limits(self):
        cases = [dict(url='https://evil.invalid', data=SOURCE),
                 dict(url=URL, data=SOURCE, mime='application/pdf'),
                 dict(url=URL, data=SOURCE, status=206),
                 dict(url=URL, data=SOURCE, encoding='gzip'),
                 dict(url=URL, data=b'x' * (ParseLimits().max_bytes + 1)),
                 HTTPError(URL, 404, 'Unavailable', {}, None)]
        for reply in cases:
            with self.subTest(reply=str(reply)[:70]), self.assertRaises(DocumentError):
                ArxivHtml(FixtureSource({URL: reply})).acquire('2606.03979v2')
        for identifier in ('https://evil.invalid', '../../private', '2606.03979?x=y'):
            with self.subTest(identifier=identifier), self.assertRaises(DocumentError):
                ArxivHtml(FixtureSource({})).acquire(identifier)

    def test_saved_identity_prefers_explicit_version_but_rejects_conflict(self):
        paper = StoreSeam().snapshot
        paper.pdf_url = 'https://arxiv.org/pdf/2606.03979v2.pdf'
        self.assertEqual(arxiv_identity(paper), '2606.03979v2')
        paper.source_revision = 'v1'
        with self.assertRaises(DocumentError):
            arxiv_identity(paper)
        paper.source_revision = None
        paper.source_id = '2606.00000'
        with self.assertRaises(DocumentError):
            arxiv_identity(paper)

    def test_immutable_saved_source_reuse_and_new_revision(self):
        store = StoreSeam()
        abstract = store.snapshot.url
        source = FixtureSource({abstract: b'<a href="/html/2606.03979v2">HTML</a>', URL: SOURCE})
        documents = PaperDocuments(store, ArxivHtml(source))
        self.assertIsNone(documents.latest(store.snapshot.id))
        old = documents.prepare(store.snapshot.id, '2026-11-01T00:00:00Z')
        self.assertEqual(documents.prepare(store.snapshot.id, '2026-11-01T01:00:00Z'), old)
        self.assertEqual(len(source.urls), 2)
        self.assertEqual(documents.prepare(store.snapshot.id, '2026-11-01T01:00:00Z', refresh=True), old)
        self.assertEqual(len(store.records), 1)
        source.replies[abstract] = b'<a href="/html/2606.03979v3">HTML</a>'
        source.replies[URL.replace('v2', 'v3')] = SOURCE.replace(b'2606.03979v2', b'2606.03979v3')
        new = documents.prepare(store.snapshot.id, '2026-11-01T02:00:00Z', refresh=True)
        self.assertNotEqual(old.id, new.id)
        self.assertEqual(PaperDocuments(store).read(old.id), old)
        self.assertEqual(PaperDocuments(store).latest(store.snapshot.id), new)
        self.assertEqual(len(store.records), 2)
        self.assertEqual(new.to_dict()['pdfAlignment'], 'unavailable')

    def test_unusable_html_never_publishes_half_a_document(self):
        store = StoreSeam()
        store.snapshot.source_id = '2606.03979v2'
        source = FixtureSource({URL: b'<h1>Unavailable</h1>'})
        with self.assertRaises(DocumentError):
            PaperDocuments(store, ArxivHtml(source)).prepare(store.snapshot.id, 'now')
        self.assertFalse(store.records)

    def test_raw_bytes_include_bom_and_detect_tampering(self):
        store = StoreSeam()
        store.snapshot.source_id = '2606.03979v2'
        document = PaperDocuments(store, ArxivHtml(FixtureSource({URL: b'\xef\xbb\xbf' + SOURCE}))).prepare(store.snapshot.id, 'now')
        self.assertEqual(PaperDocuments(store).read(document.id), document)
        key = ('scientific-documents', document.id)
        record = json.loads(store.records[key])
        record['sourceHtml'] += 'tampered'
        store.records[key] = json.dumps(record)
        with self.assertRaisesRegex(DocumentError, 'integrity'):
            PaperDocuments(store).read(document.id)


if __name__ == '__main__':
    unittest.main()
