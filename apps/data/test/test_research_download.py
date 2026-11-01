"""Pinned research assets use Data's existing worker; all file bytes are tiny fixtures."""
from dataclasses import asdict
import hashlib
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from catalog import Catalog
from downloads import DownloadJob, Downloads, ResearchDownload
from server import handler
from sources import HF_DOWNLOAD_HOSTS, ResearchAsset, ResearchSelection


def descriptor(content=b'opaque bytes', **changes):
    revision = 'a' * 40
    return dict(id='b' * 64, name='Small selected model', kind='model', filename='weights.bin',
                size=len(content), license='MIT', revision=revision,
                sourceUrl='https://huggingface.co/example/model',
                url=f'https://huggingface.co/example/model/resolve/{revision}/weights.bin',
                sha256=hashlib.sha256(content).hexdigest(), bundleId='c' * 64, confirmed=True) | changes


class ResearchAssetTests(unittest.TestCase):
    def test_admission_requires_confirmed_pinned_public_hf_file_metadata(self):
        valid = descriptor()
        for change in ({'confirmed': False}, {'confirmed': 'true'}, {'confirmed': None},
                       {'kind': 'code'}, {'size': True}, {'size': 0}, {'size': -1},
                       {'size': 1.2}, {'license': 'unknown'}, {'license': 'other'},
                       {'license': ''}, {'license': ' MIT '}, {'revision': 'main'},
                       {'sha256': 'missing'}, {'bundleId': '../private'}, {'id': 'x'},
                       {'name': 'a\nb'}, {'url': 'file:///etc/passwd'},
                       {'url': valid['url'].replace('https:', 'http:')},
                       {'url': valid['url'].replace('huggingface.co', 'huggingface.co.evil.test')},
                       {'url': valid['url'].replace('huggingface.co', 'user@huggingface.co')},
                       {'url': valid['url'].replace('huggingface.co', 'huggingface.co:443')},
                       {'url': valid['url'] + '?download=1'}, {'url': valid['url'] + '#fragment'},
                       {'url': valid['url'].replace('/weights.bin', '/%2e%2e/weights.bin')},
                       {'url': valid['url'].replace('/weights.bin', '/../weights.bin')},
                       {'filename': '../weights.bin'}, {'filename': 'different.bin'},
                       {'sourceUrl': 'https://huggingface.co/example/another'},
                       {'sourceUrl': valid['sourceUrl'] + '/'}, {'hosts': ['evil.test']}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                ResearchAsset.parse(valid | change)
        model = ResearchAsset.parse(valid).source
        self.assertEqual(model.hosts, HF_DOWNLOAD_HOSTS)
        self.assertEqual(model.public()['bundleId'], valid['bundleId'])
        self.assertNotIn('hosts', model.public())
        dataset = ResearchAsset.parse(valid | dict(kind='dataset',
            sourceUrl='https://huggingface.co/datasets/example/data',
            url=f"https://huggingface.co/datasets/example/data/resolve/{valid['revision']}/train/weights.bin"))
        self.assertEqual(dataset.source.kind, 'dataset')

    def test_scope_selects_only_requested_bundle_and_optional_asset(self):
        source = ResearchAsset.parse(descriptor()).source
        for value, accepted in (({'bundleId': source.bundleId}, True),
                                ({'bundleId': source.bundleId, 'assetId': source.id}, True),
                                ({'bundleId': 'd' * 64}, False),
                                ({'bundleId': source.bundleId, 'assetId': 'd' * 64}, False)):
            self.assertEqual(ResearchSelection.parse(value).contains(source), accepted)
        for value in ({}, {'bundleId': 'not-a-bundle'}, {'bundleId': source.bundleId, 'assetId': '../x'},
                      {'bundleId': source.bundleId, 'url': 'https://example.test'}, []):
            with self.subTest(value=value), self.assertRaises(ValueError):
                ResearchSelection.parse(value)


class ResearchDownloadTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)
        self.catalog = Catalog(self.home.name)
        self.content = b'opaque bytes'
        self.request = ResearchAsset.parse(descriptor(self.content))
        self.scope = ResearchSelection(self.request.source.bundleId, self.request.source.id)

    def join(self, downloads):
        downloads.thread.join(3)
        self.assertFalse(downloads.thread.is_alive())

    def test_start_is_fast_duplicate_inflight_and_completed_starts_reuse(self):
        entered, release = threading.Event(), threading.Event()
        opens = []
        def opener(source):
            opens.append(source.url)
            entered.set()
            if not release.wait(3):
                raise TimeoutError('Fixture source was not released')
            return io.BytesIO(self.content)
        downloads = Downloads(self.catalog, opener=opener)
        initial = downloads.start_research(self.request)
        self.assertEqual(initial['download']['status'], 'running')
        self.assertTrue(entered.wait(3))
        duplicate = downloads.start_research(self.request)
        self.assertEqual(initial['receipt']['jobId'], duplicate['receipt']['jobId'])
        release.set()
        self.join(downloads)
        completed = downloads.start_research(self.request)
        self.assertEqual(completed['download']['status'], 'completed')
        self.assertTrue(completed['receipt']['reused'])
        self.assertEqual(len(opens), 1)
        self.assertEqual(len(self.catalog.listing()), 1)
        self.assertNotIn('location', completed['asset'])
        self.assertEqual(completed['asset']['bundleId'], self.scope.bundleId)
        self.assertEqual(completed['asset']['revision'], self.request.source.revision)
        self.assertEqual(completed['asset']['sha256'], hashlib.sha256(self.content).hexdigest())
        self.assertEqual(list(Path(self.home.name).glob('*.part')), [])
        reopened = Downloads(Catalog(self.home.name), opener=lambda _: self.fail('Should reuse catalog'))
        self.assertEqual(reopened.research_state(self.scope)['receipt'], completed['receipt'])
        reused = reopened.start_research(ResearchAsset.parse(descriptor(bundleId='d' * 64)))
        self.assertEqual(reused['receipt']['catalogAssetId'], completed['receipt']['catalogAssetId'])
        self.assertEqual(reused['receipt']['bundleId'], 'd' * 64)

    def test_status_and_cancel_are_scoped_and_do_not_start_a_download(self):
        entered, release = threading.Event(), threading.Event()
        class Blocking(io.BytesIO):
            def read(stream, size):
                entered.set()
                if not release.wait(3):
                    raise TimeoutError('Fixture source was not released')
                return super().read(size)
        downloads = Downloads(self.catalog, opener=lambda _: Blocking(self.content))
        self.assertIsNone(downloads.research_state(self.scope)['download'])
        self.assertIsNone(downloads.thread)
        started = downloads.start_research(self.request)
        self.assertTrue(entered.wait(3))
        for unrelated in (ResearchSelection('d' * 64, self.scope.assetId),
                          ResearchSelection(self.scope.bundleId, 'd' * 64)):
            self.assertIsNone(downloads.research_state(unrelated, cancel=True)['download'])
            self.assertFalse(downloads.cancelled.is_set())
        matching = downloads.research_state(self.scope, cancel=True)
        self.assertEqual(matching['receipt']['jobId'], started['receipt']['jobId'])
        self.assertTrue(downloads.cancelled.is_set())
        release.set()
        self.join(downloads)
        self.assertEqual(downloads.research_state(self.scope)['download']['status'], 'cancelled')
        self.assertEqual(self.catalog.listing(), [])
        self.assertEqual(list(Path(self.home.name).glob('*.part')), [])

    def test_byte_and_checksum_failures_preserve_reference_receipt(self):
        for content in (b'bad', b'x' * len(self.content), self.content + b'overflow'):
            with self.subTest(content=content):
                downloads = Downloads(self.catalog, opener=lambda _: io.BytesIO(content))
                downloads.start_research(self.request)
                self.join(downloads)
                receipt = downloads.research_state(self.scope)
                self.assertEqual(receipt['download']['status'], 'failed')
                self.assertEqual(receipt['source']['sourceUrl'], self.request.source.sourceUrl)
                self.assertIsNone(receipt['asset'])
                self.assertEqual(self.catalog.listing(), [])
                self.assertEqual(list(Path(self.home.name).glob('*.part')), [])

    def test_interrupted_receipt_restores_and_never_auto_restarts(self):
        job = DownloadJob('fixture', self.scope.assetId, 'running', 1, len(self.content))
        self.catalog.atomic('download.json', job.to_dict())
        self.catalog.atomic('research-downloads.json', [asdict(ResearchDownload(self.request.source, job))])
        (self.catalog.directory / 'fixture.part').write_bytes(b'a')
        downloads = Downloads(self.catalog, opener=lambda _: self.fail('No automatic download'))
        self.assertEqual(downloads.research_state(self.scope)['download']['status'], 'interrupted')
        self.assertIsNone(downloads.thread)
        self.assertEqual(list(Path(self.home.name).glob('*.part')), [])

    def test_handoff_persistence_failure_has_no_network_effect(self):
        downloads = Downloads(self.catalog, opener=lambda _: self.fail('Persistence must precede network'))
        with patch.object(self.catalog, 'atomic', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                downloads.start_research(self.request)
        self.assertIsNone(downloads.thread)
        self.assertIsNone(downloads.research_state(self.scope)['download'])

    def test_identity_change_cannot_replace_saved_source(self):
        downloads = Downloads(self.catalog, opener=lambda _: io.BytesIO(self.content))
        downloads.start_research(self.request)
        self.join(downloads)
        changed = ResearchAsset.parse(descriptor(license='Apache-2.0'))
        with self.assertRaisesRegex(ValueError, 'identity cannot change'):
            downloads.start_research(changed)
        self.assertEqual(downloads.research_state(self.scope)['source']['license'], 'MIT')

    def test_legacy_verified_catalog_asset_is_reused_without_download(self):
        source = self.request.source
        part = self.catalog.directory / 'legacy.part'
        part.write_bytes(self.content)
        original = self.catalog.publish(part, source.filename, source.kind, source.sourceUrl,
                                        source.revision, source.license)
        downloads = Downloads(self.catalog, opener=lambda _: self.fail('Existing pinned asset must be reused'))
        receipt = downloads.start_research(self.request)
        self.assertTrue(receipt['receipt']['reused'])
        self.assertEqual(receipt['receipt']['catalogAssetId'], original.id)
        self.assertIsNone(downloads.thread)

    def test_worker_start_failure_is_recorded_and_explicit_retry_can_recover(self):
        downloads = Downloads(self.catalog, opener=lambda _: io.BytesIO(self.content))
        with patch.object(threading.Thread, 'start', side_effect=RuntimeError('no worker')):
            with self.assertRaisesRegex(ValueError, 'worker could not start'):
                downloads.start_research(self.request)
        failed = downloads.research_state(self.scope)
        self.assertEqual(failed['download']['status'], 'failed')
        self.assertTrue(failed['receipt']['retryable'])
        self.assertEqual(Downloads(Catalog(self.home.name)).research_state(self.scope)['download']['status'], 'failed')
        recovered = downloads.start_research(self.request)
        self.assertNotEqual(recovered['receipt']['jobId'], failed['receipt']['jobId'])
        self.join(downloads)
        self.assertEqual(downloads.research_state(self.scope)['download']['status'], 'completed')
        self.assertFalse(downloads.research_state(self.scope)['receipt']['retryable'])

    def test_authenticated_routes_return_receipts_not_entire_catalog(self):
        downloads = Downloads(self.catalog, opener=lambda _: io.BytesIO(self.content))
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(downloads, 'fixture-token'))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            def request(path, value, token='fixture-token'):
                connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                connection.request('POST', path, json.dumps(value),
                                   {'Content-Type': 'application/json', 'X-Pero-App-Token': token})
                response = connection.getresponse()
                result = response.status, json.loads(response.read())
                connection.close()
                return result
            for path in ('/api/research-download', '/api/research-status', '/api/research-cancel'):
                self.assertEqual(request(path, {}, token='wrong')[0], 401)
            self.assertEqual(request('/api/research-download', descriptor(confirmed=False))[0], 400)
            status, initial = request('/api/research-download', descriptor())
            self.assertEqual(status, 200)
            self.assertEqual(initial['receipt']['bundleId'], self.scope.bundleId)
            self.join(downloads)
            status, receipt = request('/api/research-status', asdict(self.scope))
            self.assertEqual((status, receipt['download']['status']), (200, 'completed'))
            self.assertNotIn('location', json.dumps(receipt))
            self.assertEqual(request('/api/research-cancel', {'bundleId': 'd' * 64})[1]['assets'], [])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(3)
            downloads.close()


if __name__ == '__main__':
    unittest.main()
