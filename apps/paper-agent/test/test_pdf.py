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


def pdf_fixture(repeated=False, phrase="Exact original evidence."):
    """Two pages, with repeated words to exercise page-specific source anchors."""
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               b'<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Rotate 90 /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    for label in ('First', 'Second'):
        repeat = ''.join(f' 0 -{7 if repeated > 1 else 30} Td ({phrase}) Tj' for _ in range(int(repeated)))
        stream = f'BT /F1 {5 if repeated > 1 else 16} Tf 40 520 Td ({label} page. {phrase}) Tj{repeat} ET\n0.2 0.5 0.6 rg 40 100 200 250 re f'.encode()
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


def image_pdf_fixture():
    """One actual raster-only page, self-authored pixels and no text operators."""
    pixels = b'\xff\x00\x00\x00\xff\x00\x00\x00\xff\xff\xff\x00'
    commands = b'q 400 0 0 600 0 0 cm /Im0 Do Q'
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
        b'<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 12 >>\nstream\n' + pixels + b'\nendstream',
        b'<< /Length ' + str(len(commands)).encode() + b' >>\nstream\n' + commands + b'\nendstream']
    data, offsets = bytearray(b'%PDF-1.4\n'), [0]
    for index, item in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f'{index} 0 obj\n'.encode() + item + b'\nendobj\n')
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
                             (dict(kind='figure', quote=''), True), (dict(kind='unknown'), False),
                             (dict(fileDigest='0' * 64), False), (dict(rects=None), False),
                             (dict(kind='figure', rects=base['rects'] * 2), False)):
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

    def test_exact_windows_and_shared_selection_identity(self):
        from dataclasses import replace
        from paper_agent.context_file import ContextSelection, ContextFile
        from paper_agent.model import digest
        files, data = PdfFiles(), pdf_fixture(repeated=True)
        paper = PaperSnapshot.from_reading(dict(title='Repeated fixture', sourceId='anchor-fixture',
                    url='https://example.invalid/paper', contentKind='full-text', content='Fixture.'), NOW)
        doc = files.inspect(paper, data, NOW)
        quote = 'Exact original evidence.'
        for page in doc.pages:
            first, last = page.text.index(quote), page.text.rindex(quote)
            anchors = [files.locate_anchor(data, doc, dict(fileDigest=doc.file_digest, page=page.number,
                        start=start, end=start + len(quote))) for start in (first, last)]
            self.assertNotEqual(anchors[0]['id'], anchors[1]['id'])
            self.assertLess(anchors[0]['rects'][0]['y'], anchors[1]['rects'][0]['y'])
            selected = dict(documentId=doc.id, fileDigest=doc.file_digest, page=page.number,
                            rects=anchors[1]['rects'], quote=quote, kind='highlight')
            annotation = PdfAnnotation.create(selected, doc, NOW)
            edited = PdfAnnotation.create(dict(selected, note='A different note'), doc, NOW)
            self.assertNotEqual(annotation.id, edited.id)
            self.assertEqual(annotation.anchor.to_dict()['id'], edited.anchor.to_dict()['id'])
            self.assertEqual(annotation.anchor.to_dict()['id'], anchors[1]['id'])
            with tempfile.TemporaryDirectory() as root:
                store = ResearchStore(root)
                store.save_paper(paper); store.save_pdf(doc, data)
                context = store.save_context(ContextSelection.parse(dict(selected, paperId=paper.id, content=quote)))
                reopened = ResearchStore(root).stored_context(context.id)
                self.assertEqual(reopened.anchor, annotation.anchor)
                self.assertEqual(reopened.anchor.to_dict()['id'], anchors[1]['id'])
                for change in (dict(fileDigest='0' * 64), dict(content='Absent words')):
                    with self.subTest(change=change), self.assertRaises(Invalid):
                        store.save_context(ContextSelection.parse({**selected, 'paperId': paper.id, 'content': quote, **change}))
                page_context = store.save_context(ContextSelection.parse(dict(documentId=doc.id, fileDigest=doc.file_digest, page=page.number, paperId=paper.id, content=page.text)))
                self.assertEqual(page_context.anchor.to_dict()['verification'], 'page-only')
                with self.assertRaises(Invalid):
                    ContextSelection.parse(dict(selected, paperId=paper.id, content=quote, rects=[]))
                legacy = context.to_dict(); legacy.pop('anchor')
                self.assertIsNone(ContextFile.from_record(legacy).anchor)
            legacy = annotation.to_dict(); legacy.pop('anchor')
            self.assertIsNone(PdfAnnotation.from_record(legacy).anchor)
        for change in (dict(start=True), dict(start=-1), dict(end=999999), dict(fileDigest='0' * 64)):
            with self.subTest(change=change), self.assertRaises(Invalid):
                files.locate_anchor(data, doc, {'fileDigest': doc.file_digest, 'page': 1, 'start': 0, 'end': 5, **change})
        with self.assertRaises(Invalid):
            files.locate_anchor(data + b'changed', doc, dict(fileDigest=doc.file_digest, page=1, start=0, end=5))

    def test_batch_windows_share_one_original_and_pdfium_session(self):
        from unittest.mock import patch
        import pypdfium2 as pdfium
        from paper_agent.model import digest
        data, files = pdf_fixture(repeated=3, phrase='banana banana'), PdfFiles()
        doc = PdfDocument.create('a' * 64, digest(data), '', files.pages(data), NOW)
        for page in doc.pages:
            starts = [i for i in range(len(page.text)) if page.text.startswith('ana', i)]
            windows = [(i, i + 3) for i in starts]
            # Leading whitespace and multiline windows must locate the entire
            # saved range, even when PDFium phrase search returns a partial hit.
            windows += [(page.text.index(' '), len(page.text)), (0, len(page.text)),
                        (page.text.index('\r\n') + 2, len(page.text))]
            with patch('paper_agent.pdf_files.digest', wraps=digest) as hashed, \
                 patch.object(pdfium, 'PdfDocument', wraps=pdfium.PdfDocument) as opened:
                anchors = files.locate_anchors(data, doc, doc.file_digest, page.number, windows)
                self.assertEqual(hashed.call_count, 1)
                self.assertEqual(opened.call_count, 1)
            self.assertEqual(len(anchors), len(windows))
            self.assertEqual(len({a['id'] for a in anchors}), len(windows))
            self.assertEqual([a['start'] for a in anchors[:len(starts)]], starts)
            for (start, end), anchor in zip(windows, anchors):
                self.assertEqual(anchor, files.locate_anchor(data, doc, dict(fileDigest=doc.file_digest,
                    page=page.number, start=start, end=end)))
            for original, checksum, scope in ((data, '0' * 64, windows), (data + b'changed', doc.file_digest, windows),
                                              (data, doc.file_digest, [(True, 3)]), (data, doc.file_digest, [(0, len(page.text) + 1)])):
                with self.subTest(checksum=checksum, scope=scope), self.assertRaises(Invalid):
                    files.locate_anchors(original, doc, checksum, page.number, scope)

    def test_pdfium_files_and_persistent_annotations(self):
        from PIL import Image
        paper = PaperSnapshot.from_reading(dict(title='Synthetic PDF', sourceId='1706.03762',
                    url='https://arxiv.org/abs/1706.03762', pdfUrl='https://arxiv.org/pdf/1706.03762',
                    contentKind='full-text', content='Exact original evidence.'), NOW)
        content = pdf_fixture()
        files = PdfFiles()
        doc = files.inspect(paper, content, NOW)
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
