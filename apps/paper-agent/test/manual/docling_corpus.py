"""Opt-in three-original-scan layout benchmark; no downloads or installation.

Each engine/sample runs in its own process. Raw JSON and images remain outside
source control. Geometric overlap is a review aid, not semantic correctness.
"""
import argparse
from contextlib import closing
import hashlib
import json
import os
import platform
from pathlib import Path
import resource
import subprocess
import sys
import time

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[2] / 'backend'))
FIXTURES = HERE.parents[1] / 'fixtures'


def worker(args, sample):
    started = time.perf_counter()
    from paper_agent.pdf import PdfAnchor, PdfDocument, PdfRect
    from paper_agent.pdf_files import PdfFiles, PDFIUM_LOCK
    data = (args.pdf_directory / sample['fileName']).read_bytes()
    if hashlib.sha256(data).hexdigest() != sample['sha256']:
        raise ValueError('Original PDF digest mismatch: ' + sample['id'])
    files = PdfFiles()
    document = PdfDocument.create(sample['id'], sample['sha256'], sample['sourceUrl'],
                                  files.pages(data), '2026-11-04T00:00:00Z')
    prefix = args.output_directory / (sample['id'] + '-' + args.engine)
    if args.engine == 'docling':
        from paper_agent.docling_layout import DoclingLayoutConfig, convert_docling_pdf
        result = convert_docling_pdf(data, document, sample['page'], DoclingLayoutConfig(args.models))
    else:
        from paper_agent.numeric_extraction import NumericExtractor
        regional_anchor = PdfAnchor(document.id, document.file_digest, sample['page'],
                                     (PdfRect.parse(sample['region']),))
        full_anchor = PdfAnchor(document.id, document.file_digest, sample['page'],
                                (PdfRect(0, 0, 1, 1),))
        stage = time.perf_counter()
        region = NumericExtractor().extract(data, document, regional_anchor)
        regional_seconds = time.perf_counter() - stage
        stage = time.perf_counter()
        full = NumericExtractor().extract(data, document, full_anchor)
        full_page_seconds = time.perf_counter() - stage
        prefix.with_suffix('.region.png').write_bytes(region.image_bytes)
        prefix.with_suffix('.page.png').write_bytes(full.image_bytes)
        native_boxes = []
        pdfium = files._engine()
        with PDFIUM_LOCK, closing(pdfium.PdfDocument(data)) as pdf, closing(pdf[sample['page'] - 1]) as page:
            page.set_rotation(0)
            with closing(page.get_textpage()) as textpage:
                for i in range(textpage.count_chars()):
                    native_boxes.append(dict(charIndex=i, text=textpage.get_text_range(i, 1),
                                             rawBox=list(textpage.get_charbox(i))))
        result = dict(provider='PDFium plus Tesseract', sourceSha256=sample['sha256'],
                      page=sample['page'], regional=region.to_dict(), fullPage=full.to_dict(),
                      regionalSeconds=regional_seconds, fullPageSeconds=full_page_seconds,
                      nativeCharacterBoxes=native_boxes,
                      nativeBoxSpace='PDF points; left,bottom,right,top; bottom-left origin',
                      pictureCaptionRelations=[], pictureChildTextRelations=[],
                      relationStatus='not_produced_by_baseline',
                      limitations=['Baseline extracts text/boxes; no automatic figure layout or semantic associations.'])
    elapsed = time.perf_counter() - started
    # getrusage reports bytes on Darwin, KiB on Linux. Do not label Mac bytes
    # as KiB or compare their raw values as equivalent memory measurements.
    rss_divisor = 1024 if sys.platform == 'darwin' else 1
    result['benchmark'] = dict(wallSeconds=elapsed,
        peakRssKiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / rss_divisor,
        childPeakRssKiB=resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / rss_divisor,
        platform=sys.platform, architecture=platform.machine(), macosVersion=platform.mac_ver()[0] or None,
        scope='Isolated process; imports, whole-PDF page inspection, selected-page conversion, result preparation. Peak RSS includes initialization. Not simultaneous process-tree or GPU memory; child peak reported separately.',
        inputSha256=sample['sha256'], originalPdfPage=sample['page'])
    prefix.with_suffix('.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(dict(id=sample['id'], engine=args.engine, status='completed',
                          **result['benchmark'], output=str(prefix.with_suffix('.json')))))


