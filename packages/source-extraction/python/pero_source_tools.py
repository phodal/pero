"""Shared local PDFium/OCR primitives, owned once by Paper and Notebook.

No setup, model downloads, credentials or network requests occur here.
"""
from dataclasses import dataclass
import csv
import io
import math
import shutil
import subprocess
import threading

PDFIUM_LOCK = threading.Lock()


def pdf_engine():
    import pypdfium2
    import PIL.Image
    return pypdfium2


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


def run_ocr(image_bytes, dpi):
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
