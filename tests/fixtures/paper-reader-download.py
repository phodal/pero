"""Owned reader PDF bytes through the real reviewed-download owner, never HTTP."""
import io
import os
from pathlib import Path
from paper_agent.resource_fetch import PublicMetadata
from paper_agent.resource_inspection import ResourceInspector
from paper_agent.pdf_downloads import PdfDownloads

PDF_URL = 'https://arxiv.org/pdf/1706.03762v1'


def metadata(url, **_options):
    raise AssertionError('Fixed reader fixture must not fetch metadata: ' + url)


def resolve(host, *_args, **_options):
    if host != 'arxiv.org':
        raise AssertionError('Unknown reader fixture host: ' + host)
    return [(None, None, None, None, ('93.184.216.34', 443))]


class Connection:
    def __init__(self, host, address, timeout):
        self.host, self.sock = host, None

    def request(self, method, path, **_options):
        if method != 'GET' or 'https://' + self.host + path != PDF_URL:
            raise AssertionError('Unknown reader fixture request: ' + path)

    def getresponse(self):
        data = Path(os.environ['PERO_READER_FIXTURE_PDF']).read_bytes()
        response = io.BytesIO(data)
        response.status = 200
        response.getheader = lambda name, default=None: {'Content-Type': 'application/pdf', 'Content-Length': str(len(data))}.get(name, default)
        return response

    def close(self):
        pass



def install(store, pdf_path):
    os.environ['PERO_PAPER_DIR'] = str(Path(os.environ['PERO_APP_DATA']) / 'reader-export-fixture')
    os.environ['PERO_READER_FIXTURE_PDF'] = str(pdf_path)
    store.imports.inspector = ResourceInspector(metadata)
    store.pdf_downloads = PdfDownloads(store, PublicMetadata(resolve, Connection))