def overlap(a, b):
    left, top = max(a[0], b[0]), max(a[1], b[1])
    right = min(a[0] + a[2], b[0] + b[2])
    bottom = min(a[1] + a[3], b[1] + b[3])
    intersection = max(0, right - left) * max(0, bottom - top)
    return intersection / (a[2] * a[3] + b[2] * b[3] - intersection)


def geometry_review(output_directory):
    guides = json.loads((FIXTURES / 'docling-corpus-layout.json').read_text())['samples']
    rows = []
    for guide in guides:
        path = output_directory / (guide['id'] + '-docling.json')
        if not path.exists():
            continue
        result = json.loads(path.read_text())
        layout = result['layout']
        pictures = []
        for picture in layout['pictures']:
            for provenance in picture['provenance']:
                anchor = provenance.get('anchor')
                if anchor and anchor['page'] == guide['page']:
                    rect = anchor['rects'][0]
                    pictures.append((picture, [rect[k] for k in ('x', 'y', 'width', 'height')]))
        figures = []
        for expected in guide['figures']:
            ranked = sorted(pictures, key=lambda item: overlap(item[1], expected['region']), reverse=True)
            best = ranked[0] if ranked else None
            figures.append(dict(label=expected['label'],
                bestPictureRef=best[0]['ref'] if best else None,
                approximateGuideIoU=overlap(best[1], expected['region']) if best else None))
        rows.append(dict(id=guide['id'], figures=figures,
                         warning='Geometry only, approximate AI visual guide. Not semantic correctness or human ground truth.'))
    (output_directory / 'geometry-review.json').write_text(json.dumps(rows, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf_directory', type=Path)
    parser.add_argument('output_directory', type=Path)
    parser.add_argument('--engines', choices=['baseline', 'docling', 'both'], default='baseline')
    parser.add_argument('--docling-python', default=sys.executable)
    parser.add_argument('--models', type=Path)
    parser.add_argument('--engine', choices=['baseline', 'docling'], help=argparse.SUPPRESS)
    parser.add_argument('--sample', help=argparse.SUPPRESS)
    args = parser.parse_args()
    args.output_directory.mkdir(parents=True, exist_ok=True)
    samples = json.loads((FIXTURES / 'numeric-corpus.json').read_text())['samples']
    if args.engine:
        worker(args, next(s for s in samples if s['id'] == args.sample))
        return
    if args.engines != 'baseline' and args.models is None:
        parser.error('--models must name already installed official model artifacts')
    engines = ['baseline', 'docling'] if args.engines == 'both' else [args.engines]
    rows = []
    for sample in samples:
        for engine in engines:
            python = args.docling_python if engine == 'docling' else sys.executable
            command = [python, str(HERE), str(args.pdf_directory), str(args.output_directory),
                       '--engine', engine, '--sample', sample['id']]
            if args.models:
                command += ['--models', str(args.models)]
            run = subprocess.run(command, capture_output=True, text=True, env={**os.environ,
                'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1', 'OMP_NUM_THREADS': '2'})
            prefix = args.output_directory / (sample['id'] + '-' + engine)
            prefix.with_suffix('.log').write_text(run.stdout + '\n' + run.stderr)
            row = json.loads(run.stdout.strip().splitlines()[-1]) if run.returncode == 0 else dict(
                id=sample['id'], engine=engine, status='failed', returncode=run.returncode,
                error=run.stderr[-4000:], log=str(prefix.with_suffix('.log')))
            rows.append(row)
            print(json.dumps(row), flush=True)
    (args.output_directory / ('summary-' + args.engines + '.json')).write_text(json.dumps(rows, indent=2))
    geometry_review(args.output_directory)
    if any(row['status'] == 'failed' for row in rows):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
