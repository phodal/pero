"""Explicit opt-in: real public-paper seed, providers and acquisition workers."""
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import threading

config = json.loads(Path(__file__).with_name('fixture.json').read_text(encoding='utf-8'))
sys.path.insert(0, config['backend'])
from paper_agent.http import handler
from paper_agent.model import PaperSnapshot
from paper_agent.research_program_access import program_request
from paper_agent.research_program_store import ResearchPrograms
from paper_agent.store import ResearchStore


def main():
    now = lambda: datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    store = ResearchStore(os.environ['PERO_APP_DATA'])
    paper = store.save_paper(PaperSnapshot.from_reading(dict(title='Attention Is All You Need', source='arxiv',
        sourceId='1706.03762v7', url='https://arxiv.org/abs/1706.03762v7',
        pdfUrl='https://arxiv.org/pdf/1706.03762v7', authors=[], contentKind='abstract',
        content='Bibliographic seed only. Acquire and read the original before making any scientific claim.'), now()))
    programs = ResearchPrograms(store)
    program = programs.command(dict(operation='create', requestId='live-paper-program',
        question='Under which conditions does attention reduce sequential computation, and what limitations or counterevidence qualify that claim?',
        scope='Attention Is All You Need and directly related papers about sequential computation and long-sequence cost.',
        inclusion='Public original sources with directly observed methods, assumptions and complexity evidence.',
        exclusion='Metadata-only claims, unobserved experiments, general benchmark rankings.', seedPaperIds=[paper.id],
        acquisition='public_pdf', minutes=12, noProgressLimit=2,
        limits=dict(rounds=3, searches=4, candidates=12, reads=16, downloads=3,
                    downloadBytes=30 * 1024 * 1024, modelRequests=60, appCalls=100)), now())
    descriptor = program_request(programs, dict(operation='launch', programId=program['id']), now())
    (store.root / 'fixture-seed.json').write_text(json.dumps(dict(context=descriptor['context'], paperId=paper.id)), encoding='utf-8')
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler(store, os.environ['PERO_APP_TOKEN'], now=now))
    def stop():
        sys.stdin.buffer.read()
        server.shutdown()
    threading.Thread(target=stop, daemon=True).start()
    print(json.dumps(dict(port=server.server_port)), flush=True)
    try:
        server.serve_forever()
    finally:
        store.program_jobs.close()
        server.server_close()


if __name__ == '__main__':
    main()
