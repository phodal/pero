"""Opt-in public provider/acquisition probe, without a model or scientific verdict."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'apps/paper-agent/backend'))
from paper_agent.model import PaperSnapshot
from paper_agent.research_jobs import ResearchJobs
from paper_agent.research_program_store import ResearchPrograms
from paper_agent.store import ResearchStore


def main():
    if os.environ.get('PERO_RESEARCH_PUBLIC') != '1':
        raise SystemExit('Explicit PERO_RESEARCH_PUBLIC=1 required')
    now = lambda: datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    root = ROOT / 'test-results/paper-program-public' / now().replace(':', '-')
    store = ResearchStore(root)
    paper = store.save_paper(PaperSnapshot.from_reading(dict(title='Attention Is All You Need', source='arxiv',
        sourceId='1706.03762v7', url='https://arxiv.org/abs/1706.03762v7', pdfUrl='https://arxiv.org/pdf/1706.03762v7',
        authors=[], contentKind='abstract', content='Bibliographic seed; acquire original before interpretation.'), now()))
    programs = ResearchPrograms(store)
    jobs = ResearchJobs(programs)
    state = programs.command(dict(operation='create', requestId='public-acquisition-probe', question='What sources are retrievable?',
        scope='Public Transformer literature', inclusion='Original public papers', exclusion='Unobserved claims',
        seedPaperIds=[paper.id], acquisition='public_pdf', minutes=4, limits=dict(searches=1, downloads=1)), now())
    results = []
    try:
        for operation, fields in [('search', dict(query=dict(query='Attention Is All You Need', sources=['alphaxiv', 'openalex'], limit=3))),
                                  ('acquire', dict(candidateId=state['candidates'][0]['id']))]:
            state = jobs.command(dict(operation=operation, operationId=operation, programId=state['id'],
                expectedCheckpoint=state['checkpoint'], **fields), now())
            job_id = state['job']['id']
            deadline = time.monotonic() + 55
            while state['job']['status'] in ('running', 'ready'):
                if time.monotonic() >= deadline:
                    raise RuntimeError('Finite public worker did not settle')
                # External worker/file condition, bounded by its 45-second operation deadline.
                time.sleep(0.2)
                state = jobs.command(dict(operation='poll', programId=state['id'], jobId=job_id), now())
            results.append(state['job'])
            print(json.dumps(dict(operation=operation, status=state['job']['status'], error=state['job'].get('error'),
                                  outcome=state['job'].get('outcome')), ensure_ascii=False), flush=True)
        pdf = store.paper_pdf(paper.id)
        report = dict(model='not_run', results=results, usage=state['usage'],
            source=dict(url=paper.pdf_url, fileDigest=pdf.file_digest, pages=len(pdf.pages)) if pdf else None,
            passed=bool(pdf and results[0]['status'] == 'completed'), scientificAcceptance='not_run')
        (root / 'result.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
        print(str(root / 'result.json'))
    finally:
        jobs.close()


if __name__ == '__main__':
    main()
