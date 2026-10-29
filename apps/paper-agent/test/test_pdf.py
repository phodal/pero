"""PDF anchors and real PDFium parsing/cropping, using a tiny local PDF."""
import io
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.model import Invalid, PaperSnapshot
from paper_agent.pdf import PdfAnnotation, PdfDocument, PdfPage, PdfRect
from paper_agent.pdf_files import PdfFiles
from paper_agent.store import ResearchStore

NOW = '2026-10-29T00:00:00Z'


def pdf_fixture():
    """Two pages, with repeated words to exercise page-specific source anchors."""
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               b'<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Rotate 90 /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    for label in ('First', 'Second'):
        stream = f'BT /F1 16 Tf 40 520 Td ({label} page. Exact original evidence.) Tj ET\n0.2 0.5 0.6 rg 40 100 200 250 re f'.encode()
        objects.append(b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream')
    data = bytearray(b'%PDF-1.4\n')
    offsets = [0]
    for i, item in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f'{i} 0 obj\n'.encode() + item + b'\nendobj\n')
    offset = len(data)
    data.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
    for item in offsets[1:]:
        data.extend(f'{item:010d} 00000 n \n'.encode())
    data.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{offset}\n%%EOF\n'.encode())
    return bytes(data)


class PdfTest(unittest.TestCase):
    def test_source_anchor_rules(self):
        doc = PdfDocument.create('a' * 64, 'b' * 64, 'https://arxiv.org/pdf/1706.03762',
                                 (PdfPage(1, 400, 600, 'Exact original\r\nevidence.'),), NOW)
        base = dict(page=1, kind='highlight', quote='Exact original evidence.', rects=[dict(x=.1, y=.1, width=.6, height=.1)])
        for patch, valid in (({}, True), (dict(page=0), False), (dict(page=True), False),
                             (dict(quote='Invented evidence'), False), (dict(rects=[]), False),
                             (dict(kind='figure', quote=''), True), (dict(kind='unknown'), False)):
            with self.subTest(patch=patch):
                if valid:
                    PdfAnnotation.create({**base, **patch}, doc, NOW)
                else:
                    with self.assertRaises(Invalid):
                        PdfAnnotation.create({**base, **patch}, doc, NOW)
        for rect in (dict(x=-.1,y=0,width=.2,height=.1), dict(x=0,y=0,width=0,height=1),
                     dict(x=.8,y=0,width=.3,height=1), dict(x=float('nan'),y=0,width=.1,height=.1)):
            with self.subTest(rect=rect), self.assertRaises(Invalid):
                PdfRect.parse(rect)

    def test_pdfium_files_and_persistent_annotations(self):
        from PIL import Image
        paper = PaperSnapshot.from_reading(dict(title='Synthetic PDF', sourceId='1706.03762',
                    url='https://arxiv.org/abs/1706.03762', pdfUrl='https://arxiv.org/pdf/1706.03762',
                    contentKind='full-text', content='Exact original evidence.'), NOW)
        content = pdf_fixture()
        files = PdfFiles(lambda *_args, **_kwargs: io.BytesIO(content))
        doc = files.inspect(paper, files.download(paper), NOW)
        self.assertEqual(doc.matching_pages('Exact original evidence.'), (1, 2))
        self.assertEqual((doc.pages[1].width, doc.pages[1].height), (400, 600))
        figure = PdfAnnotation.create(dict(page=2, kind='figure', rects=[dict(x=.1,y=.2,width=.5,height=.5)]), doc, NOW)
        crop = files.crop(content, figure)
        with Image.open(io.BytesIO(crop)) as image:
            self.assertEqual(image.size, (400, 600))
            self.assertLess(sum(abs(a - b) for a, b in zip(image.getpixel((200, 300))[:3], (51, 128, 153))), 4)
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            store.save_paper(paper); store.save_pdf(doc, content); store.save_annotation(figure, crop)
            cell = store.add_reading_cell(figure.id, 'Results', NOW)
            reopened = ResearchStore(root)
            self.assertEqual(reopened.pdf_bytes(reopened.paper_pdf(paper.id)), content)
            self.assertEqual(reopened.annotation_image(figure.id), crop)
            self.assertEqual(reopened.annotations(doc.id), [figure])
            self.assertEqual(reopened.reading_matrix()[0]['annotation']['id'], figure.id)
            self.assertEqual(reopened.add_reading_cell(figure.id, 'Results', 'later'), cell)


if __name__ == '__main__':
    unittest.main()
