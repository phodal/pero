"""Selected PDF safety and real PDFium acquisition, never a live network test."""
from dataclasses import dataclass, replace
import io
import multiprocessing
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.model import Invalid, ResearchRequest, PaperSnapshot, digest
from paper_agent.pdf_download import PdfDownload
from paper_agent.pdf_downloads import PdfDownloads
from paper_agent.research_resources import ImportDraft, ResearchResource
from paper_agent.resource_fetch import PdfResponse, PublicMetadata
from paper_agent.store import ResearchStore
from test_pdf import pdf_fixture, image_pdf_fixture

NOW = '2026-11-01T00:00:00Z'
SEED = 'https://research.example/blog'
PDF = 'https://static.example/science/paper.pdf'


@dataclass
class PdfTransport:
    data: bytes
    entered: object = None
    release: object = None

    def fetch_pdf(self, url):
        if self.entered is not None:
            self.entered.set()
        if self.release is not None:
            self.release.wait()
        return PdfResponse('https://cdn.example/final.pdf', self.data)


def save_bundle(store, url=PDF, approved=True):
    candidate = ResearchResource.linked(url, SEED, 'Paper')
    draft = ImportDraft.create(SEED, NOW).finish((candidate,), ())
    store.imports._replace('import-drafts', draft.id, draft.to_dict())
    bundle = store.imports.commit(dict(draftId=draft.id, resourceIds=[candidate.id], pdfIds=[candidate.id] if approved else [], confirmedDownloads=approved), NOW)
    return dict(bundleId=bundle.id, resourceId=candidate.id)


def finish(downloads, selection):
    result = downloads.request(dict(operation='status', **selection))
    worker = downloads.running.get(result['id'])
    if worker:
        worker[1].join(timeout=8)
        if worker[1].is_alive():
            raise AssertionError('PDF worker did not terminate')
    return downloads.request(dict(operation='status', **selection))


