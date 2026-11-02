"""PDF download, PDFium parsing and region rendering; no Agent execution."""
from contextlib import closing
import io
import threading

from .model import Invalid, PaperSnapshot, digest
from .pdf import PdfAnchor, PdfDocument, PdfPage, PdfRect

from .local_pdf import LocalPdf
# PDFium prohibits simultaneous calls even for different documents.
PDFIUM_LOCK = threading.Lock()


class PdfFiles:
    def inspect(self, paper, data, now):
        return PdfDocument.create(paper.id, digest(data), paper.pdf_url or paper.url, self.pages(data), now)

    def import_local(self, upload: LocalPdf, now):
        return self.from_pages(upload, self.pages(upload.data), now)

    @staticmethod
    def from_pages(upload, pages, now):
        if not pages:
            raise Invalid('PDF must contain at least one page', 422)
        content = '\n\n'.join(page.text for page in pages)
        limitation = None
        if not content.strip():
            content = ''
            limitation = 'This PDF has no selectable text. OCR is not available; use the PDF view.'
        elif len(content) > 120000:
            limitation = 'Text view is limited to 120,000 characters; full PDF page text remains searchable.'
        paper = PaperSnapshot.from_reading(dict(source='local-pdf', sourceId=upload.file_digest,
            title=upload.title, url='urn:sha256:' + upload.file_digest, contentKind='full-text',
            content=content[:120000], authors=[],
            **(dict(limitation=limitation) if limitation else {})), now)
        return paper, PdfDocument.create(paper.id, upload.file_digest, paper.url, pages, now)

    def pages(self, data):
        pdfium = self._engine()
        try:
            with PDFIUM_LOCK, closing(pdfium.PdfDocument(data)) as pdf:
                if not 1 <= len(pdf) <= 500:
                    raise Invalid('PDF must contain 1–500 pages')
                pages, characters = [], 0
                for i in range(len(pdf)):
                    with closing(pdf[i]) as page:
                        # EmbedPDF normalizes intrinsic rotation on open. Use the
                        # same coordinate space without rewriting the original file.
                        page.set_rotation(0)
                        with closing(page.get_textpage()) as textpage:
                            content = textpage.get_text_range()
                        if len(content) > 120000:
                            raise Invalid('PDF page text exceeds 120,000 characters')
                        characters += len(content)
                        if characters > 8_000_000:
                            raise Invalid('PDF text exceeds 8,000,000 characters', 413)
                        pages.append(PdfPage(i + 1, page.get_width(), page.get_height(), content))
                return tuple(pages)
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

    def locate_anchor(self, data, document, value):
        return self.locate_anchors(data, document, value.get('fileDigest'), value.get('page'),
                                   [(value.get('start'), value.get('end'))])[0]

    def locate_anchors(self, data, document, file_digest, page_number, windows):
        """Resolve one page's exact windows against one verified PDFium session."""
        if file_digest != document.file_digest or digest(data) != document.file_digest:
            raise Invalid('Anchor PDF version does not match the saved original', 409)
        page_info = document.page(page_number)
        for start, end in windows:
            if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(page_info.text) or end - start > 4800:
                raise Invalid('Choose an exact PDF text window of at most 4,800 characters')
        pdfium = self._engine()
        anchors = []
        with PDFIUM_LOCK, closing(pdfium.PdfDocument(data)) as pdf, closing(pdf[page_number - 1]) as page:
            page.set_rotation(0)
            with closing(page.get_textpage()) as textpage:
                if textpage.get_text_range() != page_info.text:
                    raise Invalid('Saved PDF text differs from the current extraction; reopen the original PDF', 409)
                for start, end in windows:
                    quote = page_info.text[start:end]
                    # PDFium search may return only part of a multiline phrase.
                    # Map this exact saved window instead; PDFium text indices
                    # use UTF-16 units, while our offsets count Python characters.
                    text_start = len(page_info.text[:start].encode('utf-16-le')) // 2
                    text_end = text_start + len(quote.encode('utf-16-le')) // 2 - 1
                    first = pdfium.raw.FPDFText_GetCharIndexFromTextIndex(textpage, text_start)
                    last = pdfium.raw.FPDFText_GetCharIndexFromTextIndex(textpage, text_end)
                    if first < 0 or last < first or textpage.get_text_range(first, last - first + 1) != quote:
                        raise Invalid('The quotation has no exact PDF text region', 422)
                    rects = []
                    for i in range(textpage.count_rects(first, last - first + 1)):
                        left, bottom, right, top = textpage.get_rect(i)
                        x, y = max(0, left / page_info.width), max(0, 1 - top / page_info.height)
                        width = min(1, right / page_info.width) - x
                        height = min(1, 1 - bottom / page_info.height) - y
                        if width > 0 and height > 0:
                            rects.append(PdfRect(x, y, width, height))
                    if not rects:
                        raise Invalid('The quotation has no selectable PDF text region', 422)
                    anchor = PdfAnchor(document.id, document.file_digest, page_number, tuple(rects))
                    anchors.append({**anchor.to_dict(), 'start': start, 'end': end, 'verification': 'pdf-text-match'})
        return anchors

    @staticmethod
    def _engine():
        try:
            import pypdfium2
            import PIL.Image  # noqa: F401
        except ImportError as error:
            raise Invalid('Install Paper Agent PDF dependencies in the shared Python environment: pip install pypdfium2==5.0.0 Pillow==12.0.0', 503) from error
        return pypdfium2
