"""PDF download, PDFium parsing and region rendering; no Agent execution."""
from contextlib import closing
import io
import threading
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener

from .literature import ARXIV, _NoRedirect
from .model import Invalid, digest
from .pdf import PdfDocument, PdfPage, PdfRect

MAX_PDF_BYTES = 16 * 1024 * 1024
# PDFium prohibits simultaneous calls even for different documents.
PDFIUM_LOCK = threading.Lock()


class PdfFiles:
    def __init__(self, fetch=None):
        self.fetch = fetch or build_opener(_NoRedirect()).open

    def download(self, paper):
        url = paper.pdf_url
        parsed = urlsplit(url or '')
        allowed = (parsed.scheme == 'https' and not parsed.username and not parsed.password and not parsed.port
                   and ((parsed.hostname == 'arxiv.org' and parsed.path.startswith('/pdf/')
                         and ARXIV.fullmatch(parsed.path[5:].removesuffix('.pdf')))
                        or (parsed.hostname in ('www.biorxiv.org', 'www.medrxiv.org')
                            and parsed.path.startswith('/content/') and parsed.path.endswith('.full.pdf'))))
        if not allowed:
            raise Invalid('This paper needs an arXiv or bioRxiv/medRxiv PDF URL')
        try:
            with closing(self.fetch(Request(url, headers={'User-Agent': 'Pero-Paper-Agent/0.1', 'Accept': 'application/pdf'}), timeout=30)) as response:
                data = response.read(MAX_PDF_BYTES + 1)
        except (HTTPError, URLError, TimeoutError) as error:
            raise Invalid('Cannot download the PDF. Retry or open the original source.', 502) from error
        if len(data) > MAX_PDF_BYTES:
            raise Invalid('PDF exceeds 16 MiB', 413)
        if not data.startswith(b'%PDF-'):
            raise Invalid('The source did not return a PDF', 502)
        return data

    def inspect(self, paper, data, now):
        pdfium = self._engine()
        try:
            with PDFIUM_LOCK, closing(pdfium.PdfDocument(data)) as pdf:
                if not 1 <= len(pdf) <= 500:
                    raise Invalid('PDF must contain 1–500 pages')
                pages = []
                for i in range(len(pdf)):
                    with closing(pdf[i]) as page:
                        # EmbedPDF normalizes intrinsic rotation on open. Use the
                        # same coordinate space without rewriting the original file.
                        page.set_rotation(0)
                        with closing(page.get_textpage()) as textpage:
                            content = textpage.get_text_range()
                        if len(content) > 120000:
                            raise Invalid('PDF page text exceeds 120,000 characters')
                        pages.append(PdfPage(i + 1, page.get_width(), page.get_height(), content))
                return PdfDocument.create(paper.id, digest(data), paper.pdf_url, tuple(pages), now)
        except pdfium.PdfiumError as error:
            raise Invalid('Cannot read this PDF. It may be encrypted or damaged.', 422) from error

    def crop(self, data, annotation):
        pdfium = self._engine()
        rect = annotation.rects[0]
        with PDFIUM_LOCK, closing(pdfium.PdfDocument(data)) as pdf, closing(pdf[annotation.page - 1]) as page:
            page.set_rotation(0)
            scale = min(2, 2400 / max(page.get_size()))
            with closing(page.render(scale=scale)) as bitmap:
                image = bitmap.to_pil()
                width, height = image.size
                cropped = image.crop((int(rect.x * width), int(rect.y * height),
                                      max(int((rect.x + rect.width) * width), int(rect.x * width) + 1),
                                      max(int((rect.y + rect.height) * height), int(rect.y * height) + 1)))
                output = io.BytesIO()
                cropped.save(output, format='PNG')
                image.close()
                cropped.close()
                return output.getvalue()

    def locate_quote(self, data, document, page_number, start, quote):
        pdfium = self._engine()
        page_info = document.page(page_number)
        ordinal = page_info.text[:start].count(quote)
        with PDFIUM_LOCK, closing(pdfium.PdfDocument(data)) as pdf, closing(pdf[page_number - 1]) as page:
            page.set_rotation(0)
            with closing(page.get_textpage()) as textpage, closing(textpage.search(quote, match_case=True)) as search:
                match = None
                for _ in range(ordinal + 1):
                    match = search.get_next()
                    if match is None:
                        raise Invalid('The quotation cannot be located in this PDF', 422)
                rects = []
                for i in range(textpage.count_rects(*match)):
                    left, bottom, right, top = textpage.get_rect(i)
                    x, y = max(0, left / page_info.width), max(0, 1 - top / page_info.height)
                    width = min(1, right / page_info.width) - x
                    height = min(1, 1 - bottom / page_info.height) - y
                    if width > 0 and height > 0:
                        rects.append(PdfRect(x, y, width, height))
                if not rects:
                    raise Invalid('The quotation has no selectable PDF text region', 422)
                return tuple(rects)

    @staticmethod
    def _engine():
        try:
            import pypdfium2
            import PIL.Image  # noqa: F401
        except ImportError as error:
            raise Invalid('Install Paper Agent PDF dependencies in the shared Python environment: pip install pypdfium2==5.0.0 Pillow==12.0.0', 503) from error
        return pypdfium2
