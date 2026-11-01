"""Source-only acquisition, immutable original lines, and exact PDF comparisons."""
from dataclasses import dataclass
import multiprocessing
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.model import Invalid, digest
from paper_agent.pdf_downloads import PdfDownloads
from paper_agent.research_resources import ImportDraft, ResearchResource
from paper_agent.resource_fetch import SourceResponse
from paper_agent.source_downloads import SourceDownloads
from paper_agent.source_reading import source_read, source_image
from paper_agent.store import ResearchStore
from test_source_archives import TEX, archive_bytes
from test_pdf_downloads import PdfTransport, finish
from test_pdf import pdf_fixture

NOW = '2026-11-01T00:00:00Z'
SEED = 'https://research.example/source'
SOURCE = 'https://arxiv.org/src/2610.24806v1'


@dataclass
class SourceTransport:
    data: bytes
    entered: object = None
    release: object = None
    denied: bool = False

    def fetch_source(self, url):
        if self.entered is not None:
            self.entered.set()
        if self.release is not None:
            self.release.wait()
        if self.denied:
            raise Invalid('Source unavailable (HTTP 403)', 403)
        return SourceResponse(url, self.data, 'application/gzip')


def bundle(store, approved=True, source_url=SOURCE):
    source = ResearchResource.linked(source_url, SEED, 'Source')
    pdf = ResearchResource.linked('https://arxiv.org/pdf/2610.24806v1', SEED, 'PDF')
    draft = ImportDraft.create(SEED, NOW).finish((source, pdf), ())
    store.imports._replace('import-drafts', draft.id, draft.to_dict())
    result = store.imports.commit(dict(draftId=draft.id, resourceIds=[source.id, pdf.id], sourceIds=[source.id] if approved else [],
                                      pdfIds=[pdf.id], confirmedDownloads=True), NOW)
    return dict(bundleId=result.id, resourceId=source.id), pdf


