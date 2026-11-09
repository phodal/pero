"""User-triggered local file reading. Host's declared App environment owns dependencies."""
from contextlib import closing
from importlib.metadata import PackageNotFoundError, version
import io
import zipfile

from pero_source_tools import PDFIUM_LOCK, pdf_engine, run_ocr
from source_extraction import ExtractionRequest, SourceExtraction, PDF, IMAGES, OFFICE


class ParserUnavailable(ValueError):
    pass


def dependency(package):
    try:
        return version(package)
    except PackageNotFoundError as error:
        raise ParserUnavailable(f'{package} is unavailable. Prepare or repair Notebook dependencies in Host, then retry. No package is installed by extraction.') from error


def extract_source(request):
    """No file paths, executables, model locations or network targets enter from HTTP."""
    file = request.file
    if file.mime == PDF:
        installed = dependency('pypdfium2')
        dependency('Pillow')
        engine = pdf_engine()
        try:
            with PDFIUM_LOCK, closing(engine.PdfDocument(file.raw)) as pdf:
                if not 1 <= len(pdf) <= 500 or request.page > len(pdf):
                    raise ValueError('Choose an existing page in a PDF with at most 500 pages')
                with closing(pdf[request.page - 1]) as page:
                    page.set_rotation(0)  # Same intrinsic-rotation-normalized space as Paper.
                    if request.mode == 'native':
                        with closing(page.get_textpage()) as textpage:
                            text = textpage.get_text_range()
                        return SourceExtraction.create(request, 'pdfium/pypdfium2', installed,
                            [(text, request.page, f'page/{request.page}', None, None)],
                            ['PDF selectable text only; image content is not read. Reading order and glyph mapping may differ from the visual page.',
                             'Page provenance is retained; exact quote rectangles are not inferred. No scientific acceptance is implied.'])
                    scale = min(3, 6000 / max(page.get_size()), (12_000_000 / (page.get_width() * page.get_height())) ** .5)
                    with closing(page.render(scale=scale, grayscale=True)) as bitmap, bitmap.to_pil() as image:
                        return extract_image(request, image, request.page, installed, scale * 72)
        except engine.PdfiumError as error:
            raise ValueError('Cannot read this PDF. It may be encrypted or damaged.') from error
    if file.mime in IMAGES:
        dependency('Pillow')
        from PIL import Image, UnidentifiedImageError
        try:
            with Image.open(io.BytesIO(file.raw)) as image:
                if image.width * image.height > 12_000_000 or max(image.size) > 6000 or getattr(image, 'n_frames', 1) != 1:
                    raise ValueError('OCR requires one still image, at most 6000 pixels per edge and 12 megapixels. Crop or resize explicitly.')
                image.load()
                return extract_image(request, image, None, None, 300)
        except (UnidentifiedImageError, Image.DecompressionBombError) as error:
            raise ValueError('Unreadable or oversized source image') from error
    return extract_office(request)


def extract_image(request, image, page, pdf_version, dpi):
    output = io.BytesIO()
    image.save(output, format='PNG')
    result = run_ocr(output.getvalue(), dpi)
    if result.status == 'unavailable':
        raise ParserUnavailable('Tesseract OCR is unavailable. Install Tesseract and English (eng) language data using your system package manager, then retry. Extraction never installs or downloads them.')
    if result.status == 'failed':
        raise ValueError('OCR failed. Check that Tesseract English language data is installed. ' + (result.error or ''))
    parts = [(box.text, page, f'page/{page}' if page else 'image',
              dict(x=box.left / image.width, y=box.top / image.height,
                   width=box.width / image.width, height=box.height / image.height), box.raw_score) for box in result.boxes]
    return SourceExtraction.create(request, 'tesseract', result.version or 'unknown', parts,
        ['OCR is unverified English recognition, not a transcription guarantee. Review every selected quote against the original.',
         'Raw OCR scores are engine outputs, not calibrated probabilities. Tables, handwriting, symbols and reading order may be wrong.',
         'Regions use normalized top-left coordinates on the source image or intrinsic-rotation-normalized PDF page.',
         f'PDF rasterizer: pypdfium2 {pdf_version}.' if pdf_version else 'Image orientation is stored-pixel orientation; EXIF rotation is not applied.'])


