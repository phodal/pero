"""Synthetic local evidence, never a substitute for real-paper acceptance."""
import os
from pathlib import Path
import shutil
import sys
import subprocess
import unittest
from unittest.mock import patch
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.model import Invalid, digest
from paper_agent.numeric_extraction import NumericExtractor, classify_region, numeric_observations, parse_tsv
from paper_agent.pdf import PdfAnchor, PdfDocument, PdfRect
from paper_agent.pdf_files import PdfFiles
from test_pdf import pdf_fixture


def scan_fixture(footer=''):
    from PIL import Image, ImageDraw, ImageFont
    image = Image.new('RGB', (1200, 800), 'white')
    draw = ImageDraw.Draw(image)
    draw.text((80, 120), 'Value 12.50', fill='black', font=ImageFont.load_default(size=65))
    pixels = zlib.compress(image.tobytes())
    image.close()
    commands = b'q 400 0 0 266 0 34 cm /Im0 Do Q\n' + f'BT /F1 12 Tf 20 10 Td ({footer}) Tj ET'.encode()
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 6 0 R >> >> /Contents 5 0 R >>',
        b'<< /Type /XObject /Subtype /Image /Width 1200 /Height 800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ' + str(len(pixels)).encode() + b' >>\nstream\n' + pixels + b'\nendstream',
        b'<< /Length ' + str(len(commands)).encode() + b' >>\nstream\n' + commands + b'\nendstream',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
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


def extract(data, rect=PdfRect(0, 0, 1, 1)):
    doc = PdfDocument.create('a' * 64, digest(data), 'local', PdfFiles().pages(data), 'now')
    anchor = PdfAnchor(doc.id, doc.file_digest, 1, (rect,))
    return NumericExtractor().extract(data, doc, anchor)


