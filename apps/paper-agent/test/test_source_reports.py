"""Reports bind delivered scopes, never caller assertions or inferred science."""
import io
import multiprocessing
import os
from unittest.mock import patch
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


def interrupt_source_publication(root, selection, data):
    """Owned disposable process: exit after the original blob, before its index/receipt."""
    staging = Path(root) / 'crash-staging'
    staging.mkdir()
    tempfile.tempdir = str(staging)  # Reclaimed by the parent after this process exits.
    store = ResearchStore(root)
    store.source_downloads = SourceDownloads(store, SourceTransport(data))
    target = store.root / 'source-files' / (digest(data) + '.bin')
    original_replace = os.replace

    def publish_then_exit(source, destination):
        original_replace(source, destination)
        if Path(destination) == target:
            os._exit(23)

    with patch('paper_agent.source_downloads.os.replace', side_effect=publish_then_exit):
        store.source_downloads.request(dict(operation='start', **selection))
        finish(store.source_downloads, selection)
    store.source_downloads.close()


class SourceReports(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = ResearchStore(self.directory.name)
        self.addCleanup(lambda: self.store.source_downloads.close())
        self.addCleanup(lambda: self.store.pdf_downloads.close())
        image = io.BytesIO()
        Image.new('RGB', (12, 8), 'green').save(image, format='PNG')
        self.original = archive_bytes([('main.tex', TEX.replace('Synthetic source figure.', 'First page. Exact original evidence.').encode()), ('figure.png', image.getvalue()), ('empty.tex', b'')])
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

    def test_exact_reopen_preserves_short_and_partial_line_windows_without_new_observations(self):
        full = self.read('read', memberId=self.tex['id'], start=0)
        newline = full['content'].index('\n')
        for window in (dict(startLine=1, endLine=3), dict(start=2, end=newline + 4), dict(start=5, end=14)):
            with self.subTest(window=window):
                original = self.read('read', memberId=self.tex['id'], **window)
                report = self.report('create', title=str(window), observationIds=[original['observationId']])
                anchor = report['observations'][0]['anchor']
                count = len(self.report('observations')['observations'])
                reopened = self.read('read', memberId=anchor['memberId'], start=anchor['start'], end=anchor['end'])
                self.assertEqual(reopened, original)
                self.assertEqual(len(self.report('observations')['observations']), count)
                self.assertEqual(self.report('read', reportId=report['id']), report)
        for window in (dict(end=5), dict(start=2, end=1), dict(start=0, end=4801),
                       dict(start=0, end=True), dict(startLine=1, endLine=3, end=4)):
            with self.subTest(invalid=window), self.assertRaises(Invalid):
                self.read('read', memberId=self.tex['id'], **window)

    def test_empty_window_is_never_reportable(self):
        with self.assertRaises(Invalid):
            self.read('read', memberId=self.tex['id'], start=2, end=2)
        empty = next(member for member in self.catalog['members'] if member['path'] == 'empty.tex')
        result = self.read('read', memberId=empty['id'], start=0)
        self.assertEqual(result['content'], '')
        self.assertEqual((result['start'], result['end']), (0, 0))
        self.assertNotIn('observationId', result)
        self.assertIn('no reportable observation', result['observationWarning'])
        self.assertEqual(self.report('observations')['observations'], [])

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

    def test_legacy_negative_comparison_preserves_id_but_cannot_verify_unknown_pdf_scope(self):
        from dataclasses import asdict
        from paper_agent.source_reports import SourceObservation, SourceEvidenceReport
        compared = self.read('compare', pdfResourceId=self.pdf.id)
        record = self.store._read('source-observations', compared['observationId'])
        record.pop('pdfConsulted')
        record.pop('consultedPdf', None)
        legacy_id = digest(record)
        self.assertEqual(SourceObservation.from_record(record).id, legacy_id)
        self.store._write('source-observations', legacy_id, record)
        # Model a report saved before explicit comparison scopes existed.
        report = SourceEvidenceReport(self.selection['bundleId'], 'Legacy', (legacy_id,), ())
        self.store._write('source-reports', report.id, dict(asdict(report), id=report.id, createdAt='legacy'))
        reopened = self.report('read', reportId=report.id)
        self.assertEqual(reopened['id'], report.id)
        self.assertEqual(reopened['observations'][0]['id'], legacy_id)
        self.assertEqual(reopened['currentAvailability'], [dict(observationId=legacy_id, available=False, reason='comparison_scope_unrecorded')])
        with self.assertRaises(Invalid):
            self.report('create', title='Fresh claim from legacy result', observationIds=[legacy_id])

    def test_no_match_comparison_keeps_consulted_pdf_identity_and_availability(self):
        selection = dict(bundleId=self.selection['bundleId'], resourceId=self.pdf.id)
        early = self.read('compare', pdfResourceId=self.pdf.id)
        early_report = self.report('create', title='Not acquired', observationIds=[early['observationId']])
        self.store.pdf_downloads = PdfDownloads(self.store, PdfTransport(pdf_fixture().replace(b'First', b'Third')))
        self.store.pdf_downloads.request(dict(operation='start', **selection))
        receipt = finish(self.store.pdf_downloads, selection)['receipt']
        compared = self.read('compare', pdfResourceId=self.pdf.id)
        self.assertEqual(compared['matches'], [])
        self.assertEqual(compared['status'], 'unresolved')
        report = self.report('create', title='No literal matches', observationIds=[compared['observationId']])
        path = self.store.root / 'pdf-files' / (receipt['fileDigest'] + '.pdf')
        for damage in ('missing', 'same-size'):
            with self.subTest(damage=damage):
                if damage == 'missing':
                    path.unlink()
                else:
                    path.write_bytes(b'x' * path.stat().st_size)
                self.assertFalse(self.report('read', reportId=report['id'])['currentAvailability'][0]['available'])
                with self.assertRaises(Invalid):
                    self.report('create', title='New report while ' + damage, observationIds=[compared['observationId']])
                # The earlier outcome consulted no PDF and never claimed to compare its contents.
                self.assertTrue(self.report('read', reportId=early_report['id'])['currentAvailability'][0]['available'])
                self.store.pdf_downloads.request(dict(operation='start', **selection))
                self.assertEqual(finish(self.store.pdf_downloads, selection)['receipt'], receipt)
                self.assertEqual(self.report('read', reportId=report['id']), report)
                self.assertEqual(self.read('compare', pdfResourceId=self.pdf.id), compared)
        anchor = report['observations'][0]['anchor']
        self.assertTrue(anchor['pdfConsulted'])
        self.assertEqual(anchor['consultedPdf'], dict(documentId=receipt['documentId'], fileDigest=receipt['fileDigest']))
        self.assertFalse(early_report['observations'][0]['anchor']['pdfConsulted'])

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
        from paper_agent.source_reports import SourceObservation
        legacy = self.store._read('source-observations', compared['observationId'])
        legacy.pop('consultedPdf')
        legacy.pop('pdfConsulted')
        legacy_id = digest(legacy)
        self.assertEqual(SourceObservation.from_record(legacy).id, legacy_id)
        self.store._write('source-observations', legacy_id, legacy)
        legacy_report = self.report('create', title='Legacy positive match', observationIds=[legacy_id])
        self.assertTrue(legacy_report['currentAvailability'][0]['available'])
        self.assertEqual(legacy_report['observations'][0]['id'], legacy_id)
        path = self.store.root / 'pdf-files' / (receipt['fileDigest'] + '.pdf')
        path.write_bytes(b'x' * path.stat().st_size)
        self.assertFalse(self.report('read', reportId=report['id'])['currentAvailability'][0]['available'])
        self.assertEqual(self.read('compare', pdfResourceId=self.pdf.id)['status'], 'unresolved')


    def test_source_publication_failure_and_interruption_require_explicit_retry(self):
        read = self.read('read', memberId=self.tex['id'], startLine=1, endLine=3)
        old_report = self.report('create', title='Before publication', observationIds=[read['observationId']])
        old_receipt = self.store.source_downloads.request(dict(operation='status', **self.selection))['receipt']
        data = archive_bytes([('main.tex', TEX.replace('Synthetic source figure.', 'Version two result.').encode())])
        selection, _ = bundle(self.store, source_url='https://arxiv.org/src/2610.24806v2')
        downloads = SourceDownloads(self.store, SourceTransport(data))
        self.store.source_downloads = downloads
        original = self.store.root / 'source-files' / (digest(data) + '.bin')
        index = self.store.root / 'source-archives' / (digest(data) + '.json')
        real_replace = os.replace

        def fail_member_publish(source, destination):
            if Path(destination).parent.name == 'source-members':
                raise OSError('authored publication failure')
            return real_replace(source, destination)

        # A handled publication error must remove the newly published original,
        # without deleting a different version's evidence or reporting success.
        with patch('paper_agent.source_downloads.os.replace', side_effect=fail_member_publish):
            downloads.request(dict(operation='start', **selection))
            failed = finish(downloads, selection)
        self.assertEqual(failed['status'], 'failed')
        self.assertIsNone(failed['receipt'])
        self.assertFalse(original.exists())
        self.assertFalse(index.exists())
        self.assertEqual(self.report('read', reportId=old_report['id']), old_report)
        downloads.close()

        # A real process exit bypasses Python exception cleanup, leaving only
        # the first published blob and a running job. No timing-based kill.
        process = multiprocessing.get_context('spawn').Process(
            target=interrupt_source_publication, args=(self.directory.name, selection, data))
        process.start()
        try:
            process.join(timeout=20)
            self.assertFalse(process.is_alive(), 'publication boundary was not reached')
            self.assertEqual(process.exitcode, 23)
        finally:
            if process.is_alive():
                process.terminate()
                process.join(timeout=5)
            process.close()
        self.assertEqual(original.read_bytes(), data)
        self.assertFalse(index.exists())

        entered = multiprocessing.get_context('spawn').Event()
        transport = SourceTransport(data, entered=entered)
        with patch('paper_agent.source_downloads.PublicMetadata', return_value=transport):
            self.store = ResearchStore(self.directory.name)
        interrupted = self.store.source_downloads.request(dict(operation='status', **selection))
        self.assertEqual(interrupted['status'], 'interrupted')
        self.assertIsNone(interrupted['receipt'])
        self.assertFalse(interrupted['localAvailable'])
        self.assertEqual(self.store.source_downloads.running, {})
        self.assertFalse(entered.is_set(), 'restart/status must not fetch or retry')
        self.assertEqual(self.report('read', reportId=old_report['id']), old_report)
        self.assertEqual(self.store.source_downloads.request(dict(operation='status', **self.selection))['receipt'], old_receipt)
        with self.assertRaises(Invalid):
            execute(self.store, 'source-read', dict(operation='list', **selection))
        self.store.source_downloads.request(dict(operation='start', **selection))
        completed = finish(self.store.source_downloads, selection)
        self.assertTrue(entered.is_set())
        self.assertEqual(completed['status'], 'source_available')
        self.assertEqual(completed['receipt']['archiveDigest'], digest(data))
        self.assertEqual(self.report('read', reportId=old_report['id']), old_report)
        self.assertEqual(self.read('read', memberId=self.tex['id'], startLine=1, endLine=3), read)

    def test_source_versions_coexist_without_rebinding_old_observations(self):
        old_read = self.read('read', memberId=self.tex['id'], startLine=1, endLine=3)
        old_observations = self.report('observations')
        old_report = self.report('create', title='Version one', observationIds=[old_read['observationId']])
        old_receipt = self.store.source_downloads.request(dict(operation='status', **self.selection))['receipt']
        new_text = TEX.replace('documentclass{article}', 'documentclass{report}')
        self.assertNotEqual(new_text, TEX)
        data = archive_bytes([('main.tex', new_text.encode())])
        selection, _ = bundle(self.store, source_url='https://arxiv.org/src/2610.24806v2')
        self.store.source_downloads = SourceDownloads(self.store, SourceTransport(data))
        self.store.source_downloads.request(dict(operation='start', **selection))
        new_receipt = finish(self.store.source_downloads, selection)['receipt']
        self.assertEqual((old_receipt['revision'], new_receipt['revision']), ('v1', 'v2'))
        self.assertEqual(old_receipt['workIdentity'], new_receipt['workIdentity'])
        self.assertNotEqual(old_receipt['archiveDigest'], new_receipt['archiveDigest'])
        new_catalog = execute(self.store, 'source-read', dict(operation='list', **selection))
        new_member = next(m for m in new_catalog['members'] if m['path'] == 'main.tex')
        self.assertNotEqual(new_member['id'], self.tex['id'])
        self.assertNotEqual(new_member['sha256'], self.tex['sha256'])
        new_read = execute(self.store, 'source-read', dict(operation='read', **selection, memberId=new_member['id'], startLine=1, endLine=3))
        self.assertNotEqual(new_read['observationId'], old_read['observationId'])
        for restarted in (False, True):
            with self.subTest(restarted=restarted):
                if restarted:
                    self.store.source_downloads.close()
                    self.store = ResearchStore(self.directory.name)
                    self.store.source_downloads = SourceDownloads(self.store, SourceTransport(b'', denied=True))
                self.assertEqual(self.read('list'), self.catalog)
                self.assertEqual(self.read('read', memberId=self.tex['id'], startLine=1, endLine=3), old_read)
                self.assertEqual(self.report('observations'), old_observations)
                self.assertEqual(self.report('read', reportId=old_report['id']), old_report)
                self.assertEqual(self.store.source_downloads.request(dict(operation='start', **self.selection))['receipt'], old_receipt)
                self.assertEqual(self.store.source_downloads.request(dict(operation='start', **selection))['receipt'], new_receipt)
                self.assertEqual(execute(self.store, 'source-read', dict(operation='read', **selection, memberId=new_member['id'], startLine=1, endLine=3)), new_read)
                self.assertEqual(execute(self.store, 'export', dict(bundleId=self.selection['bundleId']))['sourceReports'], [old_report])
                for receipt, expected in ((old_receipt, self.original), (new_receipt, data)):
                    self.assertEqual((self.store.root / 'source-files' / (receipt['archiveDigest'] + '.bin')).read_bytes(), expected)


if __name__ == '__main__':
    unittest.main()
