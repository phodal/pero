"""Test-only replay of one byte-verified, previously downloaded public archive.

Not a product network fallback. No live fetch, proxy, model or execution.
"""
import hashlib
import io
import json
import os
from pathlib import Path

URL = 'https://arxiv.org/src/2610.33195v1'
SHA = '64f9c5acf22713910a8a53b556469123bf4f4363cf2e6ff7b9aecd1218064f09'
SIZE = 5603079


def metadata(url, **_options):
    raise AssertionError('Recorded-source case has no approved webpage recording or live metadata access')


def resolve(host, *_args, **_kwargs):
    if host != 'arxiv.org':
        raise AssertionError('Recorded transport only admits its fixed public arXiv source')
    return [(None, None, None, None, ('93.184.216.34', 443))]


class Connection:
    def __init__(self, host, address, timeout):
        self.host, self.sock = host, None

    def request(self, method, path, **_options):
        if method != 'GET' or 'https://' + self.host + path != URL:
            raise AssertionError('Only the exact recorded source request is supported')

    def getresponse(self):
        configured = os.environ.get('PAPER_STUDY_SOURCE_ARCHIVE')
        if configured is None:
            # The runner captures explicit configuration before AppProcess clears env.
            config = Path(__file__).with_name('recorded-source-path.json')
            configured = json.loads(config.read_text()).get('archive') if config.is_file() else None
        if not isinstance(configured, str) or not configured or not Path(configured).is_absolute():
            raise AssertionError('Set PAPER_STUDY_SOURCE_ARCHIVE to an absolute authorized archive file')
        data = Path(configured).read_bytes()
        if len(data) != SIZE or hashlib.sha256(data).hexdigest() != SHA:
            raise AssertionError('Public recording integrity mismatch')
        log = Path(os.environ['PERO_APP_DATA']) / 'source-fixture-requests.jsonl'
        with log.open('a') as output:
            output.write(json.dumps(dict(kind='source', url=URL, transport='recorded public bytes', sha256=SHA, size=SIZE)) + '\n')
        response = io.BytesIO(data)
        response.status = 200
        headers = {'Content-Type': 'application/gzip', 'Content-Length': str(len(data))}
        response.getheader = lambda name, default=None: headers.get(name, default)
        return response

    def close(self):
        pass


def install(store):
    from paper_agent.resource_inspection import ResourceInspector
    from paper_agent.resource_fetch import PublicMetadata
    from paper_agent.source_downloads import SourceDownloads
    from paper_agent.pdf_downloads import PdfDownloads
    store.imports.inspector = ResourceInspector(metadata)
    transport = PublicMetadata(resolve, Connection)
    store.source_downloads = SourceDownloads(store, transport)
    store.pdf_downloads = PdfDownloads(store, transport)