class PdfAcquisitionTest(unittest.TestCase):
    def test_image_only_pdf_is_saved_renderable_and_never_text_evidence(self):
        from PIL import Image
        from paper_agent.pdf import PdfAnnotation
        from paper_agent.pdf_files import PdfFiles
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            selection = save_bundle(store)
            data = image_pdf_fixture()
            downloads = PdfDownloads(store, PdfTransport(data))
            downloads.request(dict(operation='start', **selection))
            result = finish(downloads, selection)
            self.assertEqual(result['status'], 'completed', result)
            receipt = result['receipt']
            self.assertEqual((receipt['pageCount'], receipt['textPages'], receipt['textCharacters']), (1, 0, 0))
            self.assertIn('OCR is not available', ' '.join(receipt['extractionWarnings']))
            self.assertEqual(result['readPages'], [])
            document = store.pdf(receipt['documentId'])
            self.assertEqual(document.page(1).text, '')
            self.assertEqual(store.pdf_bytes(document), data)
            paper = store.paper(receipt['paperId'])
            self.assertEqual(paper.content, '')
            self.assertIn('OCR is not available', paper.limitation)
            region = PdfAnnotation.create(dict(page=1, kind='figure', rects=[dict(x=0, y=0, width=1, height=1)]), document, NOW)
            rendered = PdfFiles().crop(data, region)
            with Image.open(io.BytesIO(rendered)) as image:
                self.assertGreater(image.width, 0)
                self.assertNotEqual(image.getpixel((10, 10)), image.getpixel((image.width - 10, image.height - 10)))
            request = ResearchRequest.parse(dict(requestId='image-only', question='Read full text', paperIds=[paper.id], fullText=True))
            with self.assertRaisesRegex(Invalid, 'no selectable text'):
                store.create_study(request, NOW)
            self.assertEqual(store._list('studies'), [])
            with self.assertRaises(Invalid):
                PdfAnnotation.create(dict(page=1, kind='highlight', quote='Fabricated text', rects=[dict(x=0, y=0, width=.5, height=.5)]), document, NOW)
            reopened = ResearchStore(root)
            self.assertEqual(reopened.pdf_downloads.request(dict(operation='status', **selection)), result)
            self.assertEqual(reopened.paper(paper.id).content, '')

    def test_local_image_pdf_import_keeps_empty_lines_and_source_contract_narrow(self):
        from paper_agent.local_pdf import LocalPdf
        from paper_agent.pdf_files import PdfFiles
        from test_research import reading
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            data = image_pdf_fixture()
            upload = LocalPdf.parse(data, 'image.pdf')
            paper = store.import_pdf(upload, PdfFiles(), NOW)
            self.assertEqual(paper.content, '')
            self.assertEqual(store._read('papers', paper.id)['lines'], [])
            self.assertEqual(ResearchStore(root).paper(paper.id), paper)
            with self.assertRaisesRegex(Invalid, 'at least one page'):
                PdfFiles.from_pages(upload, (), NOW)
            for source, kind in (('import', 'full-text'), ('alphaxiv', 'full-text'), ('local-pdf', 'abstract'), ('local-pdf', 'report')):
                with self.subTest(source=source, kind=kind), self.assertRaises(Invalid):
                    PaperSnapshot.from_reading({**paper.to_dict(), 'source': source, 'contentKind': kind}, NOW)
            with self.assertRaises(Invalid):
                PaperSnapshot.from_reading(reading(content='', source='local-pdf', sourceId='not-a-digest', url='https://example.org'), NOW)

    def test_metadata_abstract_cannot_replace_image_only_pdf_text_in_study(self):
        from paper_agent.pdf_files import PdfFiles
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(dict(title='Scan metadata', sourceId='scan',
                url='https://example.org/scan', contentKind='abstract', content='A real metadata abstract.'), NOW))
            data = image_pdf_fixture()
            store.save_pdf(PdfFiles().inspect(paper, data, NOW), data)
            request = ResearchRequest.parse(dict(requestId='scan-metadata', question='Read full text', paperIds=[paper.id], fullText=True))
            with self.assertRaisesRegex(Invalid, 'no selectable text'):
                store.create_study(request, NOW)
            self.assertEqual(store._list('studies'), [])
            readable = store.save_paper(PaperSnapshot.from_reading(dict(title='Readable paper', sourceId='text',
                url='https://example.org/text', contentKind='abstract', content='Another metadata abstract.'), NOW))
            text_bytes = pdf_fixture()
            store.save_pdf(PdfFiles().inspect(readable, text_bytes, NOW), text_bytes)
            mixed = ResearchRequest.parse(dict(requestId='mixed-scan', question='Read both', paperIds=[readable.id, paper.id], fullText=True))
            with self.assertRaisesRegex(Invalid, 'no selectable text'):
                store.create_study(mixed, NOW)
            self.assertEqual(store._list('studies'), [])

    def test_authorization_versions_restart_and_observed_pages(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            selection = save_bundle(store, approved=False)
            for op in ('start', 'status', 'cancel'):
                with self.subTest(op=op), self.assertRaises(Invalid):
                    store.pdf_downloads.request(dict(operation=op, **selection))
            self.assertEqual(store._list('pdf-downloads'), [])
            selection = save_bundle(store)
            downloads = PdfDownloads(store, PdfTransport(pdf_fixture()))
            initial = downloads.request(dict(operation='start', **selection))
            self.assertEqual(initial['status'], 'running')
            self.assertEqual(downloads.request(dict(operation='start', **selection))['id'], initial['id'])
            result = finish(downloads, selection)
            self.assertEqual(result['status'], 'completed', result)
            self.assertEqual(result['readPages'], [])
            receipt = result['receipt']
            self.assertEqual((receipt['pageCount'], receipt['sourcePageUrl'], receipt['requestUrl']), (2, SEED, PDF))
            self.assertEqual(receipt['identityStatus'], 'unresolved')
            self.assertEqual(receipt['explicitVersion'], 'sha256:' + receipt['fileDigest'])
            self.assertEqual(store.pdf_bytes(store.pdf(receipt['documentId'])), pdf_fixture())
            reopened = ResearchStore(root)
            self.assertEqual(reopened.pdf_downloads.request(dict(operation='start', **selection)), result)
            # Same bytes from another URL retain the first immutable document and a new provenance receipt.
            other = save_bundle(store, 'https://another.example/paper.pdf')
            downloads.request(dict(operation='start', **other))
            same = finish(downloads, other)
            self.assertEqual(same['receipt']['documentId'], receipt['documentId'])
            self.assertNotEqual(same['receipt']['requestUrl'], receipt['requestUrl'])
            changed = save_bundle(store, 'https://another.example/new.pdf')
            downloads.transport = PdfTransport(pdf_fixture().replace(b'First', b'Third'))
            downloads.request(dict(operation='start', **changed))
            newer = finish(downloads, changed)
            self.assertNotEqual(newer['receipt']['documentId'], receipt['documentId'])
            self.assertEqual(len(store._list('pdfs')), 2)
            request = ResearchRequest.parse(dict(requestId='read-pdf', question='What is the evidence?', paperIds=[receipt['paperId']], fullText=True))
            study = store.create_study(request, NOW)
            store.study_step(dict(studyId=study.id, action='read', paperId=receipt['paperId'], page=2), NOW)
            self.assertEqual(downloads.request(dict(operation='status', **selection))['readPages'], [2])

    def test_google_and_explicit_arxiv_pdf_versions_share_the_import_path(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            google_url = 'https://www.gstatic.com/science-ai/agentic_aptamer_sandbox.pdf'
            arxiv_url = 'https://arxiv.org/pdf/2610.24806v1'
            # Self-authored bytes model unequal source versions, not the original papers.
            import pypdfium2 as pdfium
            versions = []
            for count in (27, 34):
                with pdfium.PdfDocument(pdf_fixture()) as source, pdfium.PdfDocument.new() as target:
                    target.import_pages(source, [0] * count)
                    output = io.BytesIO(); target.save(output)
                    versions.append(output.getvalue())
            first_bytes, second_bytes = versions
            resources = tuple(ResearchResource.linked(url, SEED, 'Same work label') for url in (google_url, arxiv_url))
            draft = ImportDraft.create(SEED, NOW).finish(resources, ())
            store.imports._replace('import-drafts', draft.id, draft.to_dict())
            body = dict(draftId=draft.id, resourceIds=[r.id for r in resources])
            refs = store.imports.commit(body, NOW)
            self.assertEqual(refs.pdfDownloadIds, ())
            bundle = store.imports.commit({**body, 'pdfIds': [r.id for r in resources], 'confirmedDownloads': True}, NOW)
            downloads = PdfDownloads(store, PdfTransport(first_bytes))
            receipts = []
            for resource, data in zip(resources, (first_bytes, second_bytes)):
                downloads.transport = PdfTransport(data)
                selection = dict(bundleId=bundle.id, resourceId=resource.id)
                downloads.request(dict(operation='start', **selection))
                result = finish(downloads, selection)
                self.assertEqual(result['status'], 'completed', result)
                self.assertEqual(result['receipt']['requestUrl'], resource.originalUrl)
                receipts.append(result['receipt'])
            self.assertEqual(store.paper(receipts[1]['paperId']).title, '2610.24806v1')
            self.assertNotEqual(receipts[0]['documentId'], receipts[1]['documentId'])
            self.assertEqual([r['pageCount'] for r in receipts], [27, 34])
            for receipt in receipts:
                request = ResearchRequest.parse(dict(requestId=receipt['fileDigest'][:32], question='Read this version', paperIds=[receipt['paperId']], fullText=True))
                study = store.create_study(request, NOW)
                self.assertEqual(study.sources[0].document_id, receipt['documentId'])
                store.study_step(dict(studyId=study.id, action='read', paperId=receipt['paperId'], page=receipt['pageCount']), NOW)
                self.assertEqual(store.study(study.id).steps[-1].passages[0].document_id, receipt['documentId'])
            self.assertEqual(store.pdf_bytes(store.pdf(receipts[0]['documentId'])), first_bytes)

    def test_cancel_timeout_parse_failure_and_retry_do_not_publish(self):
        ctx = multiprocessing.get_context('spawn')
        for mode in ('cancel', 'timeout', 'damaged'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as root:
                store = ResearchStore(root)
                selection = save_bundle(store)
                entered, release = ctx.Event(), ctx.Event()
                data = b'%PDF-broken' if mode == 'damaged' else pdf_fixture()
                transport = PdfTransport(data, entered, release if mode in ('cancel', 'timeout') else None)
                downloads = PdfDownloads(store, transport, seconds=0.7 if mode == 'timeout' else 10)
                downloads.request(dict(operation='start', **selection))
                self.assertTrue(entered.wait(timeout=3))
                if mode == 'cancel':
                    downloads.request(dict(operation='cancel', **selection))
                result = finish(downloads, selection)
                self.assertEqual(result['status'], 'cancelled' if mode == 'cancel' else 'failed', result)
                self.assertIsNone(result['receipt'])
                self.assertEqual(store._list('pdfs'), [])
                self.assertEqual(store._list('papers'), [])
                downloads.transport, downloads.seconds = PdfTransport(pdf_fixture()), 10
                downloads.request(dict(operation='start', **selection))
                self.assertEqual(finish(downloads, selection)['status'], 'completed')

    def test_reused_bytes_receipt_never_switches_to_newer_pdf_of_same_paper(self):
        from paper_agent.pdf_files import PdfFiles
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = PaperSnapshot.from_reading(dict(title='Known work', sourceId='known',
                url='https://arxiv.org/abs/1706.03762', pdfUrl='https://arxiv.org/pdf/1706.03762',
                contentKind='abstract', content='An abstract.'), NOW)
            store.save_paper(paper)
            original = PdfFiles().inspect(paper, pdf_fixture(), NOW)
            newer_bytes = pdf_fixture().replace(b'First', b'Third')
            newer = PdfFiles().inspect(paper, newer_bytes, '2026-11-02T00:00:00Z')
            store.save_pdf(original, pdf_fixture())
            store.save_pdf(newer, newer_bytes)
            self.assertEqual(store.paper_pdf(paper.id).id, newer.id)
            selection = save_bundle(store)
            downloads = PdfDownloads(store, PdfTransport(pdf_fixture()))
            downloads.request(dict(operation='start', **selection))
            receipt = finish(downloads, selection)['receipt']
            self.assertNotEqual(receipt['paperId'], paper.id)
            self.assertEqual(receipt['fileDigest'], digest(pdf_fixture()))
            self.assertEqual(store.paper_pdf(receipt['paperId']).file_digest, original.file_digest)
            request = ResearchRequest.parse(dict(requestId='exact-old-version', question='Read old bytes', paperIds=[receipt['paperId']], fullText=True))
            self.assertEqual(store.create_study(request, NOW).sources[0].file_digest, original.file_digest)
            self.assertEqual(len(list((store.root / 'pdf-files').glob('*.pdf'))), 2)

    def test_publish_failure_rolls_back_and_crash_orphan_can_retry(self):
        from unittest.mock import patch
        from paper_agent.local_pdf import LocalPdf
        from paper_agent.pdf_files import PdfFiles
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            upload = LocalPdf.parse(pdf_fixture(), 'original.pdf')
            paper, document = PdfFiles().import_local(upload, NOW)
            with patch.object(store, 'save_paper', side_effect=Invalid('Synthetic disk write failure')):
                with self.assertRaises(Invalid):
                    store.import_prepared_pdf(paper, document, upload.data)
            self.assertEqual(store._list('pdfs'), [])
            self.assertEqual(store._list('papers'), [])
            self.assertEqual(list((store.root / 'pdf-files').glob('*.pdf')), [])
            # Simulate a crash, not an exception: PDF is complete but its paper
            # write never happened. The next explicit retry repairs the pair.
            store.save_pdf(document, upload.data)
            self.assertEqual(store.import_prepared_pdf(paper, document, upload.data).id, paper.id)
            self.assertEqual(store.pdf_bytes(store.pdf(document.id)), upload.data)

    def test_unavailable_bytes_restore_requires_original_digest_and_keeps_receipt(self):
        for damage in ('missing', 'truncated', 'same-size', 'symlink'):
            with self.subTest(damage=damage), tempfile.TemporaryDirectory() as root:
                store = ResearchStore(root)
                selection = save_bundle(store)
                downloads = PdfDownloads(store, PdfTransport(pdf_fixture()))
                downloads.request(dict(operation='start', **selection))
                original = finish(downloads, selection)
                receipt = original['receipt']
                path = store.root / 'pdf-files' / (receipt['fileDigest'] + '.pdf')
                request = ResearchRequest.parse(dict(requestId='cached-version', question='Read original', paperIds=[receipt['paperId']], fullText=True))
                study = store.create_study(request, NOW)
                document_before = store.pdf(receipt['documentId']).to_record()
                study_before = store.study(study.id).to_record()
                external = Path(root) / 'unrelated.pdf'
                external.write_bytes(b'unrelated user bytes')
                if damage == 'missing':
                    path.unlink()
                elif damage == 'symlink':
                    path.unlink()
                    path.symlink_to(external)
                else:
                    path.write_bytes(pdf_fixture()[:12] if damage == 'truncated' else pdf_fixture().replace(b'First', b'Third'))
                damaged_bytes = path.read_bytes() if path.exists() else None
                reopened = ResearchStore(root)
                unavailable = reopened.pdf_downloads.request(dict(operation='status', **selection))
                self.assertEqual((unavailable['status'], unavailable['stage'], unavailable['localAvailable']), ('unavailable', 'unavailable', False))
                self.assertEqual(unavailable['receipt'], receipt)
                downloads = PdfDownloads(reopened, PdfTransport(pdf_fixture().replace(b'First', b'Third')))
                downloads.request(dict(operation='start', **selection))
                failed = finish(downloads, selection)
                self.assertEqual(failed['status'], 'failed')
                self.assertIn('source bytes changed', failed['error'])
                self.assertEqual(failed['receipt'], receipt)
                self.assertEqual(path.read_bytes() if path.exists() else None, damaged_bytes)
                self.assertEqual(len(store._list('pdfs')), 1)
                downloads.transport = PdfTransport(pdf_fixture())
                downloads.request(dict(operation='start', **selection))
                restored = finish(downloads, selection)
                self.assertEqual((restored['status'], restored['localAvailable']), ('completed', True))
                self.assertEqual(restored['receipt'], receipt)
                self.assertTrue(restored['restoredAt'])
                self.assertEqual(path.read_bytes(), pdf_fixture())
                self.assertFalse(path.is_symlink())
                self.assertEqual(external.read_bytes(), b'unrelated user bytes')
                self.assertEqual(reopened.pdf(receipt['documentId']).to_record(), document_before)
                self.assertEqual(reopened.study(study.id).to_record(), study_before)

    def test_cache_repair_publish_failure_and_invalid_input_preserve_existing_bytes(self):
        from unittest.mock import patch
        from paper_agent.local_pdf import LocalPdf
        from paper_agent.pdf_files import PdfFiles
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            upload = LocalPdf.parse(pdf_fixture(), 'original.pdf')
            paper, document = PdfFiles().import_local(upload, NOW)
            store.import_prepared_pdf(paper, document, upload.data)
            directory = store.root / 'pdf-files'
            path = directory / (document.file_digest + '.pdf')
            path.write_bytes(b'truncated')
            with patch('paper_agent.store.os.replace', side_effect=OSError('Synthetic publish failure')):
                with self.assertRaises(OSError):
                    store.save_pdf(document, upload.data)
            self.assertEqual(path.read_bytes(), b'truncated')
            self.assertEqual(list(directory.iterdir()), [path])
            with self.assertRaisesRegex(Invalid, 'original SHA-256'):
                store.save_pdf(document, b'wrong original')
            self.assertEqual(path.read_bytes(), b'truncated')
            store.save_pdf(document, upload.data)
            self.assertEqual(path.read_bytes(), upload.data)
            self.assertEqual(store.pdf(document.id), document)
            # Refuse a redirected cache directory rather than publishing outside it.
            path.unlink()
            directory.rmdir()
            external = Path(root) / 'external'
            external.mkdir()
            directory.symlink_to(external, target_is_directory=True)
            self.assertFalse(store.pdf_available(document.file_digest, len(upload.data)))
            with self.assertRaisesRegex(Invalid, 'symbolic link'):
                store.save_pdf(document, upload.data)
            self.assertEqual(list(external.iterdir()), [])

    def test_real_pdfium_page_limit(self):
        import pypdfium2 as pdfium
        from paper_agent.pdf_files import PdfFiles
        with pdfium.PdfDocument.new() as document:
            for _ in range(501):
                document.new_page(100, 100).close()
            output = io.BytesIO()
            document.save(output)
        with self.assertRaisesRegex(Invalid, '1–500 pages'):
            PdfFiles().pages(output.getvalue())

    def test_restart_marks_inflight_interrupted_and_domain_terminal_is_immutable(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            selection = save_bundle(store)
            job = PdfDownload.create(selection['bundleId'], selection['resourceId']).start()
            store.pdf_downloads._save(job)
            reopened = ResearchStore(root)
            self.assertEqual(reopened.pdf_downloads.request(dict(operation='status', **selection))['status'], 'interrupted')
            cancelled = job.finish('cancelled', 'Stopped')
            self.assertEqual(cancelled.finish('failed', 'later'), cancelled)


class PdfTransportTest(unittest.TestCase):
    def test_pdf_mime_magic_size_public_redirects_and_credentials(self):
        replies, opened = [], []
        class Connection:
            def __init__(self, host, address, timeout):
                opened.append((host, address)); self.sock = None
            def request(self, *_args, **_kwargs): pass
            def getresponse(self): return replies.pop(0)
            def close(self): pass
        def response(data=b'%PDF-minimal', status=200, **headers):
            item = io.BytesIO(data)
            item.status = status
            fields = {'Content-Type': 'application/pdf', **headers}
            item.getheader = lambda key, default=None: fields.get(key, default)
            return item
        def resolve(host, *_args, **_kwargs):
            return [(None, None, None, None, ('127.0.0.1' if host == 'private.example' else '93.184.216.34', 443))]
        transport = PublicMetadata(resolve, Connection)
        for reply, message in ((response(**{'Content-Type': 'text/html'}), 'application/pdf'),
                               (response(b'<html>not pdf'), 'did not return a PDF'),
                               (response(**{'Content-Length': str(16 * 1024 * 1024 + 1)}), 'byte limit'),
                               (response(status=302, Location='https://private.example/a.pdf'), 'Private'),
                               (response(status=302, Location=PDF + '?token=secret'), 'Credential-bearing'),
                               (response(**{'Content-Encoding': 'gzip'}), 'Compressed'),
                               (response(**{'Content-Length': '999'}), 'Incomplete'),
                               (response(b'%PDF-' + b'x' * (16 * 1024 * 1024)), 'byte limit')):
            replies.append(reply)
            with self.subTest(message=message), self.assertRaisesRegex(Invalid, message): transport.fetch_pdf(PDF)
        replies.extend([response(status=302, Location='https://cdn.example/final.pdf'), response()])
        self.assertEqual(transport.fetch_pdf(PDF).url, 'https://cdn.example/final.pdf')
        self.assertEqual(opened[-1], ('cdn.example', '93.184.216.34'))
        replies.append(response())
        with self.assertRaisesRegex(Invalid, 'binary'): transport.fetch(PDF)


if __name__ == '__main__':
    unittest.main()
