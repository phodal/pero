"""No provider or public network. Fixed replay and denied legacy fetch boundaries."""
import hashlib
import importlib.util
import json
import os
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
import socket
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import OpenerDirector

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'apps/paper-agent/backend'))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


replay = load('source_fixture', 'recorded-transport.py')
backend = load('study_fixture', 'backend.py')
from paper_agent.store import ResearchStore
from paper_agent.model import Invalid, PaperSnapshot
from paper_agent.literature import LiteratureClient, ORIGINS
from paper_agent.thumbnails import PaperThumbnails


class ReplayBoundary(unittest.TestCase):
    def test_recording_requires_explicit_absolute_path_and_verified_bytes(self):
        connection = replay.Connection('arxiv.org', '93.184.216.34', 1)
        connection.request('GET', '/src/2610.33195v1')
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'authored-source.bin'
            data = b'Authored transport fixture; not a public source archive.'
            archive.write_bytes(data)
            with patch.dict(os.environ, {'PERO_APP_DATA': directory}, clear=True):
                with self.assertRaisesRegex(AssertionError, 'PAPER_STUDY_SOURCE_ARCHIVE'):
                    connection.getresponse()
                os.environ['PAPER_STUDY_SOURCE_ARCHIVE'] = 'relative-source.bin'
                with self.assertRaisesRegex(AssertionError, 'absolute'):
                    connection.getresponse()
                os.environ['PAPER_STUDY_SOURCE_ARCHIVE'] = str(archive)
                with self.assertRaisesRegex(AssertionError, 'integrity mismatch'):
                    connection.getresponse()
                with patch.object(replay, 'SIZE', len(data)):
                    with self.assertRaisesRegex(AssertionError, 'integrity mismatch'):
                        connection.getresponse()
                    with patch.object(replay, 'SHA', hashlib.sha256(data).hexdigest()):
                        self.assertEqual(connection.getresponse().read(), data)
                        del os.environ['PAPER_STUDY_SOURCE_ARCHIVE']
                        config = Path(directory) / 'recorded-source-path.json'
                        with patch.object(replay, '__file__', str(Path(directory) / 'source_fixture.py')):
                            config.write_text(json.dumps({'archive': 'relative-source.bin'}))
                            with self.assertRaisesRegex(AssertionError, 'absolute'):
                                connection.getresponse()
                            config.write_text(json.dumps({'archive': str(archive)}))
                            self.assertEqual(connection.getresponse().read(), data)
            self.assertEqual(len((Path(directory) / 'source-fixture-requests.jsonl').read_text().splitlines()), 2)

    def test_actual_handler_refuses_legacy_prepare_download_and_thumbnail(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(directory)
            replay.install(store)
            paper = PaperSnapshot.from_reading(dict(source='arxiv', sourceId='2610.33195v1',
                title='Synthetic stored-paper negative control', contentKind='abstract', content='Authored test abstract only.',
                url='https://arxiv.org/abs/2610.33195v1', pdfUrl='https://arxiv.org/pdf/2610.33195v1'), '2026-11-01T00:00:00Z')
            store.save_paper(paper)
            server = ThreadingHTTPServer(('127.0.0.1', 0), backend.campaign_handler(store, 'fixture-token'))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with patch.object(OpenerDirector, 'open', side_effect=AssertionError('Unexpected live urllib client')) as live:
                    for path, body in (
                        ('/api/research/prepare', dict(question='Read this stored abstract PDF', paperIds=[paper.id], fullText=True, requestId='negative-control')),
                        ('/api/paper-thumbnails/2610.33195.png', None),
                    ):
                        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=5)
                        connection.request('POST' if body else 'GET', path, json.dumps(body) if body else None,
                            {'X-Pero-App-Token': 'fixture-token', 'Content-Type': 'application/json'})
                        response = connection.getresponse()
                        value = json.loads(response.read())
                        connection.close()
                        self.assertEqual(response.status, 403 if not body else 409, value)
                        self.assertIn('does not authorize' if not body else 'source review', value['detail'])
                    live.assert_not_called()
            finally:
                server.shutdown(); thread.join(5); server.server_close()
                store.source_downloads.close(); store.pdf_downloads.close(); store.imports.close()

    def test_non_source_and_legacy_requests_never_use_live_network(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(socket, 'create_connection') as connect:
            store = ResearchStore(directory)
            replay.install(store)
            try:
                for transport in (store.source_downloads.transport, store.pdf_downloads.transport):
                    self.assertIs(transport.resolve, replay.resolve)
                    self.assertIs(transport.connection, replay.Connection)
                    for url in ('https://arxiv.org/pdf/2610.33195v1', 'https://arxiv.org/src/2610.33195v2',
                                'https://example.org/other', 'https://arxiv.org/src/2610.33195v1?extra=1'):
                        with self.assertRaises(AssertionError):
                            transport.fetch_source(url)
                for operation in (
                    lambda: LiteratureClient(fetch=backend.denied_external)._request('https://' + next(iter(ORIGINS)) + '/'),
                    lambda: PaperThumbnails(fetch=backend.denied_external).read('2610.33195'),
                ):
                    with self.assertRaisesRegex(Invalid, 'does not authorize'):
                        operation()
                connect.assert_not_called()
            finally:
                store.source_downloads.close(); store.pdf_downloads.close(); store.imports.close()


if __name__ == '__main__':
    unittest.main()
