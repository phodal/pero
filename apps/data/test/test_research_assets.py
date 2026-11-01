"""Synthetic bytes through the real Data catalog/downloader; no Internet or AI."""
import hashlib
import io
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from catalog import Catalog
from downloads import Downloads
from research_assets import HubReference, ResearchAssets, files_at_revision

SHA = 'a' * 40
PAYLOAD = b'synthetic model file; never deserialized\n'
REFERENCE = {'kind': 'model', 'repoId': 'example/forecast', 'revision': SHA,
             'sourceUrl': 'https://huggingface.co/example/forecast'}


def metadata(reference):
    return {'sha': reference.revision, 'cardData': {'license': 'Apache-2.0'}, 'siblings': [
        {'rfilename': 'weights.safetensors', 'size': len(PAYLOAD),
         'lfs': {'sha256': hashlib.sha256(PAYLOAD).hexdigest(), 'size': len(PAYLOAD)}},
        {'rfilename': 'config.json', 'size': len(b'{}'),
         'blobId': hashlib.sha1(b'blob 2\0{}').hexdigest()},
    ]}


class ResearchAssetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.opened = []
        def open_bytes(source):
            self.opened.append(source.id)
            return io.BytesIO(b'{}' if source.filename == 'config.json' else PAYLOAD)
        self.downloads = Downloads(Catalog(self.temp.name), sources=(), opener=open_bytes)
        self.addCleanup(self.downloads.close)
        self.assets = ResearchAssets(self.downloads, metadata)

    def prepare(self):
        return self.assets.command({'action': 'prepare', 'resources': [REFERENCE]})

    def finish(self):
        self.downloads.thread.join(timeout=3)
        self.assertFalse(self.downloads.thread.is_alive(), 'The bounded synthetic download did not finish')
        return self.downloads.state()

    def test_prepare_is_metadata_only_and_never_accepts_arbitrary_urls(self):
        result = self.prepare()
        self.assertEqual(len(result['sources']), 2)
        self.assertEqual(self.opened, [])
        self.assertEqual(self.downloads.sources, ())
        self.assertEqual(self.downloads.catalog.listing(), [])
        source = result['sources'][0]
        self.assertNotIn('url', source)
        self.assertNotIn('hosts', source)
        for change in ({'sourceUrl': 'https://internal.example/file'}, {'revision': 'main'},
                       {'repoId': '../anything'}, {'kind': 'service'}, {'url': 'https://evil.example'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.assets.command({'action': 'prepare', 'resources': [{**REFERENCE, **change}]})

    def test_explicit_confirmation_and_unknown_ids(self):
        identity = self.prepare()['sources'][0]['id']
        for confirm in (False, None, 1, 'true'):
            with self.subTest(confirm=confirm), self.assertRaises(ValueError):
                self.assets.command({'action': 'download', 'sourceId': identity, 'confirm': confirm})
        with self.assertRaises(ValueError):
            self.assets.command({'action': 'download', 'sourceId': 'unknown', 'confirm': True})
        self.assertEqual(self.opened, [])

    def test_real_publication_sha256_and_git_object_checksums(self):
        for source in self.prepare()['sources']:
            self.assets.command({'action': 'download', 'sourceId': source['id'], 'confirm': True})
            state = self.finish()
            self.assertEqual(state['download']['status'], 'completed')
        saved = self.downloads.catalog.listing()
        self.assertEqual(len(saved), 2)
        for asset in saved:
            data = Path(asset['location']).read_bytes()
            self.assertEqual(asset['sha256'], hashlib.sha256(data).hexdigest())
            self.assertTrue(asset['localAvailable'])
            self.assertEqual(asset['revision'], SHA)
        self.assertEqual(list(Path(self.temp.name).glob('*.part')), [])

    def test_replay_and_restart_do_not_repeat_completed_downloads(self):
        source = self.prepare()['sources'][0]
        command = {'action': 'download', 'sourceId': source['id'], 'confirm': True}
        self.assets.command(command)
        self.finish()
        self.assertEqual(self.assets.command(command)['status'], 'already-local')
        restarted_downloads = Downloads(Catalog(self.temp.name), sources=(),
                                        opener=lambda source: self.fail('Completed bytes must be reused'))
        self.addCleanup(restarted_downloads.close)
        restarted = ResearchAssets(restarted_downloads, metadata)
        self.assertEqual(restarted.command(command)['status'], 'already-local')
        self.assertEqual(len(self.opened), 1)
        self.assertEqual(len(restarted.command({'action': 'status'})['assets']), 1)

    def test_bad_bytes_never_publish_an_asset(self):
        source = self.prepare()['sources'][0]
        for payload in (PAYLOAD[:-1], b'x' * len(PAYLOAD), PAYLOAD + b'extra'):
            with self.subTest(payload=payload):
                self.downloads.opener = lambda source: io.BytesIO(payload)
                self.assets.command({'action': 'download', 'sourceId': source['id'], 'confirm': True})
                state = self.finish()
                self.assertEqual(state['download']['status'], 'failed')
                self.assertEqual(state['assets'], [])
                self.assertEqual(list(Path(self.temp.name).glob('*.part')), [])

    def test_cancel_and_inflight_replay_use_existing_job(self):
        started, release = threading.Event(), threading.Event()
        class Controlled(io.BytesIO):
            def read(self, size=-1):
                started.set()
                if not release.wait(timeout=3):
                    raise OSError('Test stream was not released')
                return super().read(size)
        self.downloads.opener = lambda source: Controlled(PAYLOAD)
        source = self.prepare()['sources'][0]
        command = {'action': 'download', 'sourceId': source['id'], 'confirm': True}
        first = self.assets.command(command)['download']['id']
        try:
            self.assertTrue(started.wait(timeout=3))
            self.assertEqual(self.assets.command(command)['download']['id'], first)
            self.assets.command({'action': 'cancel'})
        finally:
            release.set()
        state = self.finish()
        self.assertEqual(state['download']['status'], 'cancelled')
        self.assertEqual(state['assets'], [])
        self.assertEqual(list(Path(self.temp.name).glob('*.part')), [])

    def test_unavailable_metadata_is_a_partial_result_not_permission(self):
        self.assets.metadata = lambda reference: {**metadata(reference), 'gated': True}
        result = self.prepare()
        self.assertEqual(result['status'], 'blocked')
        self.assertTrue(result['warnings'])
        self.assertEqual(result['sources'], [])
        self.assertEqual(self.downloads.sources, ())

    def test_revision_and_file_admission(self):
        reference = HubReference.parse(REFERENCE)
        data = metadata(reference)
        with self.assertRaises(ValueError):
            files_at_revision(reference, {**data, 'sha': 'b' * 40})
        invalid = [dict(data['siblings'][0], rfilename='../outside'),
                   dict(data['siblings'][0], size=None),
                   dict(data['siblings'][0], lfs={'sha256': 'not-a-hash'}),
                   dict(data['siblings'][0], size=21 * 1024**3)]
        sources, warnings = files_at_revision(reference, {**data, 'cardData': {}, 'siblings': invalid})
        self.assertEqual(sources, ())
        self.assertEqual(len(warnings), 2)
        self.assertIn('License is unknown', warnings[1])


if __name__ == '__main__':
    unittest.main()
