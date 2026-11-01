"""Reports bind delivered scopes, never caller assertions or inferred science."""
import io
from pathlib import Path
import tempfile
import unittest

from PIL import Image
from test_source_downloads import SourceTransport, bundle, finish, TEX, archive_bytes
from test_pdf_downloads import PdfTransport
from test_pdf import pdf_fixture
from paper_agent.model import Invalid, digest
from paper_agent.store import ResearchStore
from paper_agent.source_downloads import SourceDownloads
from paper_agent.pdf_downloads import PdfDownloads
from paper_agent.research_commands import execute


class SourceReports(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = ResearchStore(self.directory.name)
        self.addCleanup(lambda: self.store.source_downloads.close())
        self.addCleanup(lambda: self.store.pdf_downloads.close())
        image = io.BytesIO()
        Image.new('RGB', (12, 8), 'green').save(image, format='PNG')
        self.original = archive_bytes([('main.tex', TEX.replace('Synthetic source figure.', 'First page. Exact original evidence.').encode()), ('figure.png', image.getvalue())])
        self.selection, self.pdf = bundle(self.store)
        self.store.source_downloads = SourceDownloads(self.store, SourceTransport(self.original))
        self.store.source_downloads.request(dict(operation='start', **self.selection))
        self.assertEqual(finish(self.store.source_downloads, self.selection)['status'], 'source_available')
        self.catalog = self.read('list')
        self.tex = next(m for m in self.catalog['members'] if m['path'] == 'main.tex')
        self.image = next(m for m in self.catalog['members'] if m['path'] == 'figure.png')

    def read(self, operation, **value):
        return execute(self.store, 'source-read', dict(operation=operation, **self.selection, **value))

    def report(self, operation, **value):
        return execute(self.store, 'source-report', dict(operation=operation, bundleId=self.selection['bundleId'], **value))

    def test_observed_only_scopes_idempotent_reports_reopen_export_and_unresolved_interpretations(self):
        self.assertEqual(self.report('observations'), {'observations': []})
        for value in (dict(observationIds=['a' * 64]), dict(observationIds=[self.tex['id']]),
                      dict(observationIds=[], sources=[self.tex])):
            with self.subTest(value=value), self.assertRaises(Invalid):
                self.report('create', title='Unobserved', **value)
        with self.assertRaises(Invalid):
            self.read('read', memberId=self.tex['id'], startLine=99999)
        self.assertEqual(self.report('observations')['observations'], [])
        read = self.read('read', memberId=self.tex['id'], startLine=1, endLine=3)
        repeated = self.read('read', memberId=self.tex['id'], startLine=1, endLine=3)
        self.assertEqual(read['observationId'], repeated['observationId'])
        observation = self.report('observations')['observations'][0]
        self.assertEqual(observation['anchor']['contentDigest'], digest(read['content'].encode()))
        self.assertEqual((observation['anchor']['startLine'], observation['anchor']['endLine']), (1, 3))
        image = self.read('image', memberId=self.image['id'])
        created = self.report('create', title='Observed source', observationIds=[read['observationId'], image['observationId']], interpretations=['The visual meaning has not been checked.'])
        self.assertEqual(created['interpretations'][0]['status'], 'unresolved')
        self.assertEqual(created['observations'][1]['anchor']['visualReview'], 'not_reviewed')
        self.assertTrue(all(item['available'] for item in created['currentAvailability']))
        self.assertEqual(created['verification'], 'tool_observed_scopes_only')
        with self.assertRaises(Invalid):
            self.report('create', title='Forged vision', observationIds=[image['observationId']], visualReview='verified')
        self.store = ResearchStore(self.directory.name)
        self.assertEqual(self.report('read', reportId=created['id']), created)
        self.assertEqual(self.report('create', title='Observed source', observationIds=[read['observationId'], image['observationId']], interpretations=['The visual meaning has not been checked.']), created)
        exported = execute(self.store, 'export', dict(bundleId=self.selection['bundleId']))
        self.assertEqual(exported['sourceReports'], [created])
        self.assertNotIn('data', str(exported['sourceReports'][0]['observations'][1]['anchor']))
        other, _ = bundle(self.store, source_url='https://arxiv.org/src/2610.24806v2')
        with self.assertRaises(Invalid):
            execute(self.store, 'source-report', dict(operation='create', bundleId=other['bundleId'], title='Wrong bundle', observationIds=[read['observationId']]))

    def test_report_filename_cannot_alias_another_legitimate_report(self):
        read = self.read('read', memberId=self.tex['id'], startLine=1, endLine=2)
        first = self.report('create', title='First', observationIds=[read['observationId']])
        second = self.report('create', title='Second', observationIds=[read['observationId']])
        directory = self.store.root / 'source-reports'
        (directory / (first['id'] + '.json')).write_bytes((directory / (second['id'] + '.json')).read_bytes())
        for operation, values in (('read', dict(reportId=first['id'])), ('list', {}),
                                  ('create', dict(title='First', observationIds=[read['observationId']]))):
            with self.subTest(operation=operation), self.assertRaisesRegex(Invalid, 'identity check failed'):
                self.report(operation, **values)

    def test_observation_capacity_never_blocks_reading_or_invents_a_reportable_id(self):
        from unittest.mock import patch
        for error in (Invalid('Journal is full', 413), OSError('Synthetic disk failure')):
            with self.subTest(error=error), patch.object(self.store, '_write', side_effect=error):
                value = self.read('read', memberId=self.tex['id'], startLine=1, endLine=2)
            self.assertTrue(value['content'])
            self.assertNotIn('observationId', value)
            self.assertIn('cannot be added', value['observationWarning'])
        self.assertEqual(self.report('observations')['observations'], [])

    def test_original_loss_tampering_restore_and_frozen_historical_scope(self):
        read = self.read('read', memberId=self.tex['id'], start=0)
        created = self.report('create', title='Frozen', observationIds=[read['observationId']])
        archive = self.store.root / 'source-files' / (digest(self.original) + '.bin')
        archive.unlink()
        view = self.report('read', reportId=created['id'])
        self.assertEqual(view['observations'], created['observations'])
        self.assertFalse(view['currentAvailability'][0]['available'])
        with self.assertRaises(Invalid):
            self.report('create', title='Unavailable new report', observationIds=[read['observationId']])
        self.store.source_downloads.request(dict(operation='start', **self.selection))
        self.assertEqual(finish(self.store.source_downloads, self.selection)['status'], 'source_available')
        self.assertEqual(self.report('read', reportId=created['id']), created)
        member = self.store.root / 'source-members' / (self.tex['sha256'] + '.bin')
        member.write_bytes(b'x' * member.stat().st_size)
        self.assertFalse(self.report('read', reportId=created['id'])['currentAvailability'][0]['available'])
        with self.assertRaises(Invalid):
            self.read('read', memberId=self.tex['id'], start=0)
        self.assertEqual(len(self.report('observations')['observations']), 1)

    def test_comparison_reports_only_actual_pdf_offsets_and_refuses_corrupt_pdf(self):
        unresolved = self.read('compare')
        report = self.report('create', title='No page mapping', observationIds=[unresolved['observationId']])
        self.assertEqual(report['observations'][0]['anchor']['status'], 'unresolved')
        self.assertEqual(report['observations'][0]['anchor']['matches'], [])
        self.store.pdf_downloads = PdfDownloads(self.store, PdfTransport(pdf_fixture()))
        selection = dict(bundleId=self.selection['bundleId'], resourceId=self.pdf.id)
        self.store.pdf_downloads.request(dict(operation='start', **selection))
        receipt = finish(self.store.pdf_downloads, selection)['receipt']
        compared = self.read('compare', pdfResourceId=self.pdf.id)
        report = self.report('create', title='Literal locations', observationIds=[compared['observationId']])
        match = report['observations'][0]['anchor']['matches'][0]
        self.assertEqual(match['pdf']['page'], 1)
        self.assertEqual(match['pdf']['documentId'], receipt['documentId'])
        self.assertEqual(match['source']['memberDigest'], self.tex['sha256'])
        self.assertTrue(report['currentAvailability'][0]['available'])
        path = self.store.root / 'pdf-files' / (receipt['fileDigest'] + '.pdf')
        path.write_bytes(b'x' * path.stat().st_size)
        self.assertFalse(self.report('read', reportId=report['id'])['currentAvailability'][0]['available'])
        self.assertEqual(self.read('compare', pdfResourceId=self.pdf.id)['status'], 'unresolved')


if __name__ == '__main__':
    unittest.main()
