"""Publication archive admission and an opt-in real offline compiler journey."""
import base64
from hashlib import sha256
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import scientific_block
from document import NotebookDocument
from publication_build import (PublicationArchive, PublicationBuildRequest, PublicationSource,
                               PublicationBuild, PublicationDiagnostic, PublicationResult)
from publication_compiler import PublicationBuildStore, compiler_availability


def snapshot(source):
    return json.dumps({'format': 'pero-myst-project', 'version': 1, 'entry': 'article.md',
                       'files': [{'path': 'article.md', 'text': source}]})


def archive(source='Original result', tex=r'\documentclass{article}\begin{document}Original result\end{document}', extras=()):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as value:
        for path, data in [
            ('article.tex', tex), ('source.json', json.dumps({'format': 'pero-myst', 'version': 1, 'source': source})),
            ('project.myst-project.json', snapshot(source)), ('assets.json', '[]'), ('publication-losses.json', '["Scientific content remains unverified."]'), *extras,
        ]:
            value.writestr(path, data)
    return base64.b64encode(output.getvalue()).decode()


def document(source='Original result'):
    return NotebookDocument.parse({'schemaVersion': 1, 'title': 'Publication', 'content': {'type': 'doc', 'content': [
        {'type': 'mystProject', 'attrs': {'blockId': 'manuscript', 'schemaVersion': 1, 'snapshot': snapshot(source)}},
    ]}})


class PublicationBuildTests(unittest.TestCase):
    def test_archive_boundary_and_saved_source_binding(self):
        source = PublicationSource(snapshot('Original result'), 'article.md', 'Original result')
        accepted = PublicationArchive.parse(archive())
        self.assertEqual(accepted.bind(source)[0].severity, 'warning')
        self.assertEqual(source.sha256, sha256(snapshot('Original result').encode()).hexdigest())
        invalid = [
            ('not base64', 'base64'),
            (base64.b64encode(b'not a zip').decode(), 'ZIP'),
            (archive(extras=[('../outside.tex', 'outside')]), 'unsupported'),
            (archive(extras=[('unrecorded.sty', 'outside')]), 'unsupported'),
            (archive(extras=[('article.tex', 'duplicate')]), 'duplicate'),
            (archive(extras=[('assets/image-1.png', b'a' * (8 * 1024 * 1024))]), 'expanded'),
        ]
        for encoded, message in invalid:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                PublicationArchive.parse(encoded)
        with self.assertRaisesRegex(ValueError, 'does not match'):
            accepted.bind(PublicationSource('other snapshot', 'article.md', 'Changed result'))
        with self.assertRaisesRegex(ValueError, 'complete saved project snapshot'):
            accepted.bind(PublicationSource(snapshot('Original result').replace('article.md', 'renamed.md'), 'article.md', 'Original result'))
        with self.assertRaisesRegex(ValueError, 'original entry source'):
            accepted.bind(PublicationSource(snapshot('Original result'), 'article.ipynb', '{}'))

    def test_request_and_receipt_keep_distinct_source_archive_and_pdf_identity(self):
        request = PublicationBuildRequest.parse({'revision': 3, 'blockId': 'manuscript', 'archive': archive()})
        for patch in ({'revision': True}, {'revision': 0}, {'blockId': '../file'}, {'command': 'anything'}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                PublicationBuildRequest.parse({'revision': 3, 'blockId': 'manuscript', 'archive': archive(), **patch})
        for status, pdf in [('succeeded', b'%PDF-actual'), ('failed', None), ('unavailable', None)]:
            with self.subTest(status=status):
                record = PublicationBuild('build', 'entry', request.revision, request.block_id, 'source-digest', request.archive.sha256,
                    '2026-11-13T00:00:00Z', PublicationResult(status, 'Tectonic', ('tectonic', 'article.tex'),
                        (PublicationDiagnostic('error', 'Generated source diagnostic', 'article.tex', 7),), 'retained log', pdf)).wire()
                self.assertEqual(record['sourceSha256'], 'source-digest')
                self.assertEqual(record['archiveSha256'], sha256(request.archive.raw).hexdigest())
                self.assertEqual(record['diagnostics'][0]['line'], 7)
                self.assertEqual(record.get('pdfSha256'), sha256(pdf).hexdigest() if pdf else None)

    @unittest.skipUnless(os.environ.get('NOTEBOOK_REAL_PUBLICATION') == '1', 'opt-in installed offline Tectonic')
    def test_real_compilation_failure_restart_old_versions_and_preview(self):
        from store import EntryStore
        self.assertTrue(compiler_availability()[0], compiler_availability()[1])
        with tempfile.TemporaryDirectory() as directory:
            entries = EntryStore(directory)
            entry = entries.create(document())
            builds = PublicationBuildStore(entries)
            first = builds.build(entry.identity, PublicationBuildRequest.parse({'revision': 1, 'blockId': 'manuscript', 'archive': archive()}))
            self.assertEqual(first['build']['status'], 'succeeded', first['build']['log'])
            self.assertTrue(base64.b64decode(first['pdf']).startswith(b'%PDF-'))
            self.assertIn('unverified', first['build']['diagnostics'][0]['message'])
            changed = entries.commit(entry.identity, 1, lambda _old: document('Changed result'))
            second = builds.build(entry.identity, PublicationBuildRequest.parse({'revision': changed.revision, 'blockId': 'manuscript',
                'archive': archive('Changed result', r'\documentclass{article}\begin{document}Changed result\end{document}')}))
            failed = builds.build(entry.identity, PublicationBuildRequest.parse({'revision': 2, 'blockId': 'manuscript',
                'archive': archive('Changed result', r'\documentclass{article}\begin{document}\undefinedPublicationCommand\end{document}')}))
            self.assertEqual(second['build']['status'], 'succeeded', second['build']['log'])
            self.assertEqual(failed['build']['status'], 'failed')
            self.assertNotIn('pdf', failed)
            self.assertIn('undefinedPublicationCommand', failed['build']['log'])
            reopened = PublicationBuildStore(EntryStore(directory))
            self.assertEqual(reopened.read(entry.identity, first['build']['id']), first)
            self.assertEqual(reopened.read(entry.identity, second['build']['id']), second)
            self.assertEqual(len(reopened.list(entry.identity, 'manuscript')['builds']), 3)
            self.assertNotEqual(first['build']['pdfSha256'], second['build']['pdfSha256'])
            preview = reopened.page(entry.identity, first['build']['id'], 1)
            self.assertEqual(preview['pdfSha256'], first['build']['pdfSha256'])
            self.assertEqual(preview['pages'], 1)
            self.assertTrue(base64.b64decode(preview['base64']).startswith(b'\x89PNG'))
            with self.assertRaisesRegex(ValueError, 'existing page'):
                reopened.page(entry.identity, first['build']['id'], 2)
