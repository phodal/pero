"""Offline source discovery over real approved source records and file copies."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from test_source_archives import TEX, archive_bytes
from test_source_downloads import SourceDownloads, SourceTransport, bundle, finish
from paper_agent.model import digest
from paper_agent.store import ResearchStore

LOCATOR = Path(__file__).resolve().parents[1] / 'tools/locate-source.py'


class SourceLocationsTest(unittest.TestCase):
    def test_locate_approved_version_and_reject_unverified_copies(self):
        data = archive_bytes([('paper/main.tex', TEX.encode()), ('plot.pdf', b'%PDF-synthetic-asset')])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'app-data'
            exports = Path(directory) / 'copies'
            store = ResearchStore(root)
            selected, _ = bundle(store)
            store.source_downloads = SourceDownloads(store, SourceTransport(data))
            store.source_downloads.request(dict(operation='start', **selected))
            self.assertEqual(finish(store.source_downloads, selected)['status'], 'source_available')

            def locate(identifier='2610.24806v1'):
                result = subprocess.run([sys.executable, '-I', '-B', str(LOCATOR), '--arxiv', identifier,
                    '--cache', str(store.root), '--paper-dir', str(exports)],
                    capture_output=True, text=True, cwd=directory, timeout=10)
                return result.returncode, json.loads(result.stdout)

            before = {p: p.read_bytes() for p in store.root.rglob('*') if p.is_file()}
            code, found = locate()
            self.assertEqual(code, 0, found)
            self.assertFalse(exports.exists(), 'Discovery must not create the export directory')
            source = found['sources'][0]
            self.assertEqual((source['bundleId'], source['resourceId']), (selected['bundleId'], selected['resourceId']))
            main = next(m for m in source['members'] if m['main'])
            self.assertEqual(main['path'], 'paper/main.tex')
            self.assertEqual(Path(main['localPath']).read_text(), TEX)
            self.assertEqual(source['archiveDigest'], digest(data))
            self.assertFalse(next(m for m in source['members'] if m['path'] == 'plot.pdf')['imageAvailable'])
            self.assertEqual({p: p.read_bytes() for p in store.root.rglob('*') if p.is_file()}, before)

            exports.mkdir()
            copy = exports / '2610.24806-src.tar.gz'
            copy.write_bytes(data)
            self.assertTrue(locate()[1]['exportCopies'][0]['matchesApprovedArchive'])
            code, wrong = locate('2610.24806v2')
            self.assertEqual(code, 4)
            self.assertEqual(wrong['sources'], [])
            self.assertFalse(wrong['exportCopies'][0]['matchesApprovedArchive'])
            self.assertEqual(locate('2610.24806')[0], 2)

            Path(main['localPath']).write_bytes(b'changed original')
            code, missing = locate()
            self.assertEqual(code, 4)
            self.assertFalse(missing['sources'][0]['available'])
            self.assertFalse(missing['exportCopies'][0]['matchesApprovedArchive'])
            self.assertEqual(Path(main['localPath']).read_bytes(), b'changed original', 'Lookup must not restore or replace source bytes')
