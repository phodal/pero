"""Persist real Paper owner records; optional original PDF replaces the offline CI fixture."""
import json
import os
from pathlib import Path
import runpy
import sys

root = Path(__file__).resolve().parents[2]
fixture = runpy.run_path(str(root / 'packages/notebook/test/fixtures/generate-paper-export.py'))
source = os.environ.get('PERO_NOTEBOOK_INTEROP_PDF')
if not source:
    sys.stdout.buffer.write(fixture['export'](sys.argv[1]))
else:
    from paper_agent.local_pdf import LocalPdf
    from paper_agent.model import ResearchRequest
    from paper_agent.pdf_files import PdfFiles
    from paper_agent.store import ResearchStore

    now = '2026-11-11T00:00:00Z'
    upload = LocalPdf.parse(Path(source).read_bytes(), 'Astrom and Murray - PID Control.pdf')
    paper, pdf = PdfFiles().import_local(upload, now)
    store = ResearchStore(sys.argv[1])
    store.save_paper(paper)
    store.save_pdf(pdf, upload.data)
    quote = 'integral action guarantees that the process output'
    intent = store.prepare(ResearchRequest.parse(dict(question=quote, paperIds=[paper.id],
                           requestId='notebook-interop-control', fullText=True)), now)
    passage = next(item for item in intent.passages if quote in item.content)
    report = dict(schema='pero.paper-agent-report.v1', intentId=intent.id,
        title='Integral action: source for an authored PI check',
        sections=[dict(heading='Motivation', content='Integral action motivates checking steady error. '
                       'The Notebook PI model and finite observation windows are authored engineering inputs.',
                       paperIds=[paper.id], evidence=[dict(paperId=paper.id, passageId=passage.id, quote=quote)])],
        experiments=[], limitations='Manual source citation; no model call or independent scientific review. '
        'The PI golden case is not a reproduction of the book experiments.')
    saved = store.save_report(intent.id, json.dumps(report), now)
    sys.stdout.buffer.write(store.export(saved.id, 'json')['content'].encode())
