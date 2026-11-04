"""Local, review-only observations from one fixed PDF region.

Native text is evidence in its own right, never overwritten by OCR. OCR scores
are engine outputs, not calibrated probabilities or scientific confidence.
"""
from contextlib import closing
from dataclasses import dataclass
import csv
import io
import math
import re
import shutil
import subprocess

from .model import Invalid, digest
from .pdf import PdfAnchor, PdfDocument
from .pdf_files import PDFIUM_LOCK, PdfFiles


@dataclass(frozen=True)
class NumericObservation:
    raw: str
    source: str
    start: int
    end: int

    def to_dict(self):
        return dict(raw=self.raw, source=self.source, start=self.start, end=self.end,
                    status='proposed', semantics=None,
                    confidence=dict(level='unknown', reasons=['unreviewed_numeric_token'],
                                    meaning='evidence_quality_not_probability'))


def numeric_observations(text, source):
    """Propose only isolated supported literals, never fragments of other notation.

    Unsupported punctuation, powers and separated signs/decimals stay in the raw
    source for manual review. In particular, decimal/grouping conventions must
    not turn a substring into an apparently exact observed measurement.
    """
    pattern = r'(?<![\w.])[+−-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+−-]?\d+)?%?(?!\w|\.\d)'
    unsupported = set(",，٫٬'’_ ^*/×·±∓–—‐‑‒―﹣－⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾₀₁₂₃₄₅₆₇₈₉₊₋")
    observations = []
    for match in re.finditer(pattern, text):
        before, after = text[:match.start()], text[match.end():]
        left, right = before.rstrip(), after.lstrip()
        # Include adjacent punctuation across spaces: "10 ^ -3", "− 1.2",
        # "0 . 2", and "1 , 000" must not shed their notation.
        if left and (left[-1] in unsupported or left[-1] in '+−-.'):
            continue
        if right and (right[0] in unsupported or right[0] in '+−-'):
            continue
        if match.group().startswith('.') and left and left[-1].isdigit():
            continue
        if re.search(r'\d\s*[eE]\s*$', before) or re.match(r'[eE]\s*[+−-]?\s*\d', right):
            continue
        if re.search(r'(?:\^|\*\*)\s*[({]\s*$', before):
            continue
        if re.search(r'(?:×|\*)\s*10\s*$', before):
            continue
        if right.startswith('.') and re.match(r'\.\s*\d', right):
            continue
        # Common space-grouped integers are ambiguous with table columns; do
        # not guess. Narrow/no-break spaces are grouping marks as well.
        if re.search(r'\d[\u00a0\u202f\u2009]+$', before) or re.match(r'[\u00a0\u202f\u2009]+\d', after):
            continue
        if re.fullmatch(r'[+−-]?\d+', match.group()) and re.match(r'[ \t]+\d{3}(?!\d)', after):
            continue
        if re.match(r'\d{3}(?!\d)', match.group()) and re.search(r'\d[ \t]+$', before):
            continue
        observations.append(NumericObservation(match.group(), source, match.start(), match.end()))
    return tuple(observations)


def classify_region(native_text, image_fraction):
    """Conservative regional heuristic; tiny footer/page-number text is not prose."""
    substantive = len(re.sub(r'\W', '', native_text)) >= 12
    if image_fraction >= 0.05:
        return 'mixed' if substantive else 'image_based'
    return 'native' if substantive else 'uncertain'


@dataclass(frozen=True)
class OcrBox:
    text: str
    left: int
    top: int
    width: int
    height: int
    raw_score: float
    block: int
    paragraph: int
    line: int

    def to_dict(self):
        return dict(text=self.text, left=self.left, top=self.top, width=self.width,
                    height=self.height, rawScore=self.raw_score, block=self.block,
                    paragraph=self.paragraph, line=self.line)


def parse_tsv(tsv):
    boxes = []
    rows = csv.DictReader(io.StringIO(tsv), delimiter='\t', quoting=csv.QUOTE_NONE)
    required = {'level', 'text', 'conf', 'left', 'top', 'width', 'height', 'block_num', 'par_num', 'line_num'}
    if not required.issubset(rows.fieldnames or ()):
        raise ValueError('Tesseract returned an invalid TSV header')
    for row in rows:
        if row['level'] == '5' and row['text'].strip():
            score = float(row['conf'])
            if not math.isfinite(score):
                raise ValueError('Non-finite OCR score')
            boxes.append(OcrBox(row['text'], int(row['left']), int(row['top']),
                int(row['width']), int(row['height']), score,
                int(row['block_num']), int(row['par_num']), int(row['line_num'])))
    lines, previous = [], None
    for box in boxes:
        key = (box.block, box.paragraph, box.line)
        if key != previous:
            lines.append(box.text)
        else:
            lines[-1] += ' ' + box.text
        previous = key
    return '\n'.join(lines), tuple(boxes)


