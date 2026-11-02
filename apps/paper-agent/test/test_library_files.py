"""Library review uses real import/download owners; copies are not evidence."""
import json
import multiprocessing
import os
from dataclasses import dataclass
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

from test_pdf import NOW, pdf_fixture
from test_research import reading
from test_pdf_downloads import finish
from test_source_downloads import SourceTransport
from test_source_archives import TEX, archive_bytes
from paper_agent.http import handler
from paper_agent.library_files import LibraryFiles, file_stem, locate_passage, paper_directory, write_copy
from paper_agent.model import Invalid, PaperSnapshot, digest
from paper_agent.pdf import PdfDocument, PdfPage, PdfAnnotation
from paper_agent.pdf_files import PdfFiles
from paper_agent.pdf_downloads import PdfDownloads
from paper_agent.resource_fetch import PdfResponse, WebDocument
from paper_agent.resource_inspection import ResourceInspector
from paper_agent.source_downloads import SourceDownloads
from paper_agent.source_reading import source_read
from paper_agent.store import ResearchStore


def arxiv_reading(version='v1'):
    identifier = '1706.03762' + version
    return reading(source='alphaxiv', sourceId=identifier, url='https://arxiv.org/abs/' + identifier,
                   pdfUrl='https://arxiv.org/pdf/' + identifier, title='Synthetic saved paper')


def seed_pdf(store, paper, data=None, url=None):
    data = pdf_fixture() if data is None else data
    document = PdfDocument.create(paper.id, digest(data), url or paper.pdf_url or paper.url,
                                  (PdfPage(1, 400, 600, 'First page. Exact original evidence.'),), NOW)
    return store.save_pdf(document, data)


@dataclass
class LibraryPdfTransport:
    data: bytes
    final_url: str | None = None

    def fetch_pdf(self, url):
        return PdfResponse(self.final_url or url, self.data)


@dataclass
class OfficialMetadata:
    available: bool = True

    def __call__(self, url, **options):
        if not self.available:
            raise Invalid('Official metadata is unavailable', 502)
        return WebDocument(url, 'application/atom+xml',
            '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/1706.03762v3</id></entry></feed>')


