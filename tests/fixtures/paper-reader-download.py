"""Owned reader PDF bytes through the real reviewed-download owner, never HTTP."""
import io
import json
import os
from pathlib import Path
from paper_agent.resource_fetch import PublicMetadata
from paper_agent.resource_inspection import ResourceInspector
from paper_agent.pdf_downloads import PdfDownloads

PDF_URL = 'https://arxiv.org/pdf/1706.03762v1'
RETRY_URL = 'https://reader.example.org/retry.pdf'
IMAGE_URL = 'https://reader.example.org/image-only.pdf'


def metadata(url, **_options):
    raise AssertionError('Fixed reader fixture must not fetch metadata: ' + url)


def resolve(host, *_args, **_options):
    if host not in ('arxiv.org', 'reader.example.org'):
        raise AssertionError('Unknown reader fixture host: ' + host)
    return [(None, None, None, None, ('93.184.216.34', 443))]


class Connection:
    def __init__(self, host, address, timeout):
        self.host, self.sock = host, None

    def request(self, method, path, **_options):
        self.url = 'https://' + self.host + path
        if method != 'GET' or self.url not in (PDF_URL, RETRY_URL, IMAGE_URL):
            raise AssertionError('Unknown reader fixture request: ' + path)

    def getresponse(self):
        data, mime = Path(os.environ['PERO_READER_FIXTURE_PDF']).read_bytes(), 'application/pdf'
        if self.url == IMAGE_URL:
            data = Path(os.environ['PERO_READER_FIXTURE_PDF']).with_name('image-only.pdf').read_bytes()
            with (Path(os.environ['PERO_APP_DATA']) / 'reader-image-only-attempts.jsonl').open('a') as stream:
                stream.write(json.dumps({'url': self.url}) + '\n')
        if self.url == RETRY_URL:
            # A dedicated persisted counter: primary PDF reads and process
            # restarts cannot consume or reset this one authored failure.
            attempts = Path(os.environ['PERO_APP_DATA']) / 'reader-retry-attempts.jsonl'
            with attempts.open('a') as stream:
                stream.write(json.dumps({'url': self.url}) + '\n')
            if len(attempts.read_text().splitlines()) == 1:
                data, mime = b'<html>Authored transient PDF failure</html>', 'text/html'
        response = io.BytesIO(data)
        response.status = 200
        response.getheader = lambda name, default=None: {'Content-Type': mime, 'Content-Length': str(len(data))}.get(name, default)
        return response

    def close(self):
        pass



def install(store, pdf_path):
    os.environ['PERO_PAPER_DIR'] = str(Path(os.environ['PERO_APP_DATA']) / 'reader-export-fixture')
    os.environ['PERO_READER_FIXTURE_PDF'] = str(pdf_path)
    store.imports.inspector = ResourceInspector(metadata)
    store.pdf_downloads = PdfDownloads(store, PublicMetadata(resolve, Connection))
