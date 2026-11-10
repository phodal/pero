"""Emit a real Paper Agent export of a synthetic PDF and optionally retain its owner records."""

import argparse
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

paper_app = Path(__file__).resolve().parents[4] / 'apps' / 'paper-agent'
sys.path[:0] = [str(paper_app / 'backend'), str(paper_app / 'test')]

from paper_agent.local_pdf import LocalPdf
from paper_agent.model import ResearchRequest
from paper_agent.pdf_files import PdfFiles
from paper_agent.store import ResearchStore
from test_pdf import NOW, pdf_fixture


def export(directory):
    original = LocalPdf.parse(pdf_fixture(repeated=True), 'Notebook citation fixture.pdf')
    paper, pdf = PdfFiles().import_local(original, NOW)
    store = ResearchStore(directory)
    store.save_paper(paper)
    store.save_pdf(pdf, original.data)
    intent = store.prepare(ResearchRequest.parse(dict(
        question='Second page', paperIds=[paper.id], requestId='notebook-citation-fixture', fullText=True,
    )), NOW)
    passage = next(passage for passage in intent.passages if passage.page == 2)
    evidence = [
        dict(paperId=paper.id, passageId=passage.id, quote=quote)
        for quote in ('Exact original evidence.', 'Second page. Exact original evidence.')
    ]
    report = dict(
        schema='pero.paper-agent-report.v1', intentId=intent.id, title='Notebook citation fixture',
        sections=[dict(heading='Page observations', content='Page two includes the fixture evidence.',
                       paperIds=[paper.id], evidence=evidence)],
        experiments=[], limitations='Synthetic fixture generated for Notebook integration tests.',
    )
    saved = store.save_report(intent.id, json.dumps(report), NOW)
    return store.export(saved.id, 'json')['content'].encode('utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('data_directory', nargs='?', help='Optionally persist Paper Agent records here')
    options = parser.parse_args()
    if options.data_directory:
        result = export(options.data_directory)
    else:
        with TemporaryDirectory() as directory:
            result = export(directory)
    sys.stdout.buffer.write(result)