class SourceDownloadTest(unittest.TestCase):
    def test_source_only_cache_lines_and_literal_comparison(self):
        text = TEX.replace('Synthetic source figure.', 'First page. Exact original evidence.')
        data = archive_bytes([('main.tex', text.encode())])
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            selection, pdf = bundle(store, False)
            with self.assertRaises(Invalid):
                store.source_downloads.request(dict(operation='start', **selection))
            selection, pdf = bundle(store)
            downloads = SourceDownloads(store, SourceTransport(data))
            store.source_downloads = downloads
            downloads.request(dict(operation='start', **selection))
            result = finish(downloads, selection)
            self.assertEqual(result['status'], 'source_available', result)
            self.assertEqual(store._list('pdfs'), [])
            listing = source_read(store, dict(operation='list', **selection))
            member = listing['members'][0]
            observed = source_read(store, dict(operation='read', **selection, memberId=member['id'], start=0))
            self.assertEqual(observed['content'], text)
            self.assertEqual(observed['memberDigest'], digest(text.encode()))
            self.assertEqual(observed['archiveDigest'], digest(data))
            # Cached start never calls an intentionally failing transport.
            downloads.transport = SourceTransport(b'bad', denied=True)
            self.assertEqual(downloads.request(dict(operation='start', **selection))['receipt'], result['receipt'])
            compare = dict(operation='compare', **selection, pdfResourceId=pdf.id)
            self.assertEqual(source_read(store, compare)['status'], 'unresolved')
            store.pdf_downloads = PdfDownloads(store, PdfTransport(pdf_fixture()))
            pdf_selection = dict(bundleId=selection['bundleId'], resourceId=pdf.id)
            store.pdf_downloads.request(dict(operation='start', **pdf_selection))
            saved = finish(store.pdf_downloads, pdf_selection)
            matches = source_read(store, compare)['matches']
            self.assertEqual(len(matches), 1)
            self.assertEqual(matches[0]['pdf']['documentId'], saved['receipt']['documentId'])
            self.assertEqual(matches[0]['pdf']['page'], 1)
            self.assertEqual(matches[0]['pdf']['quote'], 'First page. Exact original evidence.')
            # Explicit missing archive restores only its original bytes, not changed source.
            path = store.root / 'source-files' / (digest(data) + '.bin')
            path.unlink()
            store.source_downloads = SourceDownloads(store, SourceTransport(archive_bytes([('main.tex', b'\\documentclass{changed}')])) )
            self.assertEqual(store.source_downloads.request(dict(operation='status', **selection))['status'], 'unavailable')
            store.source_downloads.request(dict(operation='start', **selection))
            failed = finish(store.source_downloads, selection)
            self.assertEqual(failed['status'], 'failed')
            self.assertEqual(failed['receipt'], result['receipt'])
            store.source_downloads.transport = SourceTransport(data)
            store.source_downloads.request(dict(operation='start', **selection))
            self.assertEqual(finish(store.source_downloads, selection)['status'], 'source_available')
            self.assertEqual(path.read_bytes(), data)

    def test_authorized_image_envelope_over_http_and_tamper_rejection(self):
        import base64
        from http.client import HTTPConnection
        from http.server import ThreadingHTTPServer
        import io
        import json
        import threading
        from PIL import Image
        from paper_agent.http import handler
        output = io.BytesIO()
        with Image.new('RGB', (12, 8), 'blue') as image:
            image.save(output, format='PNG')
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            selection, _ = bundle(store)
            store.source_downloads = SourceDownloads(store, SourceTransport(archive_bytes([('main.tex', TEX.encode()), ('plot.png', output.getvalue())])))
            store.source_downloads.request(dict(operation='start', **selection))
            self.assertEqual(finish(store.source_downloads, selection)['status'], 'source_available')
            listing = source_read(store, dict(operation='list', **selection))
            member = next(m for m in listing['members'] if m['path'] == 'plot.png')
            # Simulate an index written before original/preview dimensions split.
            index_path = store.root / 'source-archives' / (listing['receipt']['archiveDigest'] + '.json')
            legacy_index = json.loads(index_path.read_bytes())
            for old_member in legacy_index['members']:
                for field in ('originalWidth', 'originalHeight', 'previewWidth', 'previewHeight'):
                    old_member.pop(field, None)
            index_path.write_text(json.dumps(legacy_index))
            request = dict(operation='image', **selection, memberId=member['id'])
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(store, 'synthetic-token'))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                connection.request('POST', '/api/research/source-read', json.dumps(request), {'Content-Type': 'application/json', 'X-Pero-App-Token': 'synthetic-token'})
                response = connection.getresponse()
                envelope = json.loads(response.read())
                connection.close()
                self.assertEqual(response.status, 200, envelope)
                self.assertEqual(set(envelope), {'type', 'mimeType', 'data', 'provenance'})
                self.assertEqual(envelope['type'], 'source_image')
                preview = base64.b64decode(envelope['data'], validate=True)
                proof = envelope['provenance']
                self.assertEqual(proof['previewSha256'], digest(preview))
                self.assertEqual(proof['originalSha256'], digest(output.getvalue()))
                self.assertEqual((proof['width'], proof['height']), (12, 8))
                self.assertEqual(source_image(store, proof['archiveDigest'], member['id']), preview)
                with self.assertRaises(Invalid):
                    source_read(store, {**request, 'resourceId': 'a' * 64})
                path = store.root / 'source-previews' / (member['id'] + '.png')
                receipt = store.source_downloads.request(dict(operation='status', **selection))['receipt']
                path.unlink()
                self.assertEqual(store.source_downloads.request(dict(operation='status', **selection))['status'], 'unavailable')
                with self.assertRaisesRegex(Invalid, 'unavailable'):
                    source_read(store, request)
                # A transport that always fails proves derived-only repair is local.
                network_called = multiprocessing.get_context('spawn').Event()
                store.source_downloads.transport = SourceTransport(b'no network allowed', entered=network_called, denied=True)
                store.source_downloads.request(dict(operation='start', **selection))
                restored = finish(store.source_downloads, selection)
                self.assertEqual(restored['status'], 'source_available')
                self.assertTrue(restored['previewRebuiltAt'])
                self.assertFalse(network_called.is_set())
                self.assertEqual(restored['receipt'], receipt)
                self.assertEqual(json.loads(index_path.read_bytes()), legacy_index)
                old_member = next(m for m in source_read(store, dict(operation='list', **selection))['members'] if m['id'] == member['id'])
                self.assertIsNone(old_member['originalWidth'])
                self.assertIsNone(old_member['originalHeight'])
                self.assertEqual((old_member['previewWidth'], old_member['previewHeight']), (12, 8))
                self.assertEqual(path.read_bytes(), preview)
                path.write_bytes(bytes([preview[0] ^ 1]) + preview[1:])
                with self.assertRaisesRegex(Invalid, 'unavailable'):
                    source_read(store, request)
                store.source_downloads.request(dict(operation='start', **selection))
                repaired = finish(store.source_downloads, selection)
                self.assertEqual(repaired['status'], 'source_available')
                self.assertEqual(repaired['receipt'], receipt)
                self.assertFalse(network_called.is_set())
                self.assertEqual(path.read_bytes(), preview)
                original = store.root / 'source-members' / (member['sha256'] + '.bin')
                original.write_bytes(b'corrupt original')
                with self.assertRaisesRegex(Invalid, 'unavailable'):
                    source_read(store, request)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)

    def test_same_size_tampering_restores_expected_bytes_and_status_caches_hashes(self):
        import io
        import os
        from PIL import Image
        from unittest.mock import patch
        image_data = io.BytesIO()
        with Image.new('RGB', (12, 8), 'red') as image:
            image.save(image_data, format='PNG')
        data = archive_bytes([('main.tex', TEX.encode()), ('plot.png', image_data.getvalue())])
        for kind in ('archive', 'member', 'preview'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as root:
                store = ResearchStore(root)
                selection, _ = bundle(store)
                downloads = SourceDownloads(store, SourceTransport(data))
                store.source_downloads = downloads
                downloads.request(dict(operation='start', **selection))
                initial = finish(downloads, selection)
                receipt = initial['receipt']
                listing = source_read(store, dict(operation='list', **selection))
                member = next(m for m in listing['members'] if m['path'] == 'main.tex')
                picture = next(m for m in listing['members'] if m['path'] == 'plot.png')
                path = {'archive': store.root / 'source-files' / (receipt['archiveDigest'] + '.bin'),
                        'member': store.root / 'source-members' / (member['sha256'] + '.bin'),
                        'preview': store.root / 'source-previews' / (picture['id'] + '.png')}[kind]
                observed, original = path.stat(), path.read_bytes()
                path.write_bytes(bytes([original[0] ^ 1]) + original[1:])
                os.utime(path, ns=(observed.st_atime_ns, observed.st_mtime_ns))
                # Both an existing fingerprint and a fresh restarted process detect corruption.
                self.assertEqual(downloads.request(dict(operation='status', **selection))['status'], 'unavailable')
                store = ResearchStore(root)
                network_called = multiprocessing.get_context('spawn').Event()
                downloads = SourceDownloads(store, SourceTransport(data, entered=network_called, denied=kind != 'archive'))
                store.source_downloads = downloads
                self.assertEqual(downloads.request(dict(operation='status', **selection))['status'], 'unavailable')
                with self.assertRaisesRegex(Invalid, 'unavailable'):
                    source_read(store, dict(operation='read', **selection, memberId=member['id'], start=0))
                downloads.request(dict(operation='start', **selection))
                restored = finish(downloads, selection)
                self.assertEqual(network_called.is_set(), kind == 'archive')
                self.assertEqual(restored['status'], 'source_available', restored)
                self.assertEqual(restored['receipt'], receipt)
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual(source_read(store, dict(operation='read', **selection, memberId=member['id'], start=0))['content'], TEX)
                real_open, binary_reads = Path.open, []
                def observed_open(path, mode='r', *args, **kwargs):
                    if mode == 'rb' and path.suffix in ('.bin', '.png'):
                        binary_reads.append(path)
                    return real_open(path, mode, *args, **kwargs)
                with patch.object(Path, 'open', observed_open):
                    for _ in range(3):
                        self.assertEqual(downloads.request(dict(operation='status', **selection))['status'], 'source_available')
                self.assertEqual(binary_reads, [])

    def test_pdf_only_no_tex_denied_cancel_timeout_and_restart(self):
        ctx = multiprocessing.get_context('spawn')
        for mode, expected in (('pdf', 'pdf_only'), ('no_tex', 'no_tex'), ('denied', 'denied'), ('cancel', 'cancelled'), ('timeout', 'failed')):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as root:
                store = ResearchStore(root)
                selection, _ = bundle(store)
                entered, release = ctx.Event(), ctx.Event()
                data = b'%PDF-1.7\n' if mode == 'pdf' else archive_bytes([('readme.txt', b'No TeX supplied')])
                downloads = SourceDownloads(store, SourceTransport(data, entered, release if mode in ('cancel', 'timeout') else None, mode == 'denied'), seconds=.7 if mode == 'timeout' else 10)
                store.source_downloads = downloads
                downloads.request(dict(operation='start', **selection))
                self.assertTrue(entered.wait(timeout=3))
                if mode == 'cancel':
                    downloads.request(dict(operation='cancel', **selection))
                result = finish(downloads, selection)
                self.assertEqual(result['status'], expected, result)
                self.assertEqual(store._list('pdfs'), [])
                if expected in ('pdf_only', 'no_tex'):
                    self.assertEqual(result['receipt']['archiveDigest'], digest(data))
                    reopened = ResearchStore(root)
                    self.assertEqual(reopened.source_downloads.request(dict(operation='status', **selection))['receipt'], result['receipt'])
                else:
                    self.assertIsNone(result['receipt'])
                    self.assertEqual(store._list('source-archives'), [])


if __name__ == '__main__':
    unittest.main()
