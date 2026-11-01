"""Synthetic HTTPS transport seam: production DNS policy/parser/store stay active."""
import io
import json
import os
from pathlib import Path
import threading

from paper_agent.resource_fetch import PublicMetadata, WebDocument

SEED = 'https://research.example.org/pdf-study'
URLS = tuple('https://pdf.example.org/' + name + '.pdf' for name in ('first', 'retry', 'cancel'))


def record(kind, url):
    path = Path(os.environ['PERO_APP_DATA']) / 'pdf-fixture-requests.jsonl'
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a') as stream:
        stream.write(json.dumps(dict(kind=kind, url=url)) + '\n')
    return sum(json.loads(line)['url'] == url for line in path.read_text().splitlines())


def metadata(url, **_options):
    record('metadata', url)
    if url != SEED:
        raise AssertionError('References-only must not probe PDF URLs')
    links = ''.join(f'<a href="{url}">{label} paper PDF</a>' for url, label in zip(URLS, ('First', 'Retry', 'Cancel')))
    return WebDocument(url, 'text/html', '<title>Synthetic PDF study</title><main><h1>Synthetic PDF study</h1>' + links + '</main>')


def pdf_bytes(label='First'):
    # Same minimal PDF construction as Paper's unit fixture; entirely authored test text.
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    for page in (1, 2):
        content = f'BT /F1 11 Tf 25 520 Td ({label} page {page}. Synthetic evidence only; no experiment was performed.) Tj ET'.encode()
        objects.append(b'<< /Length ' + str(len(content)).encode() + b' >>\nstream\n' + content + b'\nendstream')
    data, offsets = bytearray(b'%PDF-1.4\n'), [0]
    for index, item in enumerate(objects, 1):
        offsets.append(len(data)); data.extend(f'{index} 0 obj\n'.encode() + item + b'\nendobj\n')
    offset = len(data)
    data.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
    for item in offsets[1:]:
        data.extend(f'{item:010d} 00000 n \n'.encode())
    data.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{offset}\n%%EOF\n'.encode())
    return bytes(data)


def resolve(host, *_args, **_options):
    if host != 'pdf.example.org':
        raise AssertionError('Fixture admits only its synthetic public hostname')
    return [(None, None, None, None, ('93.184.216.34', 443))]


class Connection:
    def __init__(self, host, address, timeout):
        self.host, self.sock = host, None

    def request(self, method, path, **_options):
        assert method == 'GET'
        self.url = 'https://' + self.host + path

    def getresponse(self):
        count = record('pdf', self.url)
        if self.url == URLS[2] and count == 1:
            threading.Event().wait(120)  # Parent must terminate this child on cancellation.
        bad = self.url == URLS[1] and count == 1
        data = b'<html>Not a PDF</html>' if bad else pdf_bytes(self.url.rsplit('/', 1)[-1])
        response = io.BytesIO(data)
        response.status = 200
        headers = {'Content-Type': 'text/html' if bad else 'application/pdf', 'Content-Length': str(len(data))}
        response.getheader = lambda name, default=None: headers.get(name, default)
        return response

    def close(self):
        pass


def install(store):
    from paper_agent.resource_inspection import ResourceInspector
    from paper_agent.pdf_downloads import PdfDownloads
    store.imports.inspector = ResourceInspector(metadata)
    store.pdf_downloads = PdfDownloads(store, PublicMetadata(resolve, Connection))
