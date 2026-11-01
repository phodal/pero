"""Opt-in fixed-corpus HTML parser acceptance; exports metadata, never originals.

Uses the product's bounded acquisition worker, HTTPS transport and HTML adapter.
This is not Desktop, bundle-consent, observed-ledger or scientific validation.
"""
import argparse
from collections import Counter
from dataclasses import asdict
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import platform
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from paper_agent.acquisition_worker import acquire_bounded
from paper_agent.arxiv_html import parse_arxiv_html
from paper_agent.paper_documents import prepare_html
from paper_agent.resource_fetch import PublicMetadata
from paper_agent.scientific_document import ScientificDocument, encoded

URL = 'https://arxiv.org/html/2606.03979v2'


def coverage(document, original):
    """Verify retained structure and export only a fixed metadata projection."""
    if document.source.digest != sha256(original).hexdigest():
        raise ValueError("Original digest mismatch")
    if document.source.byte_length != len(original):
        raise ValueError("Original size mismatch")
    if document.source.url != URL or document.source.version != 'v2':
        raise ValueError('Unexpected source version')
    if document.source_identity != 'response-explicit-version':
        raise ValueError('Response version unconfirmed')
    if ScientificDocument.from_record(json.loads(encoded(document.to_dict()))).id != document.id:
        raise ValueError('Immutable roundtrip changed identity')
    if parse_arxiv_html(original, URL, document.paper_id, requested_url=URL).id != document.id:
        raise ValueError('Repeated parse changed identity')
    kinds = Counter(block.kind for block in document.blocks)
    for kind in ('heading', 'paragraph', 'equation', 'table', 'figure', 'reference'):
        if not kinds[kind]:
            raise ValueError('Missing expected corpus structure: ' + kind)
    windows, missing, partial = 0, 0, 0
    for block in document.blocks:
        start = 0
        while start is not None:
            read = document.read(block.id, start, 4800)
            if len(encoded(read)) > 32768:
                raise ValueError('Typed read exceeds output bound')
            if read['evidenceAdmission'] != 'not-observed-in-study':
                raise ValueError('Unexpected evidence admission')
            windows += 1
            missing += len(read.get('missing', []))
            partial += not read['complete']
            next_start = read['nextStart']
            if next_start is not None and next_start <= start:
                raise ValueError('Typed continuation made no progress')
            start = next_start
    references = Counter(item.target_status for block in document.blocks
                         for item in (*block.content, *(token for cell in block.cells for token in cell.content))
                         if item.target)
    return dict(documentId=document.id, source=asdict(document.source),
                manifest=asdict(document.manifest), parseStatus='partial' if document.warnings else 'parsed',
                warnings=list(document.warnings), blockKinds=dict(sorted(kinds.items())),
                tableCells=sum(len(block.cells) for block in document.blocks),
                sourceLocators=sum(block.locator is not None for block in document.blocks),
                citationTargets=dict(sorted(references.items())), typedReadWindows=windows,
                missingItems=missing, incompleteWindows=partial,
                checks=['raw digest and size', 'fixed response version', 'immutable JSON roundtrip',
                        'same-input repeat identity', 'expected corpus structure', 'bounded typed windows'],
                scientificAcceptance='unverified', pdfAlignment='unavailable',
                imageObservation='not-observed', sourceBytesExported=False)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-official-html', action='store_true', required=True,
                        help='Consent only to the fixed v2 HTML; no images, PDF, source or model')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    report = dict(observedAt=datetime.now(timezone.utc).isoformat(), requestedUrl=URL,
                  environment=dict(python=platform.python_version(), system=platform.system(),
                                   machine=platform.machine()),
                  scope='product HTML transport/parser; no Desktop, ledger or scientific validation',
                  outcome='not-run', sourceBytesExported=False)
    # Original HTML and IR never leave a private, automatically removed directory.
    with tempfile.TemporaryDirectory(prefix='pero-html-acceptance-') as directory:
        result = acquire_bounded(prepare_html, (directory, URL, '', PublicMetadata()),
                                 threading.Event(), 45, lambda _stage: None)
        if result[0] != 'complete':
            report.update(outcome='acquisition-not-completed', acquisitionStatus=result[0], reason=result[1])
        else:
            root = Path(directory)
            document = ScientificDocument.from_record(json.loads((root / 'document.json').read_bytes()))
            try:
                report.update(coverage(document, (root / 'source.html').read_bytes()), outcome='passed')
            except ValueError as error:
                # Do not emit third-party text or a traceback containing source data.
                report.update(outcome='regression-failed', reason=str(error) or 'Corpus invariant failed')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(dict(outcome=report['outcome'], sourceBytesExported=False)))
    return 0 if report['outcome'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
