"""Real Paper handler with restart-safe local seed and loopback worker providers."""
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import threading


def pdf_bytes(text):
    stream = f'BT /F1 12 Tf 30 700 Td ({text}) Tj ET'.encode()
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream']
    data, offsets = bytearray(b'%PDF-1.4\n'), [0]
    for index, value in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f'{index} 0 obj\n'.encode() + value + b'\nendobj\n')
    xref = len(data)
    data.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
    for offset in offsets[1:]:
        data.extend(f'{offset:010d} 00000 n \n'.encode())
    data.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    return bytes(data)


def main():
    config = json.loads(Path(__file__).with_name('fixture.json').read_text())
    sys.path.insert(0, config['backend'])
    from paper_agent.http import handler
    from paper_agent.model import PaperSnapshot, digest
    from paper_agent.pdf_files import PdfFiles
    from paper_agent.research_program_access import program_request
    from paper_agent.research_program_store import ResearchPrograms
    from paper_agent.store import ResearchStore
    import paper_agent.research_jobs as jobs_module
    from worker import loopback_work

    class FixtureJobs(jobs_module.ResearchJobs):
        def __init__(self, programs):
            super().__init__(programs, worker=loopback_work)

    jobs_module.ResearchJobs = FixtureJobs
    data = Path(os.environ['PERO_APP_DATA'])
    store = ResearchStore(data)
    seed_path = data / 'fixture-seed.json'
    if not seed_path.exists():
        now = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
        paper = store.save_paper(PaperSnapshot.from_reading(dict(title='Fixed-model seed study', source='openalex',
            sourceId='W1', url='https://openalex.org/W1', authors=['Local fixture'], contentKind='full-text',
            content='The seed study assumes an invariant model.'), now))
        original = pdf_bytes('The seed study assumes an invariant model.')
        store.save_pdf(PdfFiles().inspect(paper, original, now), original)
        acquired_text = 'A newly acquired counterexample disproves fixed-model invariance.'
        acquired = pdf_bytes(acquired_text)
        (data / 'fixture-new.pdf').write_bytes(acquired)
        programs = ResearchPrograms(store)
        plan = programs.command(dict(operation='create', requestId='discover-acquire-resume', question='Find a counterexample to the seed method',
            scope='Original sources related to the saved seed', inclusion='Original observed counterexamples', exclusion='Unobserved interpretations',
            seedPaperIds=[paper.id], acquisition='public_pdf', minutes=60, noProgressLimit=2,
            limits=dict(rounds=1, searches=2, downloads=2, downloadBytes=2 * 1024 * 1024, reads=4, modelRequests=64, appCalls=80)), now)
        descriptor = program_request(programs, dict(operation='launch', programId=plan['id']), now)
        seed_path.write_text(json.dumps(dict(context=descriptor['context'], paperId=paper.id, now=now,
            acquiredText=acquired_text, acquiredDigest=digest(acquired), acquiredBytes=len(acquired))))
    seed = json.loads(seed_path.read_text())
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler(store, os.environ['PERO_APP_TOKEN'], now=lambda: seed['now']))

    def stop_with_launcher():
        sys.stdin.buffer.read()
        store.program_jobs.close()
        server.shutdown()

    threading.Thread(target=stop_with_launcher, daemon=True).start()
    print(json.dumps(dict(port=server.server_port)), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
