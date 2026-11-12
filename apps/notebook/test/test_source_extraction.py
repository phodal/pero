"""Real local parsers on original, generated fixtures. No copyrighted sample corpus."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch
import base64
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
import zlib
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from source_extraction import ExtractionRequest, SourceExtraction, OFFICE
from source_parsers import extract_source, source_extraction_route
from source_excerpt import SourceExcerpt


def request(raw, mime, name, mode='native', page=1):
    return dict(file=dict(filename=name, mime=mime, data=base64.b64encode(raw).decode(), sha256=sha256(raw).hexdigest()), mode=mode, page=page)


def pdf_bytes(expanded_mib=0):
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    stream = b'BT /F1 20 Tf 20 100 Td (Sample 42 mg) Tj ET'
    filter_name = b''
    if expanded_mib:
        compressor = zlib.compressobj(); chunks = [compressor.compress(b'%')]
        for _ in range(expanded_mib):
            chunks.append(compressor.compress(b'x' * 1024 * 1024))
        chunks.extend([compressor.compress(b'\n' + stream), compressor.flush()])
        stream = b''.join(chunks); filter_name = b'/Filter /FlateDecode '
    objects.append(b'<< ' + filter_name + b'/Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream')
    result, offsets = b'%PDF-1.4\n', [0]
    for index, value in enumerate(objects, 1):
        offsets.append(len(result)); result += f'{index} 0 obj\n'.encode() + value + b'\nendobj\n'
    xref = len(result)
    result += f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode()
    result += b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:])
    return result + f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()


def extract(value):
    return extract_source(ExtractionRequest.parse(value))


class SourceExtractionTests(unittest.TestCase):
    def test_pdf_original_hash_text_hash_page_and_retained_excerpt(self):
        value = request(pdf_bytes(), 'application/pdf', 'original.pdf')
        result = extract(value)
        self.assertEqual(result['text'], 'Sample 42 mg')
        receipt = result['extraction']
        self.assertEqual(receipt['original']['sha256'], value['file']['sha256'])
        self.assertNotEqual(receipt['textSha256'], receipt['original']['sha256'])
        self.assertEqual(receipt['segments'][0]['page'], 1)
        self.assertIsNone(receipt['segments'][0]['region'])
        excerpt = dict(source=dict(blockId='source', filename='original.pdf', mime='application/pdf', sha256=value['file']['sha256']),
                       version=value['file']['sha256'], **result, start=7, end=9, quote='42')
        self.assertEqual(SourceExcerpt.parse(json.loads(json.dumps(excerpt))).wire(), excerpt)
        for change in [dict(text='Changed'), dict(extraction={**receipt, 'textSha256': '0' * 64}),
                       dict(extraction={**receipt, 'original': {**receipt['original'], 'sha256': '0' * 64}})]:
            with self.subTest(change=change.keys()), self.assertRaises(ValueError):
                SourceExcerpt.parse({**excerpt, **change})
        with self.assertRaisesRegex(ValueError, 'existing page'):
            extract({**value, 'page': 2})

    def test_real_office_parsers_preserve_unicode_parts_and_formula_text(self):
        from docx import Document
        from openpyxl import Workbook
        from pptx import Presentation
        from pptx.util import Inches
        cases = []
        document = Document(); document.add_paragraph('Sample 🧪 42 mg'); table = document.add_table(rows=1, cols=1); table.cell(0, 0).text = 'Table value'
        cases.append(('docx', document, 'Sample 🧪 42 mg', 'word/document.xml/paragraph/1'))
        workbook = Workbook(); workbook.active.title = 'Measurements'; workbook.active['A1'] = 'Sample 🧪 42 mg'; workbook.active['B1'] = '=1+2'
        cases.append(('xlsx', workbook, '=1+2', 'Measurements!B1'))
        presentation = Presentation(); slide = presentation.slides.add_slide(presentation.slide_layouts[6]); shape = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(3), Inches(1)); shape.text = 'Sample 🧪 42 mg'
        cases.append(('pptx', presentation, 'Sample 🧪 42 mg', 'ppt/slides/slide1.xml/shape/2'))
        for kind, document, text, part in cases:
            with self.subTest(kind=kind):
                output = io.BytesIO(); document.save(output)
                result = extract(request(output.getvalue(), next(mime for mime, extension in OFFICE.items() if extension == kind), 'source.' + kind))
                self.assertIn(text, result['text'])
                segment = next(item for item in result['extraction']['segments'] if item['part'] == part)
                self.assertEqual(result['text'][segment['start']:segment['end']], text)
                self.assertEqual(result['extraction']['method'], 'native')
                self.assertTrue(result['extraction']['parser']['version'])

    def test_docx_physical_cells_do_not_expand_merge_spans(self):
        from docx import Document
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
        mime = next(mime for mime, kind in OFFICE.items() if kind == 'docx')
        for span in (2, 1_000_000_000):
            with self.subTest(span=span):
                document = Document(); table = document.add_table(rows=1, cols=2)
                table.cell(0, 0).text = 'One original cell'; table.cell(0, 1).text = 'Second physical cell'
                grid = OxmlElement('w:gridSpan'); grid.set(qn('w:val'), str(span))
                table.cell(0, 0)._tc.get_or_add_tcPr().append(grid)
                output = io.BytesIO(); document.save(output)
                result = extract(request(output.getvalue(), mime, 'merged.docx'))
                self.assertEqual(result['text'], 'One original cell\nSecond physical cell')
                self.assertEqual([part['part'] for part in result['extraction']['segments']], [
                    'word/document.xml/table/1/row/1/cell/1', 'word/document.xml/table/1/row/1/cell/2'])
        # Real vertical and horizontal merges retain physical text once, rather
        # than repeating the origin text at each covered grid coordinate.
        document = Document(); table = document.add_table(rows=2, cols=2)
        table.cell(0, 0).merge(table.cell(1, 0)).text = 'Vertical value'
        table.cell(0, 1).text = 'Other value'
        output = io.BytesIO(); document.save(output)
        self.assertEqual(extract(request(output.getvalue(), mime, 'vertical.docx'))['text'], 'Vertical value\nOther value')

    def test_xlsx_array_formulas_are_stable_text_and_data_tables_are_explicit(self):
        from openpyxl import Workbook
        from openpyxl.worksheet.formula import ArrayFormula, DataTableFormula
        mime = next(mime for mime, kind in OFFICE.items() if kind == 'xlsx')
        workbook = Workbook(); sheet = workbook.active; sheet.title = 'Measurements'
        sheet['A1'] = 2; sheet['A2'] = 3
        sheet['B1'] = ArrayFormula(ref='B1', text='=SUM(A1:A2)')
        output = io.BytesIO(); workbook.save(output)
        value = request(output.getvalue(), mime, 'array.xlsx')
        first, second = extract(value), extract(value)
        self.assertEqual(first, second)
        part = next(part for part in first['extraction']['segments'] if part['part'] == 'Measurements!B1')
        self.assertEqual(first['text'][part['start']:part['end']], '=SUM(A1:A2)')
        self.assertNotIn('object at', first['text'])
        sheet['B1'] = DataTableFormula(ref='B1:B2', r1='A1')
        output = io.BytesIO(); workbook.save(output)
        with self.assertRaisesRegex(ValueError, 'data-table formula at Measurements!B1.*Export the required cells as values'):
            extract(request(output.getvalue(), mime, 'what-if.xlsx'))
        sheet['B1'] = ArrayFormula(ref='B1', text=None)
        output = io.BytesIO(); workbook.save(output)
        with self.assertRaisesRegex(ValueError, 'Array formula at Measurements!B1 has no readable formula text'):
            extract(request(output.getvalue(), mime, 'missing-array.xlsx'))

    def test_xlsx_missing_dimensions_still_bound_empty_row_gaps(self):
        from openpyxl import Workbook
        mime = next(mime for mime, kind in OFFICE.items() if kind == 'xlsx')
        workbook = Workbook(); workbook.active['A1'] = 'Distant value'
        output = io.BytesIO(); workbook.save(output)
        namespace = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
        for number, accepted in ((3, True), (100_001, False)):
            with self.subTest(row=number), zipfile.ZipFile(io.BytesIO(output.getvalue())) as source:
                changed = io.BytesIO()
                with zipfile.ZipFile(changed, 'w', zipfile.ZIP_DEFLATED) as destination:
                    for member in source.infolist():
                        raw = source.read(member)
                        if member.filename == 'xl/worksheets/sheet1.xml':
                            root = ET.fromstring(raw); root.remove(root.find(namespace + 'dimension'))
                            row = root.find(namespace + 'sheetData/' + namespace + 'row')
                            row.set('r', str(number)); row.find(namespace + 'c').set('r', f'A{number}')
                            raw = ET.tostring(root)
                        destination.writestr(member, raw)
                value = request(changed.getvalue(), mime, 'sparse.xlsx')
                if accepted:
                    result = extract(value)
                    self.assertEqual(result['text'], 'Distant value')
                    self.assertEqual(result['extraction']['segments'][0]['part'], 'Sheet!A3')
                else:
                    with self.assertRaisesRegex(ValueError, '100,000 visited rows'):
                        extract(value)

    def test_original_and_derived_receipts_survive_revision_after_attachment_removal(self):
        from document import NotebookDocument
        from store import EntryStore
        value = request(pdf_bytes(), 'application/pdf', 'source.pdf')
        result = extract(value)
        retained = dict(source=dict(blockId='original', filename='source.pdf', mime='application/pdf', sha256=value['file']['sha256']),
                        version=value['file']['sha256'], **result, start=7, end=9, quote='42')
        document = dict(schemaVersion=1, title='Extracted source', content=dict(type='doc', content=[
            dict(type='attachment', attrs=dict(blockId='original', **value['file'], caption='')),
            dict(type='sourceExcerpt', attrs=dict(blockId='quote', label='Value', excerpt=retained))]))
        with tempfile.TemporaryDirectory() as directory:
            entries = EntryStore(directory)
            entry = entries.create(NotebookDocument.parse(document))
            without_original = deepcopy(document); without_original['content']['content'].pop(0)
            entries.commit(entry.identity, 1, lambda _: NotebookDocument.parse(without_original))
            self.assertEqual(EntryStore(directory).read(entry.identity).wire()['document']['content']['content'][0]['attrs']['excerpt'], retained)
            self.assertEqual(EntryStore(directory).read(entry.identity, 1).wire()['document']['content']['content'][0]['attrs']['sha256'], value['file']['sha256'])

    def test_receipts_reject_nonfinite_regions_invalid_ranges_and_originals(self):
        result = extract(request(pdf_bytes(), 'application/pdf', 'source.pdf'))
        for field, value in [('start', -1), ('end', 999), ('page', True), ('part', ''), ('score', 98), ('region', dict(x=0, y=0, width=float('nan'), height=1))]:
            receipt = deepcopy(result['extraction']); receipt['segments'][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                SourceExtraction.parse(receipt, result['text'])
        value = request(pdf_bytes(), 'application/pdf', 'source.pdf'); value['file']['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'digest'):
            extract(value)
        with self.assertRaisesRegex(ValueError, 'PDF'):
            extract(request(b'not a PDF', 'application/pdf', 'source.pdf'))

    def test_ocr_missing_is_actionable_and_does_not_replace_native_text(self):
        with patch.dict(os.environ, {'PATH': ''}):
            value = request(pdf_bytes(), 'application/pdf', 'source.pdf', 'ocr')
            status, response = source_extraction_route('POST', '/api/source-extraction', lambda: value)
            self.assertEqual(status, 503)
            self.assertEqual(response['code'], 'parser-unavailable')
            self.assertIn('English', response['detail'])
            self.assertEqual(extract({**value, 'mode': 'native'})['text'], 'Sample 42 mg')
        self.assertIsNone(source_extraction_route('POST', '/api/unrelated', lambda: self.fail('must not read body')))

    @unittest.skipUnless(os.environ.get('NOTEBOOK_REAL_OCR') == '1', 'opt-in real local Tesseract')
    def test_real_image_and_scanned_pdf_ocr_regions_are_unverified(self):
        from PIL import Image, ImageDraw, ImageFont
        with Image.new('RGB', (1000, 200), 'white') as image:
            ImageDraw.Draw(image).text((40, 60), 'SAMPLE 42 mg', font=ImageFont.load_default(size=60), fill='black')
            for kind, mime in [('PNG', 'image/png'), ('PDF', 'application/pdf')]:
                output = io.BytesIO(); image.save(output, format=kind)
                value = request(output.getvalue(), mime, 'scan.' + kind.lower(), 'ocr')
                result = extract(value)
                self.assertIn('42', result['text'])
                receipt = result['extraction']
                self.assertEqual(receipt['method'], 'ocr')
                self.assertEqual(receipt['parser']['name'], 'tesseract')
                self.assertIn('not calibrated probabilities', ' '.join(receipt['limitations']))
                self.assertTrue(all(part['region'] is not None and part['score'] is not None for part in receipt['segments']))
                self.assertEqual(receipt['original']['sha256'], value['file']['sha256'])
