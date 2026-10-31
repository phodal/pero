import base64
from dataclasses import replace
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from catalog import Catalog, IMPORT_LIMIT, ImportFile
from downloads import Downloads, require_url
from sources import Checksum, SOURCES


class DataTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)
        self.catalog = Catalog(self.home.name)

    def source(self, content=b'opaque model bytes'):
        return replace(SOURCES[1], size=len(content), checksums=(Checksum('sha256', hashlib.sha256(content).hexdigest(), 'test'),))

    def run_download(self, content, source=None):
        downloads = Downloads(self.catalog, (source or self.source(content),), lambda _: io.BytesIO(content))
        downloads.start(downloads.sources[0].id)
        downloads.thread.join(3)
        self.assertFalse(downloads.thread.is_alive())
        return downloads

    def test_import_persists_opaque_model_and_digest(self):
        content = b'\x80\x04not a safe pickle; never interpreted'
        request = ImportFile.parse(dict(name='weights.model', kind='model', content=base64.b64encode(content).decode()))
        asset = self.catalog.import_file(request)
        reopened = Catalog(self.home.name)
        self.assertEqual(reopened.listing()[0]['sha256'], hashlib.sha256(content).hexdigest())
        self.assertEqual((reopened.files / asset.id).read_bytes(), content)
        self.assertEqual(reopened.listing()[0]['kind'], 'model')
        self.assertTrue(reopened.listing()[0]['localAvailable'])
        location = Path(reopened.listing()[0]['location'])
        self.assertEqual(location, reopened.files / asset.id)
        self.assertTrue(location.is_relative_to(Path(self.home.name).resolve()))
        location.unlink()
        self.assertFalse(reopened.listing()[0]['localAvailable'])
        self.assertEqual(reopened.listing()[0]['location'], str(location))

    def test_utf8_catalog_and_job_reopen_with_non_utf8_default(self):
        request = ImportFile.parse(dict(name='温度.csv', kind='dataset', source='实验室',
                                        content='YQ=='))
        self.catalog.import_file(request)
        self.catalog.atomic('download.json', dict(status='failed', error='网络不可用'))
        original = Path.read_text
        def locale_read(path, encoding=None, errors=None):
            return original(path, encoding=encoding or 'ascii', errors=errors)
        with patch.object(Path, 'read_text', locale_read):
            reopened = Catalog(self.home.name)
            state = Downloads(reopened).state()
        self.assertEqual(state['assets'][0]['name'], '温度.csv')
        self.assertEqual(state['assets'][0]['source'], '实验室')
        self.assertEqual(state['download']['error'], '网络不可用')

    def test_failed_persistence_never_publishes_asset_or_running_job(self):
        downloads = Downloads(self.catalog)
        request = ImportFile.parse(dict(name='test.csv', kind='dataset', content='YQ=='))
        with patch.object(self.catalog, 'atomic', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.catalog.import_file(request)
            with self.assertRaises(OSError):
                downloads.start(SOURCES[0].id)
        self.assertEqual(self.catalog.listing(), [])
        self.assertEqual(list(self.catalog.files.iterdir()), [])
        self.assertIsNone(downloads.state()['download'])
        self.assertIsNone(downloads.thread)
        self.assertEqual(Catalog(self.home.name).listing(), [])

    def test_failed_worker_start_is_terminal_and_persisted(self):
        downloads = Downloads(self.catalog)
        with patch.object(threading.Thread, 'start', side_effect=RuntimeError('no threads')):
            with self.assertRaisesRegex(ValueError, 'worker could not start'):
                downloads.start(SOURCES[0].id)
        downloads.close()
        self.assertEqual(downloads.state()['download']['status'], 'failed')
        self.assertEqual(Downloads(Catalog(self.home.name)).state()['download']['status'], 'failed')
        self.assertEqual(self.catalog.listing(), [])

    def test_import_rejects_paths_encoding_empty_and_bounds(self):
        valid = dict(name='a.csv', kind='dataset', content='YQ==')
        for change in ({'name': '../secret'}, {'name': '/tmp/secret'}, {'name': 'C:\\a'},
                       {'kind': 'code'}, {'content': '%%%bad'}, {'content': ''},
                       {'content': 'a' * (((IMPORT_LIMIT + 2) // 3) * 4 + 1)}, {'path': '/etc/passwd'}):
            with self.subTest(change=list(change)):
                with self.assertRaises(ValueError):
                    ImportFile.parse(valid | change)
        self.assertEqual(self.catalog.listing(), [])

    def test_download_publishes_only_complete_checksum_matched_bytes(self):
        content = b'small test content'
        downloads = self.run_download(content)
        self.assertEqual(downloads.state()['download']['status'], 'completed')
        asset = downloads.state()['assets'][0]
        self.assertEqual(asset['size'], len(content))
        self.assertEqual(asset['checksums'][0]['provenance'], 'test')
        self.assertEqual(asset['revision'], SOURCES[1].revision)
        self.assertEqual(list(Path(self.home.name).glob('*.part')), [])

    def test_size_and_hash_failures_never_publish(self):
        for content, source in ((b'changed', self.source(b'original')), (b'a', self.source(b'aa')),
                                (b'oversized', self.source(b'a')), (b'same-size', self.source(b'different'))):
            with self.subTest(content=content):
                downloads = self.run_download(content, source)
                self.assertEqual(downloads.state()['download']['status'], 'failed')
                self.assertEqual(self.catalog.listing(), [])
                self.assertEqual(list(Path(self.home.name).glob('*.part')), [])

    def test_cancel_and_single_active_job(self):
        entered, release = threading.Event(), threading.Event()
        class BlockingStream(io.BytesIO):
            def read(self, size):
                entered.set()
                if not release.wait(3):
                    raise TimeoutError('Test failed to release reader')
                return super().read(size)
        downloads = Downloads(self.catalog, (self.source(b'abc'),), lambda _: BlockingStream(b'abc'))
        downloads.start(downloads.sources[0].id)
        self.assertTrue(entered.wait(3))
        with self.assertRaises(ValueError):
            downloads.start(downloads.sources[0].id)
        downloads.cancel()
        release.set()
        downloads.thread.join(3)
        self.assertFalse(downloads.thread.is_alive())
        self.assertEqual(downloads.state()['download']['status'], 'cancelled')
        self.assertEqual(self.catalog.listing(), [])

    def test_restart_marks_interrupted_and_discards_partial(self):
        self.catalog.atomic('download.json', dict(status='running', id='abc', sourceId='test', received=1, total=3))
        (Path(self.home.name) / 'abc.part').write_bytes(b'a')
        downloads = Downloads(Catalog(self.home.name))
        self.assertEqual(downloads.state()['download']['status'], 'interrupted')
        self.assertEqual(list(Path(self.home.name).glob('*.part')), [])
        self.assertEqual(json.loads((Path(self.home.name) / 'download.json').read_text())['status'], 'interrupted')

    def test_fixed_sources_and_trusted_https_redirects(self):
        with self.assertRaises(ValueError):
            Downloads(self.catalog).start('https://example.org/model')
        for url in ('http://zenodo.org/file', 'https://evil.example/file', 'file:///etc/passwd',
                    'https://user:password@zenodo.org/file', 'https://zenodo.org:8443/file'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                require_url(url, ('zenodo.org',))
        require_url('https://zenodo.org/file', ('zenodo.org',))
        # Observed pinned-file HEAD redirect, still an exact host allowlist.
        require_url('https://us.aws.cdn.hf.co/xet-bridge-us/file?signature=test', SOURCES[1].hosts)
        for url in ('http://us.aws.cdn.hf.co/file', 'https://us.aws.cdn.hf.co:8443/file',
                    'https://untrusted.cdn.hf.co/file', 'https://us.aws.cdn.hf.co.evil.example/file'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                require_url(url, SOURCES[1].hosts)


if __name__ == '__main__':
    unittest.main()