def extract_office(request):
    """Read OOXML stored text only. Do not execute formulas, macros or external relationships."""
    kind = OFFICE[request.file.mime]
    package = {'docx': 'python-docx', 'xlsx': 'openpyxl', 'pptx': 'python-pptx'}[kind]
    installed = dependency(package)
    from lxml.etree import XMLSyntaxError
    from docx.opc.exceptions import PackageNotFoundError as DocxPackageError
    from pptx.exc import PackageNotFoundError as PptxPackageError
    from openpyxl.utils.exceptions import InvalidFileException
    try:
        with zipfile.ZipFile(io.BytesIO(request.file.raw)) as archive:
            members = archive.infolist()
            if len(members) > 4096 or sum(member.file_size for member in members) > 32 * 1024 * 1024:
                raise ValueError('Office package exceeds 4096 parts or 32 MiB expanded. Choose a smaller document.')
        parts = []
        if kind == 'docx':
            from docx import Document
            from docx.oxml.ns import qn
            from docx.table import _Cell
            document = Document(io.BytesIO(request.file.raw))
            for index, paragraph in enumerate(document.paragraphs):
                parts.append((paragraph.text, None, f'word/document.xml/paragraph/{index + 1}', None, None))
            for table_index, table in enumerate(document.tables):
                # row.cells expands untrusted gridSpan values into repeated cells.
                # Physical OOXML cells preserve source text once without allocating
                # a logical grid or resolving vertical-merge aliases.
                for row_index, row in enumerate(table._tbl.iterchildren(qn('w:tr'))):
                    for cell_index, cell in enumerate(row.iterchildren(qn('w:tc'))):
                        if len(parts) >= 4096:
                            raise ValueError('Office extraction exceeds 4096 text parts. Choose a smaller document.')
                        parts.append((_Cell(cell, table).text, None, f'word/document.xml/table/{table_index + 1}/row/{row_index + 1}/cell/{cell_index + 1}', None, None))
        elif kind == 'xlsx':
            from openpyxl import load_workbook
            from openpyxl.worksheet.formula import ArrayFormula, DataTableFormula
            workbook = load_workbook(io.BytesIO(request.file.raw), read_only=True, data_only=False, keep_links=False)
            try:
                cells, rows = 0, 0
                for sheet in workbook:
                    if sheet.max_row and sheet.max_column and sheet.max_row * sheet.max_column > 100_000:
                        raise ValueError('Worksheet declared range exceeds 100,000 cells. Choose a smaller workbook.')
                    for row in sheet:
                        # Missing OOXML dimensions can make openpyxl yield empty
                        # rows for a distant stored cell; those must count too.
                        rows += 1
                        if rows > 100_000:
                            raise ValueError('Workbook exceeds 100,000 visited rows. Choose a smaller workbook.')
                        for cell in row:
                            cells += 1
                            if cells > 100_000:
                                raise ValueError('Workbook exceeds 100,000 cells. Choose a smaller workbook.')
                            value = cell.value
                            if isinstance(value, DataTableFormula):
                                raise ValueError(f'Excel what-if data-table formula at {sheet.title}!{cell.coordinate} has no standalone formula text. Export the required cells as values or replace the data table with explicit formulas.')
                            if isinstance(value, ArrayFormula):
                                value = value.text
                                if not isinstance(value, str) or not value.startswith('=') or len(value) < 2:
                                    raise ValueError(f'Array formula at {sheet.title}!{cell.coordinate} has no readable formula text. Repair the workbook or export the required cells as values.')
                            if value is not None:
                                parts.append((str(value), None, f'{sheet.title}!{cell.coordinate}', None, None))
            finally:
                workbook.close()
        else:
            from pptx import Presentation
            presentation = Presentation(io.BytesIO(request.file.raw))
            if len(presentation.slides) > 500:
                raise ValueError('Presentation exceeds 500 slides')
            for index, slide in enumerate(presentation.slides):
                for shape in slide.shapes:
                    if shape.has_text_frame:
                        parts.append((shape.text.replace('\v', '\n'), index + 1, f'ppt/slides/slide{index + 1}.xml/shape/{shape.shape_id}', None, None))
                    if shape.has_table:
                        for row_index, row in enumerate(shape.table.rows):
                            for column_index, cell in enumerate(row.cells):
                                parts.append((cell.text, index + 1, f'slide/{index + 1}/shape/{shape.shape_id}/cell/{row_index + 1},{column_index + 1}', None, None))
        return SourceExtraction.create(request, package, installed, parts,
            ['Stored OOXML text only. Embedded images, charts, comments, tracked changes, headers, footers, notes and grouped shapes are not transcribed.',
             'Office part/cell/slide locations are retained; no Word pagination or rendered text regions are inferred. PowerPoint soft breaks become newlines.',
             'Spreadsheet formulas, including array-formula expressions at their anchor cells, are source text and never evaluated. DOCX table locations count physical XML cells, not expanded merged cells. Text order is parser traversal, not guaranteed visual reading order.'])
    except (zipfile.BadZipFile, KeyError, XMLSyntaxError, DocxPackageError, PptxPackageError, InvalidFileException) as error:
        raise ValueError('Unreadable or incomplete Office package') from error


def source_extraction_route(method, path, body):
    if method != 'POST' or path != '/api/source-extraction':
        return None
    from source_parser_process import run_source_parser, ParserProcessError
    try:
        return 200, run_source_parser(ExtractionRequest.parse(body()))
    except ParserProcessError as error:
        return (503 if error.unavailable else 422), dict(code='parser-unavailable' if error.unavailable else 'parser-failed', error=str(error), detail=str(error))
    except (ParserUnavailable, ImportError) as error:
        detail = str(error) if isinstance(error, ParserUnavailable) else f'Notebook parser dependency unavailable: {error}. Repair Notebook dependencies in Host and retry.'
        return 503, dict(code='parser-unavailable', error=detail, detail=detail)
