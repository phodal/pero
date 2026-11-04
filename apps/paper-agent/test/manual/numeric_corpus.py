"""Opt-in real scan diagnostic; supply downloaded PDFs, never fetch during tests."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from paper_agent.numeric_extraction import NumericExtractor
from paper_agent.pdf import PdfAnchor, PdfDocument, PdfRect
from paper_agent.pdf_files import PdfFiles


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf_directory', type=Path)
    parser.add_argument('output_directory', type=Path)
    args = parser.parse_args()
    corpus = json.loads((Path(__file__).parents[1] / 'fixtures/numeric-corpus.json').read_text())
    args.output_directory.mkdir(parents=True, exist_ok=True)
    results = []
    for sample in corpus['samples']:
        data = (args.pdf_directory / sample['fileName']).read_bytes()
        if hashlib.sha256(data).hexdigest() != sample['sha256']:
            raise ValueError(f"Original PDF digest mismatch: {sample['id']}")
        document = PdfDocument.create(sample['id'], sample['sha256'], sample['sourceUrl'],
                                      PdfFiles().pages(data), '2026-11-04T00:00:00Z')
        anchor = PdfAnchor(document.id, document.file_digest, sample['page'],
                           (PdfRect.parse(sample['region']),))
        extraction = NumericExtractor().extract(data, document, anchor)
        result = extraction.to_dict()
        if result['status'] != sample['expectedStatus']:
            raise AssertionError('Scanned numeric evidence bypassed review')
        if any(o['status'] != 'proposed' or o['semantics'] is not None
               for o in result['observations']):
            raise AssertionError('Raw observations acquired automatic semantics')
        if result['anchor']['fileDigest'] != sample['sha256']:
            raise AssertionError('Evidence lost its original PDF version')
        prefix = args.output_directory / sample['id']
        prefix.with_suffix('.json').write_text(json.dumps(result, indent=2))
        prefix.with_suffix('.png').write_bytes(extraction.image_bytes)
        summary = dict(id=sample['id'], classification=result['classification'],
                       ocrStatus=result['ocr']['status'], version=result['ocr']['version'],
                       nativeRegionCharacters=len(result['nativeRegionText']),
                       ocrCharacters=len(result['ocr']['text']),
                       proposedObservations=len(result['observations']), status=result['status'])
        results.append(summary)
        print(json.dumps(summary))
    (args.output_directory / 'summary.json').write_text(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