class LibraryFilesTest(unittest.TestCase):
    def setUp(self):
        root, copies = tempfile.TemporaryDirectory(), tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        self.addCleanup(copies.cleanup)
        self.root, self.copies = root.name, copies.name
        self.store = ResearchStore(self.root)
        self.addCleanup(lambda: self.store.imports.close())
        self.addCleanup(lambda: self.store.pdf_downloads.close())
        self.addCleanup(lambda: self.store.source_downloads.close())
        self.store.pdf_downloads = PdfDownloads(self.store, LibraryPdfTransport(pdf_fixture()))
        self.original = archive_bytes([('main.tex', TEX.encode())])
        self.store.source_downloads = SourceDownloads(self.store, SourceTransport(self.original))
        self.files = LibraryFiles(self.store, self.copies)
        self.paper = self.store.save_paper(PaperSnapshot.from_reading(arxiv_reading(), NOW))

    def call(self, operation, **values):
        return self.files.command(self.paper, dict(operation=operation, **values), NOW)

    def review(self):
        result = self.call('prepare')
        if result['status'] == 'inspecting':
            worker = self.store.imports.running.get(result['draftId'])
            if worker:
                worker[1].join(timeout=8)
                self.assertFalse(worker[1].is_alive())
            result = self.call('prepare', draftId=result['draftId'])
        self.assertEqual(result['status'], 'ready', result)
        return result

    def confirm(self, review=None, tex=True):
        review = review or self.review()
        return self.call('confirm', draftId=review['draftId'], reviewId=review['reviewId'],
                         pdf=True, tex=tex, confirmedDownloads=True)

    def acquire(self, plan, kind):
        key = 'pdfResourceId' if kind == 'pdf' else 'sourceResourceId'
        owner = self.store.pdf_downloads if kind == 'pdf' else self.store.source_downloads
        selection = dict(bundleId=plan['bundleId'], resourceId=plan[key])
        owner.request(dict(operation='start', **selection))
        return finish(owner, selection)

    def export(self, plan):
        return self.call('export', **{key: plan[key] for key in ('bundleId', 'pdfResourceId', 'sourceResourceId', 'documentId')})

    def cache_pdf(self):
        plan = self.confirm(tex=False)
        self.acquire(plan, 'pdf')
        self.export(plan)
        return self.store.paper_pdf(self.paper.id)

    def test_real_inspection_confirmation_downloads_association_and_observed_read(self):
        original_paper = self.paper.to_dict()
        review = self.review()
        self.assertEqual(review['version'], 'v1')
        self.assertFalse(any('dataset' in warning.lower() for warning in review['warnings']))
        self.assertTrue(review['tex']['available'])
        self.assertEqual(self.store._list('pdf-downloads'), [])
        self.assertEqual(self.store._list('source-downloads'), [])
        plan = self.confirm(review)
        # Confirmation records exactly selected grants, not any download or read.
        self.assertEqual(self.store._list('pdf-downloads'), [])
        self.assertFalse(plan['bundle']['downloadIds'])
        self.assertNotIn('htmlDownloadIds', plan['bundle'])
        pdf = self.acquire(plan, 'pdf')
        tex = self.acquire(plan, 'source')
        self.assertEqual(pdf['status'], 'completed', pdf)
        self.assertEqual(tex['status'], 'source_available', tex)
        saved = self.export(plan)
        self.assertEqual(Path(saved['pdf']).read_bytes(), pdf_fixture())
        self.assertEqual(Path(saved['tex']).read_bytes(), self.original)
        self.assertTrue(saved['tex'].endswith('-src.tar.gz'))
        linked = self.store.paper_pdf(self.paper.id)
        acquired = self.store.pdf(pdf['receipt']['documentId'])
        self.assertNotEqual(linked.id, acquired.id)
        self.assertEqual(linked.file_digest, acquired.file_digest)
        self.assertEqual(self.store.paper(self.paper.id).to_dict(), original_paper)
        self.assertEqual(self.store._list('source-observations'), [])
        self.assertEqual(self.export(plan), saved)
        paper_ids = set(self.store._list('papers'))
        self.assertEqual(len(paper_ids), 2)
        repeat = self.confirm()
        self.assertIsNone(repeat['pdfResourceId'])
        self.acquire(repeat, 'source')
        self.assertEqual(self.export(repeat), saved)
        self.assertEqual(set(self.store._list('papers')), paper_ids)
        selection = dict(bundleId=plan['bundleId'], resourceId=plan['sourceResourceId'])
        listing = source_read(self.store, dict(operation='list', **selection))
        observed = source_read(self.store, dict(operation='read', memberId=listing['members'][0]['id'], start=0, **selection))
        self.assertTrue(observed['observationId'])
        self.assertEqual(len(self.store._list('source-observations')), 1)
        # Reopening uses the same persisted owners and needs no network or new grant.
        self.store = ResearchStore(self.root)
        self.files = LibraryFiles(self.store, self.copies)
        self.assertEqual(self.export(plan), saved)

    def test_no_confirmation_references_only_and_legacy_body_never_download(self):
        review = self.review()
        for body in ({}, dict(operation='confirm', draftId=review['draftId'], reviewId=review['reviewId'], pdf=True, tex=True),
                     dict(operation='confirm', draftId=review['draftId'], reviewId='0' * 64, pdf=True, tex=True, confirmedDownloads=True)):
            with self.subTest(body=body), self.assertRaises(Invalid):
                self.files.command(self.paper, body, NOW)
        draft = self.store.imports.draft(review['draftId'])
        reference = self.store.imports.commit(dict(draftId=draft.id, resourceIds=[r.id for r in draft.resources]), NOW)
        with self.assertRaises(Invalid):
            self.store.source_downloads.request(dict(operation='start', bundleId=reference.id, resourceId=review['tex']['resourceId']))
        self.assertEqual(self.store._list('pdf-downloads'), [])
        self.assertEqual(self.store._list('source-downloads'), [])
        self.assertEqual(list(Path(self.copies).iterdir()), [])

    def test_unknown_or_conflicting_cached_version_only_exports_original(self):
        for source_url in ('https://arxiv.org/pdf/1706.03762v1', 'https://arxiv.org/pdf/1706.03762', 'https://arxiv.org/pdf/1706.03762v2', 'urn:sha256:local'):
            with self.subTest(source_url=source_url):
                # Each case has its own original; metadata cannot bless its bytes.
                with tempfile.TemporaryDirectory() as root:
                    store = ResearchStore(root)
                    paper = store.save_paper(self.paper)
                    document = seed_pdf(store, paper, url=source_url)
                    files = LibraryFiles(store, self.copies)
                    review = files.command(paper, dict(operation='prepare'), NOW)
                    self.assertFalse(review['tex']['available'])
                    self.assertIsNone(review['draftId'])
                    self.assertEqual(store._list('import-drafts'), [])
                    with self.assertRaises(Invalid):
                        files.command(paper, dict(operation='confirm', reviewId=review['reviewId'], pdf=True, tex=True, confirmedDownloads=True), NOW)
                    plan = files.command(paper, dict(operation='confirm', reviewId=review['reviewId'], pdf=True, tex=False, confirmedDownloads=True), NOW)
                    self.assertIsNone(plan['bundleId'])
                    saved = files.command(paper, dict(operation='export', documentId=plan['documentId']), NOW)
                    self.assertEqual(Path(saved['pdf']).read_bytes(), pdf_fixture())
                    self.assertEqual(store.paper_pdf(paper.id), document)

    def test_cached_pdf_annotation_and_report_stay_unchanged(self):
        document = self.cache_pdf()
        self.assertTrue(self.review()['tex']['available'])
        annotation = PdfAnnotation.create(dict(page=1, kind='highlight', quote='First page.', rects=[dict(x=.1, y=.1, width=.3, height=.1)]), document, NOW)
        self.store.save_annotation(annotation)
        # An immutable record stands in for an existing report: export never reads
        # or rewrites reports, annotations, or research study membership.
        record = dict(original='historical report')
        self.store._write('reports', digest(record), record)
        plan = self.confirm()
        self.assertIsNone(plan['pdfResourceId'])
        self.acquire(plan, 'source')
        self.export(plan)
        self.assertEqual(self.store.paper_pdf(self.paper.id), document)
        self.assertEqual(self.store.annotation(annotation.id), annotation)
        self.assertEqual(self.store._read('reports', digest(record)), record)

    def test_changed_pdf_after_review_or_before_export_is_not_replaced(self):
        review = self.review()
        plan = self.confirm(review, tex=False)
        newer = seed_pdf(self.store, self.paper, b'%PDF-1.4 different original')
        with self.assertRaisesRegex(Invalid, 'review changed'):
            self.confirm(review)
        self.acquire(plan, 'pdf')
        with self.assertRaisesRegex(Invalid, 'already saved'):
            self.export(plan)
        self.assertEqual(self.store.paper_pdf(self.paper.id), newer)

    def test_source_failure_retry_cancel_and_pdf_only_retains_pdf(self):
        self.cache_pdf()
        plan = self.confirm()
        self.store.source_downloads.transport = SourceTransport(b'', denied=True)
        self.assertEqual(self.acquire(plan, 'source')['status'], 'denied')
        saved = self.export(plan)
        self.assertIn('texNote', saved)
        self.assertTrue(Path(saved['pdf']).is_file())
        entered, release = multiprocessing.get_context('spawn').Event(), multiprocessing.get_context('spawn').Event()
        self.store.source_downloads.transport = SourceTransport(self.original, entered, release)
        selection = dict(bundleId=plan['bundleId'], resourceId=plan['sourceResourceId'])
        self.store.source_downloads.request(dict(operation='start', **selection))
        self.assertTrue(entered.wait(5))
        self.store.source_downloads.request(dict(operation='cancel', **selection))
        release.set()
        self.assertEqual(finish(self.store.source_downloads, selection)['status'], 'cancelled')
        self.store.source_downloads.transport = SourceTransport(b'%PDF-1.4 source returns PDF')
        self.assertEqual(self.acquire(plan, 'source')['status'], 'pdf_only')
        self.assertEqual(self.export(plan)['texNote'], 'no-tex')
        self.assertEqual(Path(saved['pdf']).read_bytes(), pdf_fixture())

    def test_cached_tex_requires_matching_receipt_urls_digest_and_available_bytes(self):
        for failure in ('final-version', 'different-bytes', 'missing-bytes'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as root:
                store = ResearchStore(root)
                self.store = store
                self.files = LibraryFiles(store, self.copies)
                self.paper = store.save_paper(PaperSnapshot.from_reading(arxiv_reading(), NOW))
                data = pdf_fixture(phrase='Other source bytes.') if failure == 'different-bytes' else pdf_fixture()
                store.pdf_downloads = PdfDownloads(store, LibraryPdfTransport(data,
                    'https://arxiv.org/pdf/1706.03762v2' if failure == 'final-version' else None))
                plan = self.confirm(tex=False)
                acquired = self.acquire(plan, 'pdf')
                self.assertEqual(acquired['status'], 'completed')
                cached = seed_pdf(store, self.paper)
                if failure == 'missing-bytes':
                    (store.root / 'pdf-files' / (cached.file_digest + '.pdf')).unlink()
                    self.assertIsNone(self.files.cached_version(cached))
                else:
                    review = self.review()
                    self.assertFalse(review['tex']['available'])
                    self.assertIsNone(review['draftId'])
                store.pdf_downloads.close()
                store.source_downloads.close()
                store.imports.close()

    def test_export_cannot_pair_legacy_url_only_pdf_with_a_source_grant(self):
        plan = self.confirm()
        self.acquire(plan, 'source')
        cached = seed_pdf(self.store, self.paper)
        plan['pdfResourceId'], plan['documentId'] = None, cached.id
        with self.assertRaisesRegex(Invalid, 'TeX does not match'):
            self.export(plan)
        self.assertEqual(self.store.paper_pdf(self.paper.id), cached)
        self.assertEqual(self.store._list('pdf-downloads'), [])
        self.assertEqual(self.store._list('source-observations'), [])

    def test_pinned_and_officially_frozen_library_papers_reuse_the_real_bundle_both_orders(self):
        for first_version, second_version in (('', 'v3'), ('v3', '')):
            with self.subTest(first=first_version), tempfile.TemporaryDirectory() as root:
                self.store = ResearchStore(root)
                self.files = LibraryFiles(self.store, self.copies)
                self.store.imports.inspector = ResourceInspector(OfficialMetadata(), arxiv_interval=0)
                self.store.pdf_downloads = PdfDownloads(self.store, LibraryPdfTransport(pdf_fixture()))
                self.store.source_downloads = SourceDownloads(self.store, SourceTransport(self.original))
                self.paper = self.store.save_paper(PaperSnapshot.from_reading(arxiv_reading(first_version), NOW))
                first = self.confirm()
                original_id = self.paper.id
                self.paper = self.store.save_paper(PaperSnapshot.from_reading(arxiv_reading(second_version), NOW))
                second = self.confirm()
                self.assertEqual(first['bundleId'], second['bundleId'])
                self.acquire(second, 'pdf')
                self.acquire(second, 'source')
                saved = self.export(second)
                self.assertTrue(Path(saved['tex']).is_file())
                self.assertTrue(self.store.paper_pdf(self.paper.id).source_url.endswith('v3'))
                self.assertIsNone(self.store.paper_pdf(original_id))
                self.store.imports.close()
                self.store.pdf_downloads.close()
                self.store.source_downloads.close()

    def test_bundle_reuse_does_not_infer_other_versions_works_or_url_aliases(self):
        plan = self.confirm()
        self.acquire(plan, 'pdf')
        self.acquire(plan, 'source')
        drafts = set(self.store._list('import-drafts'))
        for url in ('https://arxiv.org/pdf/1706.03762v2',
                    'https://arxiv.org/pdf/9999.00001v1',
                    'https://www.arxiv.org/pdf/1706.03762v1',
                    'https://arxiv.org/pdf/1706.03762v1.pdf',
                    'https://arxiv.org/pdf/1706.03762'):
            with self.subTest(url=url):
                data = arxiv_reading()
                data['pdfUrl'] = url
                self.paper = self.store.save_paper(PaperSnapshot.from_reading(data, NOW))
                with self.assertRaisesRegex(Invalid, 'Bundle does not belong'):
                    self.export(plan)
                self.assertIsNone(self.store.paper_pdf(self.paper.id))
                self.assertEqual(set(self.store._list('import-drafts')), drafts)

    def test_tracking_query_uses_existing_public_url_identity_through_poll_and_export(self):
        data = arxiv_reading('v3')
        data['pdfUrl'] += '?utm_source=fixture'
        self.paper = self.store.save_paper(PaperSnapshot.from_reading(data, NOW))
        review = self.review()
        self.assertNotIn('utm_source', review['pdf']['url'])
        plan = self.confirm(review)
        self.acquire(plan, 'pdf')
        self.acquire(plan, 'source')
        self.assertIn('tex', self.export(plan))

    def test_new_unversioned_pdf_uses_real_official_inspection_before_pairing(self):
        self.paper = self.store.save_paper(PaperSnapshot.from_reading(arxiv_reading(''), NOW))
        self.store.imports.inspector = ResourceInspector(OfficialMetadata(), arxiv_interval=0)
        review = self.review()
        self.assertEqual(review['version'], 'v3')
        self.assertTrue(review['pdf']['url'].endswith('v3'))
        self.assertTrue(review['tex']['url'].endswith('v3'))
        plan = self.confirm(review)
        self.acquire(plan, 'pdf')
        self.acquire(plan, 'source')
        self.export(plan)
        self.assertTrue(self.store.paper_pdf(self.paper.id).source_url.endswith('v3'))

    def test_new_unknown_pdf_is_file_bound_but_later_metadata_cannot_relabel_it(self):
        self.paper = self.store.save_paper(PaperSnapshot.from_reading(arxiv_reading(''), NOW))
        self.store.imports.inspector = ResourceInspector(OfficialMetadata(False), arxiv_interval=0)
        review = self.review()
        self.assertIsNone(review['version'])
        self.assertFalse(review['tex']['available'])
        plan = self.confirm(review, tex=False)
        self.acquire(plan, 'pdf')
        self.export(plan)
        document = self.store.paper_pdf(self.paper.id)
        self.assertEqual(document.source_url, self.paper.pdf_url)
        self.store.imports.inspector = ResourceInspector(OfficialMetadata(), arxiv_interval=0)
        later = self.review()
        self.assertIsNone(later['version'])
        self.assertFalse(later['tex']['available'])
        self.assertIsNone(later['draftId'])
        self.assertEqual(self.store.paper_pdf(self.paper.id), document)

    def test_changed_final_version_refuses_association_even_when_same_work(self):
        plan = self.confirm(tex=False)
        self.store.pdf_downloads.transport = LibraryPdfTransport(pdf_fixture(), 'https://arxiv.org/pdf/1706.03762v2')
        self.acquire(plan, 'pdf')
        with self.assertRaisesRegex(Invalid, 'selected fixed version'):
            self.export(plan)
        self.assertIsNone(self.store.paper_pdf(self.paper.id))
        self.assertEqual(list(Path(self.copies).iterdir()), [])

    def test_non_arxiv_exact_url_pdf_only_preserves_library_identity(self):
        paper = self.store.save_paper(PaperSnapshot.from_reading(reading(source='biorxiv', sourceId='example',
            url='https://www.biorxiv.org/content/10.1101/example',
            pdfUrl='https://www.biorxiv.org/content/10.1101/example.full.pdf'), NOW))
        self.paper = paper
        plan = self.confirm(tex=False)
        self.assertIsNone(plan['sourceResourceId'])
        self.acquire(plan, 'pdf')
        self.export(plan)
        self.assertEqual(self.store.paper_pdf(paper.id).source_url, paper.pdf_url)
        review = self.review()
        self.assertIsNone(review['version'])
        self.assertFalse(review['tex']['available'])

    def test_copy_collision_is_idempotent_and_preserves_existing_bytes(self):
        directory = Path(self.copies)
        first = write_copy(directory, 'paper.pdf', b'first')
        self.assertEqual(write_copy(directory, 'paper.pdf', b'first'), first)
        second = write_copy(directory, 'paper.pdf', b'second')
        self.assertNotEqual(first, second)
        self.assertEqual(first.read_bytes(), b'first')
        self.assertEqual(second.read_bytes(), b'second')
        self.assertEqual(write_copy(directory, 'paper.pdf', b'second'), second)
        link = directory / 'linked.pdf'
        link.symlink_to(first)
        with self.assertRaises(Invalid):
            write_copy(directory, link.name, b'first')
        with self.assertRaises(Invalid):
            paper_directory(link)

    def test_copy_publication_failure_leaves_no_partial_named_or_staged_file(self):
        directory = Path(self.copies)
        for boundary in ('fsync', 'link'):
            with self.subTest(boundary=boundary):
                with patch('paper_agent.library_files.os.' + boundary, side_effect=OSError('injected export failure')):
                    with self.assertRaises(OSError):
                        write_copy(directory, 'paper.pdf', b'complete bytes')
                self.assertEqual(list(directory.iterdir()), [])
        self.assertEqual(write_copy(directory, 'paper.pdf', b'complete bytes').read_bytes(), b'complete bytes')

    def test_http_requires_new_review_and_local_passage_contract_is_preserved(self):
        document = seed_pdf(self.store, self.paper, url='urn:sha256:local')
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(self.store, 'test-token', now=lambda: NOW))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join, 3)
        self.addCleanup(server.shutdown)
        def call(body, token='test-token'):
            connection = HTTPConnection('127.0.0.1', server.server_port, timeout=5)
            connection.request('POST', f'/api/papers/{self.paper.id}/files', json.dumps(body),
                               {'Content-Type': 'application/json', 'X-Pero-App-Token': token})
            response = connection.getresponse()
            result = response.status, json.loads(response.read())
            connection.close()
            return result
        self.assertEqual(call({})[0], 400)
        self.assertEqual(call(dict(operation='prepare'), 'wrong')[0], 401)
        status, review = call(dict(operation='prepare'))
        self.assertEqual(status, 200)
        self.assertTrue(review['pdf']['cached'])
        self.assertFalse(review['tex']['available'])
        with self.assertRaisesRegex(Invalid, 'does not match'):
            locate_passage(self.store, PdfFiles(), dict(documentId=document.id, page=1, start=0, quote='Exact original evidence.'))
