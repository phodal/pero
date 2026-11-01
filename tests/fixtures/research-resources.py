"""Synthetic public metadata seam, installed only in the disposable E2E App."""
import hashlib
import io
import json
import os
from pathlib import Path
import threading
import time

SEED = 'https://research.example.org/forecasting'
REVISION = 'a' * 40
PAYLOAD = b'fixture weights\n'
CONTENTS = {'weights.safetensors': PAYLOAD, 'weights.bin': b'verified tiny research model\n',
            'slow.bin': b'cancelled fixture bytes\n'}


def fetch(url, **_options):
    from paper_agent.model import Invalid
    from paper_agent.resource_fetch import WebDocument
    with (Path(os.environ['PERO_APP_DATA']) / 'research-fixture-fetches.jsonl').open('a') as stream:
        stream.write(json.dumps({'url': url}) + '\n')
    if url in ('https://example.org/research-one', 'https://example.org/research-two'):
        return WebDocument(url, 'text/html', '<article><h1>Synthetic research import</h1>'
                           '<p>This is fixture evidence, not a scientific result.</p>'
                           '<a href="https://huggingface.co/example/forecast">Model files</a></article>')
    if url == SEED:
        return WebDocument(url, 'text/html', '''<html><head><title>Synthetic forecasting release</title>
        <meta name="author" content="Fixture Research Group"></head><body><article>
        <h1>Synthetic forecasting release</h1><p>This is a synthetic research article, not a paper.</p>
        <a href="https://github.com/example/forecast">Code implementation</a>
        <a href="https://huggingface.co/example/forecast">Model weights</a>
        <a href="https://arxiv.org/abs/2401.12345">Earlier foundational paper</a>
        <a href="https://example.org/evaluation">Benchmark evaluation</a>
        </article></body></html>''')
    if url == 'https://api.github.com/repos/example/forecast':
        return WebDocument(url, 'application/json', json.dumps({'full_name': 'example/forecast', 'private': False,
            'description': 'Synthetic implementation; do not execute.', 'license': {'spdx_id': 'Apache-2.0'}}))
    if url == 'https://huggingface.co/api/models/example/forecast?blobs=true':
        return WebDocument(url, 'application/json', json.dumps({'id': 'example/forecast', 'sha': REVISION,
            'private': False, 'gated': False, 'cardData': {'license': 'Apache-2.0'}, 'tags': ['arxiv:2401.12345'],
            'siblings': [{'rfilename': name, 'lfs': {'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()}}
                         for name, content in CONTENTS.items()]}))
    if url == 'https://www.alphaxiv.org/overview/2401.12345.md':
        return WebDocument(url, 'text/plain', 'An earlier foundational paper, not a paper announcing this release.')
    if url == 'https://arxiv.org/abs/2401.12345':
        return WebDocument(url, 'text/html', '<meta name="citation_title" content="Earlier foundational paper"><meta name="citation_author" content="Fixture Author">')
    # Never fall through to network: an unexpected resolver request fails visibly.
    raise Invalid('Unexpected synthetic metadata request: ' + url)


def download_opener(directory):
    directory = Path(directory)
    def open_bytes(source):
        if source.url != f'https://huggingface.co/example/forecast/resolve/{REVISION}/{source.filename}':
            raise AssertionError('Unexpected external file request in offline fixture')
        with (directory / 'fixture-opens.jsonl').open('a', encoding='utf-8') as output:
            output.write(json.dumps(dict(filename=source.filename, bundleId=source.bundleId)) + '\n')
        class Stream(io.BytesIO):
            def read(self, size):
                if source.filename == 'slow.bin':
                    (directory / 'fixture-slow-entered').touch()
                    deadline = time.monotonic() + 10
                    while not (directory / 'fixture-release-slow').exists():
                        if time.monotonic() >= deadline:
                            raise TimeoutError('Fixture stream was not released')
                        threading.Event().wait(.01)
                return super().read(size)
        return Stream(CONTENTS[source.filename])
    return open_bytes
