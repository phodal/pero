"""Parser process containment, including a real compressed native PDF expansion."""
from pathlib import Path
from unittest.mock import patch
import io
import os
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from source_extraction import ExtractionRequest, OFFICE
from source_parser_process import run_source_parser, ParserProcessError, MAX_OUTPUT_BYTES
from source_parsers import source_extraction_route
from test_source_extraction import request, pdf_bytes


class SourceParserProcessTests(unittest.TestCase):
    def test_native_pdf_and_office_use_real_worker_with_reviewable_limits(self):
        from docx import Document
        from openpyxl import Workbook
        from openpyxl.worksheet.formula import ArrayFormula
        from pptx import Presentation
        from pptx.util import Inches
        inputs = [request(pdf_bytes(), 'application/pdf', 'source.pdf')]
        document = Document(); document.add_paragraph('Sample 42 mg')
        workbook = Workbook(); workbook.active['A1'] = ArrayFormula(ref='A1', text='=1+2')
        presentation = Presentation(); slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        slide.shapes.add_textbox(Inches(1), Inches(1), Inches(3), Inches(1)).text = 'Sample 42 mg'
        for kind, value in [('docx', document), ('xlsx', workbook), ('pptx', presentation)]:
            output = io.BytesIO(); value.save(output)
            inputs.append(request(output.getvalue(), next(mime for mime, extension in OFFICE.items() if extension == kind), 'source.' + kind))
        for value in inputs:
            with self.subTest(filename=value['file']['filename']):
                status, result = source_extraction_route('POST', '/api/source-extraction', lambda: value)
                self.assertEqual(status, 200, result)
                self.assertEqual(result['text'], '=1+2' if value['file']['filename'].endswith('xlsx') else 'Sample 42 mg')
                limitation = result['extraction']['limitations'][-1]
                self.assertIn('512 MiB virtual-address limit' if sys.platform.startswith('linux') else 'no enforced parser memory cap', limitation)
        status, response = source_extraction_route('POST', '/api/source-extraction', lambda: request(b'broken PDF', 'application/pdf', 'broken.pdf'))
        self.assertEqual(status, 422)
        self.assertEqual(response['code'], 'parser-failed')

    @unittest.skipUnless(sys.platform.startswith('linux'), 'Linux virtual-address limit')
    def test_native_decompression_failure_is_contained_and_next_parse_succeeds(self):
        # Original compressed PDF stays below the normal 512 KiB attachment cap.
        # Stream it during fixture creation, never allocate 200 MiB in this parent.
        value = ExtractionRequest.parse(request(pdf_bytes(expanded_mib=200), 'application/pdf', 'compressed.pdf'))
        with self.assertRaisesRegex(ParserProcessError, 'memory budget'):
            run_source_parser(value, memory_bytes=256 * 1024 * 1024)
        self.assertEqual(run_source_parser(ExtractionRequest.parse(request(pdf_bytes(), 'application/pdf', 'ordinary.pdf')))['text'], 'Sample 42 mg')

    @unittest.skipUnless(os.name == 'posix', 'POSIX parser process cleanup')
    def test_timeout_and_oversized_result_clean_processes_and_temporary_files(self):
        # Only the process seam is substituted. These real child processes either
        # wait for a signal or write oversized output; neither fabricates parsing.
        original_popen = subprocess.Popen
        processes, directories = [], []
        for mode in ('wait', 'large-output'):
            def start(command, **kwargs):
                directories.append(Path(command[-2]).parent)
                code = ('import signal; signal.pause()' if mode == 'wait' else
                        f'from pathlib import Path; Path({command[-2]!r}).write_bytes(b"x" * {MAX_OUTPUT_BYTES + 1})')
                process = original_popen([sys.executable, '-I', '-B', '-c', code], **kwargs)
                processes.append(process)
                return process
            with self.subTest(mode=mode), patch('source_parser_process.subprocess.Popen', side_effect=start):
                with self.assertRaisesRegex(ParserProcessError, 'time limit' if mode == 'wait' else 'result budget'):
                    run_source_parser(ExtractionRequest.parse(request(pdf_bytes(), 'application/pdf', 'source.pdf')), timeout=.1 if mode == 'wait' else 5)
            self.assertIsNotNone(processes[-1].poll())
            self.assertFalse(directories[-1].exists())

    @unittest.skipUnless(os.environ.get('NOTEBOOK_REAL_OCR') == '1', 'opt-in real local Tesseract')
    def test_real_ocr_works_inside_limited_parser_process(self):
        from PIL import Image, ImageDraw, ImageFont
        with Image.new('RGB', (1000, 200), 'white') as image:
            ImageDraw.Draw(image).text((40, 60), 'SAMPLE 42 mg', font=ImageFont.load_default(size=60), fill='black')
            for kind, mime in [('PNG', 'image/png'), ('PDF', 'application/pdf')]:
                output = io.BytesIO(); image.save(output, format=kind)
                result = run_source_parser(ExtractionRequest.parse(request(output.getvalue(), mime, 'scan.' + kind.lower(), 'ocr')))
                self.assertIn('42', result['text'])
                self.assertEqual(result['extraction']['method'], 'ocr')
