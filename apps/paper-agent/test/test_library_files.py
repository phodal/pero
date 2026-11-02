"""Saved papers land in the user paper directory, with TeX when arXiv has it."""
import gzip
import io
import os
import tempfile
import unittest
from email.message import EmailMessage
from pathlib import Path
from urllib.error import HTTPError

from test_pdf import NOW, pdf_fixture
from test_research import reading
from paper_agent.model import Invalid, PaperSnapshot, digest
from paper_agent.http import handler
from paper_agent.library_files import file_stem, locate_passage, paper_directory, publish
from paper_agent.local_pdf import LocalPdf
from paper_agent.pdf import PdfDocument, PdfPage
from paper_agent.pdf_files import PdfFiles
from paper_agent.store import ResearchStore
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import threading


def arxiv_reading():
    return reading(source='alphaxiv', sourceId='1706.03762', url='https://arxiv.org/abs/1706.03762',
                   pdfUrl='https://arxiv.org/pdf/1706.03762', title='Attention Is All You Need')


class Fetch:
    def __init__(self, source=b'\\documentclass{article}\\begin{document}Hi\\end{document}\n'):
        self.source = source
        self.urls = []

    def __call__(self, request, timeout=30):
        self.urls.append(request.full_url)
        if '/e-print/' not in request.full_url:
            return io.BytesIO(pdf_fixture())
        if self.source == 'redirect' and 'export.arxiv.org' not in request.full_url:
            headers = EmailMessage()
            headers['Location'] = 'https://export.arxiv.org/e-print/1706.03762'
            raise HTTPError(request.full_url, 302, 'Found', headers, None)
        if isinstance(self.source, bytes) and self.source.startswith(b'%PDF-'):
            return io.BytesIO(self.source)
        return io.BytesIO(gzip.compress(b'tex-source'))


def seed_pdf(store, paper, data=None):
    data = pdf_fixture() if data is None else data
    document = PdfDocument.create(paper.id, digest(data), paper.pdf_url or paper.url,
                                  (PdfPage(1, 400, 600, 'First page. Exact original evidence.'),), NOW)
    return store.save_pdf(document, data)


def pdfium_ready():
    try:
        import pypdfium2  # noqa: F401
        import PIL.Image  # noqa: F401
        return True
    except ImportError:
        return False


class LibraryFiles(unittest.TestCase):
    def test_publish_writes_pdf_and_tex(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as papers:
            store = ResearchStore(root)
            fetch = Fetch()
            files = PdfFiles(fetch)
            paper = store.save_paper(PaperSnapshot.from_reading(arxiv_reading(), NOW))
            seed_pdf(store, paper)
            saved = publish(store, files, paper, NOW, papers)
            self.assertTrue(Path(saved['pdf']).read_bytes().startswith(b'%PDF-'))
            self.assertEqual(gzip.decompress(Path(saved['tex']).read_bytes()), b'tex-source')
            self.assertTrue(any('/e-print/1706.03762' in url for url in fetch.urls))
            self.assertEqual(file_stem(paper), '1706.03762')

    def test_locate_rejects_a_shifted_quote(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            document = seed_pdf(store, paper)
            with self.assertRaisesRegex(Invalid, 'does not match'):
                locate_passage(store, PdfFiles(), dict(documentId=document.id, page=1, start=0, quote='Exact original evidence.'))

    def test_missing_tex_keeps_the_pdf(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as papers:
            store = ResearchStore(root)
            files = PdfFiles(Fetch(source=b'%PDF-1.4 no source'))
            paper = store.save_paper(PaperSnapshot.from_reading(arxiv_reading(), NOW))
            seed_pdf(store, paper)
            saved = publish(store, files, paper, NOW, papers)
            self.assertNotIn('tex', saved)
            self.assertEqual(saved['texNote'], 'no-tex')
            self.assertTrue(Path(saved['pdf']).is_file())

    def test_redirect_stays_on_arxiv(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as papers:
            store = ResearchStore(root)
            fetch = Fetch('redirect')
            files = PdfFiles(fetch)
            paper = store.save_paper(PaperSnapshot.from_reading(arxiv_reading(), NOW))
            seed_pdf(store, paper)
            saved = publish(store, files, paper, NOW, papers)
            self.assertIn('https://export.arxiv.org/e-print/1706.03762', fetch.urls)
            self.assertEqual(gzip.decompress(Path(saved['tex']).read_bytes()), b'tex-source')

    def test_paper_directory_refuses_a_symlink(self):
        with tempfile.TemporaryDirectory() as root:
            link = Path(root) / 'linked'
            os.symlink(root, link)
            with self.assertRaisesRegex(Invalid, 'symbolic link'):
                paper_directory(link)

    def test_http_files_and_locate(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as papers:
            store = ResearchStore(root)
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(store, 'test-token', pdf_files=PdfFiles(Fetch()), now=lambda: NOW))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            previous = os.environ.get('PERO_PAPER_DIR')
            os.environ['PERO_PAPER_DIR'] = papers

            def call(path, body):
                connection = HTTPConnection('127.0.0.1', server.server_port, timeout=5)
                connection.request('POST', path, body=json.dumps(body), headers={'Content-Type': 'application/json', 'X-Pero-App-Token': 'test-token'})
                response = connection.getresponse()
                payload = json.loads(response.read())
                status = response.status
                connection.close()
                return status, payload

            try:
                paper = store.save_paper(PaperSnapshot.from_reading(arxiv_reading(), NOW))
                document = seed_pdf(store, paper)
                status, saved = call(f'/api/papers/{paper.id}/files', {})
                self.assertEqual(status, 200, saved)
                self.assertTrue(Path(saved['pdf']).is_file())
                self.assertTrue(saved['tex'].endswith('-src.tar.gz'))
                self.assertEqual(call('/api/library/locate', dict(documentId=document.id, page=1, start=0, quote='missing'))[0], 400)
                if pdfium_ready():
                    uploaded = store.import_pdf(LocalPdf.parse(pdf_fixture(), 'local.pdf'), PdfFiles(), NOW)
                    parsed = store.paper_pdf(uploaded.id)
                    start = parsed.page(1).text.index('Exact original evidence.')
                    status, located = call('/api/library/locate', dict(documentId=parsed.id, page=1, start=start, quote='Exact original evidence.'))
                    self.assertEqual(status, 200)
                    self.assertTrue(located['rects'])
            finally:
                if previous is None:
                    os.environ.pop('PERO_PAPER_DIR', None)
                else:
                    os.environ['PERO_PAPER_DIR'] = previous
                server.shutdown()
                thread.join(timeout=3)
                server.server_close()