class NumericExtractionTests(unittest.TestCase):
    def test_regional_classification(self):
        for text, fraction, expected in [('', 0.8, 'image_based'), ('1', 0.8, 'image_based'),
                ('12.5', 0, 'uncertain'), ('Native table values 12.5', 0, 'native'),
                ('Native table values 12.5', 0.4, 'mixed'), ('', 0, 'uncertain')]:
            with self.subTest(text=text, fraction=fraction):
                self.assertEqual(classify_region(text, fraction), expected)

    def test_candidates_are_raw_review_only(self):
        items = numeric_observations('x=−1.2e-3; 18% Model9. Value 12.50.', 'native')
        self.assertEqual([item.raw for item in items], ['−1.2e-3', '18%', '12.50'])
        self.assertTrue(all(item.to_dict()['status'] == 'proposed' and item.to_dict()['semantics'] is None for item in items))

    def test_unsupported_notation_never_admits_numeric_fragments(self):
        for raw in ('–1.2', '—1.2', '‐1.2', '‑1.2', '±3', '10**(-3)', '1 × 10 -3', '0,2', '1,000', '1 000', '1 000.2', '1 000e3', '1.2 e -3', '1.2e -3', '1\u202f000', "1'000", '10^-3',
                    '10 ** -3', '10^{-3}', '10^(-3)', '−\n1.2', '10⁻³', '10³', '2 × 10^-3', '− 1.2', '- 1.2',
                    '+ .2', '0 . 2', '0. 2', '0 .2', '1/2', '1 , 000'):
            with self.subTest(raw=raw):
                self.assertEqual(numeric_observations(raw, 'native'), ())
                self.assertEqual(numeric_observations(raw, 'ocr'), ())
        for raw in ('.2', '-.4', '1e-3', '−1.2', '12.50', '18%'):
            with self.subTest(raw=raw):
                self.assertEqual([o.raw for o in numeric_observations(raw, 'native')], [raw])

    def test_raw_tsv_score_and_coordinates(self):
        tsv = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t3\t4\t50\t20\t83.125\t12.5\n'
        text, boxes = parse_tsv(tsv)
        self.assertEqual(text, '12.5')
        self.assertEqual((boxes[0].left, boxes[0].top, boxes[0].raw_score), (3, 4, 83.125))

    def test_native_evidence_is_not_replaced(self):
        result = extract(pdf_fixture(phrase='Measured value 12.50.'))
        self.assertEqual(result.classification, 'native')
        self.assertEqual(result.ocr.status, 'not-run')
        self.assertIn('12.50', result.native_page_text)
        self.assertEqual(result.to_dict()['status'], 'needs-review')
        self.assertEqual(result.to_dict()['image']['digest'], digest(result.image_bytes))
        self.assertLessEqual(result.image_width * result.image_height, 12_000_000)

    def test_scan_footer_does_not_force_native_and_missing_ocr_is_explicit(self):
        with patch('paper_agent.numeric_extraction.shutil.which', return_value=None):
            result = extract(scan_fixture('1'), PdfRect(0, 0, 1, 0.85))
        self.assertEqual(result.classification, 'image_based')
        self.assertEqual(result.native_page_text, '1')
        self.assertEqual(result.native_region_text, '')
        self.assertEqual(result.ocr.status, 'unavailable')
        self.assertEqual(result.ocr.text, '')
        self.assertFalse(result.observations)

    def test_mixed_preserves_native_even_without_ocr(self):
        with patch('paper_agent.numeric_extraction.shutil.which', return_value=None):
            result = extract(scan_fixture('Native caption value 27.5'))
        self.assertEqual(result.classification, 'mixed')
        self.assertIn('27.5', result.native_region_text)
        self.assertTrue(any(item.raw == '27.5' and item.source == 'native' for item in result.observations))

    def test_text_elsewhere_on_page_does_not_make_region_native(self):
        with patch('paper_agent.numeric_extraction.shutil.which', return_value=None):
            result = extract(pdf_fixture(), PdfRect(0, 0.5, 1, 0.5))
        self.assertEqual(result.classification, 'uncertain')
        self.assertEqual(result.native_region_text, '')
        self.assertTrue(result.native_page_text)
        self.assertAlmostEqual(result.dpi, 300)
        self.assertLessEqual(result.image_height, 1251)

    def test_ocr_failure_never_creates_candidates(self):
        with patch('paper_agent.numeric_extraction.shutil.which', return_value='/bin/tesseract'), \
             patch('paper_agent.numeric_extraction.subprocess.run', side_effect=subprocess.TimeoutExpired('tesseract', 10)):
            result = extract(scan_fixture())
        self.assertEqual(result.ocr.status, 'failed')
        self.assertFalse(result.observations)
        self.assertTrue(result.image_bytes)
        self.assertTrue(result.ocr.error)

    def test_malformed_tsv_is_not_success(self):
        with self.assertRaises(ValueError):
            parse_tsv('not an OCR result')

    def test_version_mismatch_rejected(self):
        data = pdf_fixture()
        doc = PdfDocument.create('a' * 64, 'b' * 64, 'local', PdfFiles().pages(data), 'now')
        with self.assertRaises(Invalid):
            NumericExtractor().extract(data, doc, PdfAnchor(doc.id, doc.file_digest, 1, (PdfRect(0, 0, 1, 1),)))

    @unittest.skipUnless(os.environ.get('PAPER_AGENT_REAL_OCR') == '1' and shutil.which('tesseract'), 'opt-in real local Tesseract')
    def test_real_tesseract_on_generated_scan(self):
        result = extract(scan_fixture())
        self.assertEqual(result.classification, 'image_based')
        self.assertEqual(result.ocr.status, 'completed', result.ocr.error)
        self.assertIn('12.50', result.ocr.text)
        self.assertTrue(result.ocr.version.startswith('tesseract'))
        self.assertTrue(result.ocr.raw_tsv)
        self.assertTrue(result.ocr.boxes)
        self.assertEqual(result.native_page_text, '')
        self.assertTrue(any(item.raw == '12.50' and item.source == 'ocr' for item in result.observations))


if __name__ == '__main__':
    unittest.main()