@dataclass(frozen=True)
class OcrResult:
    status: str
    text: str = ''
    boxes: tuple[OcrBox, ...] = ()
    raw_tsv: str = ''
    version: str | None = None
    error: str | None = None

    def to_dict(self):
        return dict(status=self.status, text=self.text, boxes=[b.to_dict() for b in self.boxes],
                    rawTsv=self.raw_tsv, engine='tesseract', version=self.version,
                    language='eng', pageSegmentationMode=6, error=self.error,
                    scoreMeaning='Raw Tesseract confidence; not a calibrated probability',
                    coordinateSpace='region-image-pixels-top-left')


@dataclass(frozen=True)
class NumericExtraction:
    anchor: PdfAnchor
    classification: str
    native_page_text: str
    native_region_text: str
    image_fraction: float
    dpi: float
    image_width: int
    image_height: int
    image_bytes: bytes
    ocr: OcrResult
    observations: tuple[NumericObservation, ...]

    def to_dict(self):
        return dict(anchor=self.anchor.to_dict(), classification=self.classification,
            classificationMethod='regional-native-text-and-image-overlap-v1',
            status='needs-review', nativePageText=self.native_page_text,
            nativeRegionText=self.native_region_text, imageFraction=self.image_fraction,
            image=dict(digest=digest(self.image_bytes), mimeType='image/png',
                       width=self.image_width, height=self.image_height, dpi=self.dpi,
                       dpiBasis='72 PDF canvas units per inch'),
            ocr=self.ocr.to_dict(), observations=[o.to_dict() for o in self.observations],
            limitations=['Numeric tokens are proposed observations, not admitted measurements.',
                        'Region classification is heuristic; review against the original.',
                        'OCR uses English with a single text block; formulas and tables may be misread.'])


class NumericExtractor:
    def extract(self, data: bytes, document: PdfDocument, anchor: PdfAnchor):
        anchor.check(document)
        if digest(data) != document.file_digest:
            raise Invalid('Anchor PDF version does not match the saved original', 409)
        if len(anchor.rects) != 1:
            raise Invalid('Select exactly one PDF region for numeric extraction')
        rect = anchor.rects[0]
        pdfium = PdfFiles._engine()
        with PDFIUM_LOCK, closing(pdfium.PdfDocument(data)) as pdf, closing(pdf[anchor.page - 1]) as page:
            page.set_rotation(0)
            width, height = page.get_size()
            left, right = rect.x * width, (rect.x + rect.width) * width
            bottom, top = (1 - rect.y - rect.height) * height, (1 - rect.y) * height
            with closing(page.get_textpage()) as textpage:
                native_page = textpage.get_text_range()
                if native_page != document.page(anchor.page).text:
                    raise Invalid('Saved PDF text differs from current extraction; reopen the original PDF', 409)
                native_region = textpage.get_text_bounded(left, bottom, right, top)
            area, image_area = (right - left) * (top - bottom), 0
            for obj in page.get_objects(filter=[pdfium.raw.FPDF_PAGEOBJ_IMAGE]):
                x0, y0, x1, y1 = obj.get_bounds()
                image_area += max(0, min(right, x1) - max(left, x0)) * max(0, min(top, y1) - max(bottom, y0))
            image_fraction = min(1.0, image_area / area)
            classification = classify_region(native_region, image_fraction)
            # Render the crop directly. Bound dimensions AND area before allocation;
            # the full page is never materialized as a high-resolution bitmap.
            scale = min(300 / 72, 5998 / max(right - left, top - bottom),
                        math.sqrt(11_990_000 / area))
            with closing(page.render(scale=scale, crop=(left, bottom, width - right, height - top),
                                     grayscale=True, limit_image_cache=True)) as bitmap:
                with bitmap.to_pil() as image:
                    image_width, image_height = image.size
                    output = io.BytesIO()
                    image.save(output, format='PNG')
                    image_bytes = output.getvalue()
        ocr = OcrResult('not-run') if classification == 'native' else self._ocr(image_bytes, scale * 72)
        observations = numeric_observations(native_region, 'native') + numeric_observations(ocr.text, 'ocr')
        return NumericExtraction(anchor, classification, native_page, native_region, image_fraction,
                                 scale * 72, image_width, image_height, image_bytes, ocr, observations)

    @staticmethod
    def _ocr(image_bytes, dpi):
        executable = shutil.which('tesseract')
        if executable is None:
            return OcrResult('unavailable', error='Tesseract is not installed; review the original region.')
        version = None
        raw_tsv = ''
        try:
            result = subprocess.run([executable, '--version'], capture_output=True, timeout=10, check=True)
            version = result.stdout.decode('utf-8', errors='replace').splitlines()[0]
            result = subprocess.run([executable, 'stdin', 'stdout', '-l', 'eng', '--psm', '6',
                                     '--dpi', str(max(1, round(dpi))), 'tsv'],
                                    input=image_bytes, capture_output=True, timeout=60, check=True)
            raw_tsv = result.stdout.decode('utf-8', errors='replace')
            text, boxes = parse_tsv(raw_tsv)
            return OcrResult('completed' if boxes else 'empty', text, boxes, raw_tsv, version)
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, IndexError) as error:
            detail = error.stderr.decode('utf-8', errors='replace')[:2000] if isinstance(error, subprocess.CalledProcessError) and error.stderr else str(error)
            return OcrResult('failed', raw_tsv=raw_tsv, version=version, error=detail)
