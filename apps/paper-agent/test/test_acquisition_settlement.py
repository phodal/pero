"""Terminal acquisition visibility includes staging cleanup and owner retirement."""
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.model import Invalid
from paper_agent.pdf_downloads import PdfDownloads
from paper_agent.source_downloads import SourceDownloads
from paper_agent.store import ResearchStore
from test_pdf import pdf_fixture
from test_pdf_downloads import PdfTransport, finish
from test_source_archives import TEX, archive_bytes
from test_source_downloads import SourceTransport, bundle


class AcquisitionSettlementTest(unittest.TestCase):
    def test_terminal_state_waits_for_cleanup_and_releases_admission(self):
        for kind in ('source', 'pdf'):
            for outcome in ('failed', 'cancelled', 'ready', 'ready_first', 'cleanup_error'):
                with self.subTest(kind=kind, outcome=outcome), tempfile.TemporaryDirectory() as root:
                    store = ResearchStore(root)
                    source, pdf = bundle(store)
                    selections = {'source': source, 'pdf': dict(bundleId=source['bundleId'], resourceId=pdf.id)}
                    store.source_downloads = SourceDownloads(store, SourceTransport(archive_bytes([('main.tex', TEX.encode())])))
                    store.pdf_downloads = PdfDownloads(store, PdfTransport(pdf_fixture()))
                    owner = getattr(store, kind + '_downloads')
                    other = getattr(store, ('pdf' if kind == 'source' else 'source') + '_downloads')
                    selection = selections[kind]
                    receipt = None
                    if outcome != 'ready_first':
                        owner.request(dict(operation='start', **selection))
                        saved = finish(owner, selection)
                        receipt = saved['receipt']
                        # Force restoration without replacing historical receipt identity.
                        filename = ('source-files/' + receipt['archiveDigest'] + '.bin') if kind == 'source' else ('pdf-files/' + receipt['fileDigest'] + '.pdf')
                        path = store.root / filename
                        self.assertTrue(path.exists(), path)
                        path.unlink()
                    entered, release = threading.Event(), threading.Event()
                    original_cleanup = tempfile.TemporaryDirectory.cleanup

                    def cleanup(directory):
                        if Path(directory.name).name.startswith('pero-paper-' + kind + '-'):
                            entered.set()
                            if not release.wait(10):
                                raise AssertionError('Test did not release owned staging cleanup')
                            original_cleanup(directory)
                            if outcome == 'cleanup_error':
                                raise OSError('Synthetic staging cleanup failure')
                        else:
                            original_cleanup(directory)

                    from paper_agent.acquisition_worker import acquire_bounded
                    def acquire(*args):
                        if outcome in ('failed', 'cancelled'):
                            return (outcome, 'Synthetic terminal outcome')
                        return acquire_bounded(*args)

                    try:
                        with patch.object(tempfile.TemporaryDirectory, 'cleanup', cleanup), patch('paper_agent.' + kind + '_downloads.acquire_bounded', side_effect=acquire):
                            initial = owner.request(dict(operation='start', **selection))
                            self.assertTrue(entered.wait(10), 'Worker did not reach staging cleanup')
                            during = owner.request(dict(operation='status', **selection))
                            self.assertEqual(during['status'], 'running')
                            self.assertEqual(during['receipt'], receipt)
                            self.assertEqual(owner.request(dict(operation='start', **selection))['status'], 'running')
                            with self.assertRaises(Invalid) as busy:
                                other.request(dict(operation='start', **selections['pdf' if kind == 'source' else 'source']))
                            self.assertEqual(busy.exception.status, 409)
                            self.assertIn(initial['id'], owner.running)
                            release.set()
                            result = finish(owner, selection)
                        expected = ('source_available' if kind == 'source' else 'completed') if outcome in ('ready', 'ready_first') else ('failed' if outcome == 'cleanup_error' else outcome)
                        self.assertEqual(result['status'], expected, result)
                        if receipt is None:
                            self.assertIsNotNone(result['receipt'])
                            receipt = result['receipt']
                        else:
                            self.assertEqual(result['receipt'], receipt)
                        self.assertNotIn(initial['id'], owner.running)
                        if outcome == 'cleanup_error':
                            self.assertIn('OSError', result['error'])
                        # No pause/retry loop: terminal observation admits immediate retry.
                        owner.request(dict(operation='start', **selection))
                        retried = finish(owner, selection)
                        self.assertEqual(retried['status'], 'source_available' if kind == 'source' else 'completed')
                        self.assertEqual(retried['receipt'], receipt)
                    finally:
                        release.set()
                        owner.close()
                        other.close()

    def test_failed_terminal_write_leaves_restart_recovery_record(self):
        for kind in ('source', 'pdf'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as root:
                store = ResearchStore(root)
                selection, pdf = bundle(store)
                if kind == 'pdf':
                    selection = dict(bundleId=selection['bundleId'], resourceId=pdf.id)
                store.source_downloads = SourceDownloads(store, SourceTransport(archive_bytes([('main.tex', TEX.encode())])))
                store.pdf_downloads = PdfDownloads(store, PdfTransport(pdf_fixture()))
                owner = getattr(store, kind + '_downloads')
                owner.request(dict(operation='start', **selection))
                receipt = finish(owner, selection)['receipt']
                filename = ('source-files/' + receipt['archiveDigest'] + '.bin') if kind == 'source' else ('pdf-files/' + receipt['fileDigest'] + '.pdf')
                (store.root / filename).unlink()
                original_save = owner._save
                failures = []
                failed = threading.Event()

                def failed_thread(args):
                    failures.append(args.exc_value)
                    failed.set()

                def save(job):
                    if job.status != 'running':
                        raise OSError('Synthetic terminal persistence failure')
                    original_save(job)

                with patch.object(owner, '_save', side_effect=save), patch('paper_agent.' + kind + '_downloads.acquire_bounded', return_value=('failed', 'Synthetic acquisition failure')), patch.object(threading, 'excepthook', side_effect=failed_thread):
                    owner.request(dict(operation='start', **selection))
                    result = finish(owner, selection)
                    self.assertTrue(failed.wait(5), 'Worker did not report terminal persistence failure')
                self.assertEqual(result['status'], 'running')
                self.assertEqual(result['receipt'], receipt)
                self.assertFalse(owner.running)
                self.assertEqual(len(failures), 1)
                self.assertIsInstance(failures[0], OSError)
                reopened = ResearchStore(root)
                recovered = getattr(reopened, kind + '_downloads')
                result = recovered.request(dict(operation='status', **selection))
                self.assertEqual(result['status'], 'interrupted')
                self.assertEqual(result['receipt'], receipt)
                self.assertFalse(recovered.running)
                with patch('paper_agent.' + kind + '_downloads.acquire_bounded', return_value=('failed', 'Synthetic explicit retry')):
                    recovered.request(dict(operation='start', **selection))
                    self.assertEqual(finish(recovered, selection)['status'], 'failed')
