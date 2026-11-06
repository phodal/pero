"""Start the real Paper HTTP/domain stack with one locally authored PDF."""
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
from paper_agent.pdf_files import PdfFiles
from paper_agent.research_program_access import program_request
from paper_agent.research_program_store import ResearchPrograms
from paper_agent.store import ResearchStore

now = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
pages = ['The synthetic method assumes a fixed model.',
         'Model mismatch causes the synthetic method to fail.',
         'An adaptive correction restores the result under bounded mismatch.']
objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
           b'<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>']
for index in range(3):
    objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 6 0 R >> >> /Contents {7 + index} 0 R >>'.encode())
objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
for text in pages:
    stream = f'BT /F1 12 Tf 30 700 Td ({text}) Tj ET'.encode()
    objects.append(b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream')
pdf, offsets = bytearray(b'%PDF-1.4\n'), [0]
for index, value in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf.extend(f'{index} 0 obj\n'.encode() + value + b'\nendobj\n')
xref = len(pdf)
pdf.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
for offset in offsets[1:]:
    pdf.extend(f'{offset:010d} 00000 n \n'.encode())
pdf.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
pdf = bytes(pdf)
store = ResearchStore(os.environ['PERO_APP_DATA'])
paper = store.save_paper(PaperSnapshot.from_reading(dict(title='Synthetic model mismatch study', source='import',
    sourceId='python-program-fixture', url='https://example.invalid/fixture-paper', authors=['Local fixture'],
    contentKind='full-text', content='\n'.join(pages)), now))
document = PdfFiles().inspect(paper, pdf, now)
assert len(document.pages) == 3 and all(text in page.text for text, page in zip(pages, document.pages))
store.save_pdf(document, pdf)
programs = ResearchPrograms(store)
program = programs.command(dict(operation='create', requestId='python-program-three-rounds',
    question='Does the method survive model mismatch?', scope='The locally saved original fixture PDF',
    inclusion='Observed original passages', exclusion='Metadata and unobserved claims',
    seedPaperIds=[paper.id], acquisition='saved_only', minutes=60, noProgressLimit=2,
    limits=dict(rounds=3, reads=6, modelRequests=64, appCalls=80)), now)
descriptor = program_request(programs, dict(operation='launch', programId=program['id']), now)
(Path(os.environ['PERO_APP_DATA']) / 'fixture-seed.json').write_text(json.dumps(dict(context=descriptor['context'],
    paperId=paper.id, documentId=document.id, pages=pages, checkpoint=program['checkpoint'])))


class NoLiteratureNetwork:
    def __getattr__(self, name):
        raise AssertionError('This saved-PDF integration must not call literature network: ' + name)


server = ThreadingHTTPServer(('127.0.0.1', 0), handler(store, os.environ['PERO_APP_TOKEN'],
    literature=NoLiteratureNetwork(), now=lambda: now))


def stop_with_launcher():
    # The launcher's stdin pipe closes when Host disposes its owned App process.
    sys.stdin.buffer.read()
    server.shutdown()


threading.Thread(target=stop_with_launcher, daemon=True).start()
print(json.dumps(dict(port=server.server_port)), flush=True)
try:
    server.serve_forever()
finally:
    server.server_close()
