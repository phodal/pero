"""Authored offline inputs; production HTTPS policy, approval, worker and parser remain active.

Staged beside research-pdf.py (as pdf_fixture.py) and scientific-document.html in
one disposable Desktop profile. Only the transport's DNS and connection seams
are substituted; unexpected URLs fail instead of falling back to the network.
"""
import io
import json
import os
from pathlib import Path

from pdf_fixture import pdf_bytes
from paper_agent.resource_fetch import PublicMetadata

SEED = 'https://research.example.org/structured-reading'
PDF = 'https://arxiv.org/pdf/2606.03979v2'
HTML = 'https://arxiv.org/html/2606.03979v2'


def record(url):
    path = Path(os.environ['PERO_APP_DATA']) / 'structured-fixture-requests.jsonl'
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a') as stream:
        stream.write(json.dumps(dict(url=url, synthetic=True)) + '\n')


def resolve(host, *_args, **_options):
    if host not in ('research.example.org', 'arxiv.org'):
        raise AssertionError('Offline structured fixture refuses unexpected hostname: ' + host)
    return [(None, None, None, None, ('93.184.216.34', 443))]


class Connection:
    def __init__(self, host, address, timeout):
        self.host, self.sock = host, None

    def request(self, method, path, **_options):
        assert method == 'GET'
        self.url = 'https://' + self.host + path

    def getresponse(self):
        record(self.url)
        if self.url == SEED:
            data = ('<title>Synthetic structured reading</title><main><h1>Synthetic structured reading</h1>'
                    f'<a href="{PDF}">Fixed v2 synthetic paper PDF</a></main>').encode()
            mime = 'text/html'
        elif self.url == PDF:
            data, mime = pdf_bytes('Structured fixture'), 'application/pdf'
        elif self.url == HTML:
            data = Path(__file__).with_name('scientific-document.html').read_bytes()
            mime = 'text/html'
        else:
            raise AssertionError('Offline structured fixture refuses unexpected URL: ' + self.url)
        response = io.BytesIO(data)
        response.status = 200
        headers = {'Content-Type': mime, 'Content-Length': str(len(data))}
        response.getheader = lambda name, default=None: headers.get(name, default)
        return response

    def close(self):
        pass


def install(store):
    from paper_agent.paper_documents import PaperDocuments
    from paper_agent.resource_inspection import ResourceInspector
    from paper_agent.pdf_downloads import PdfDownloads
    transport = PublicMetadata(resolve, Connection)
    store.imports.inspector = ResourceInspector(transport.fetch)
    store.pdf_downloads = PdfDownloads(store, transport)
    return PaperDocuments(store, transport)
