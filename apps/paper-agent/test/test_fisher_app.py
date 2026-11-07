"""App workflow with the original reviewed PDF, real arithmetic and offline handoff."""
from dataclasses import replace
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from paper_agent.fisher_result import (FisherCommand, PDF_SHA256, PDF_URL, RESULT_RECT,
    SOURCE_NOTE, DOI)
from paper_agent.fisher_app import FisherApp
from paper_agent.http import handler
from paper_agent.model import PaperSnapshot
from paper_agent.pcgym import read_json, write_json
from paper_agent.pcgym_domain import Invalid
from paper_agent.pdf import PdfDocument
from paper_agent.pdf_files import PdfFiles
from paper_agent.store import ResearchStore

PDF = os.environ.get('PERO_FISHER_PDF')
NOW = '2026-11-07T03:00:00Z'


class FisherCommandTests(unittest.TestCase):
    def test_only_fixed_scoped_confirmed_commands_are_admitted(self):
        for command in [dict(action='run', itemId='a'*64, specId='a'*64, requestId='one', confirmed=True),
                        dict(action='freeze', annotationId='a'*64, comparison=dict(mode='absolute', tolerance=0), confirmed=True),
                        dict(action='select', documentId='a'*64)]:
            FisherCommand.parse(command)
            for invalid in [dict(command, path='/tmp/anything'), dict(command, command='echo 1')]:
                with self.subTest(invalid=invalid), self.assertRaises(Invalid):
                    FisherCommand.parse(invalid)
        for invalid in [dict(action='run', itemId='a'*64, specId='a'*64, requestId='one', confirmed=False),
                        dict(action='run', itemId='a'*64, specId='a'*64, requestId='', confirmed=True),
                        dict(action='select', documentId='../elsewhere'),
                        dict(action='logs', itemId='a'*64, attemptId='../elsewhere')]:
            with self.subTest(invalid=invalid), self.assertRaises(Invalid):
                FisherCommand.parse(invalid)


@unittest.skipUnless(PDF, 'Set PERO_FISHER_PDF for original-PDF App integration')
class FisherAppTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.store = ResearchStore(self.home)
        self.files = PdfFiles()
        original = Path(PDF).read_bytes()
        paper = self.store.save_paper(PaperSnapshot.from_reading(dict(source='import', sourceId=DOI,
            title='The use of multiple measurements in taxonomic problems', url='https://doi.org/' + DOI,
            contentKind='full-text', content='Original Fisher paper'), NOW))
        self.document = self.store.save_pdf(PdfDocument.create(paper.id, PDF_SHA256, PDF_URL,
            self.files.pages(original), NOW), original)
        self.app = FisherApp(self.store, self.files)

    def freeze(self, comparison=None):
        selected = self.app.command(dict(action='select', documentId=self.document.id), NOW)['annotation']
        frozen = self.app.command(dict(action='freeze', annotationId=selected['id'], confirmed=True,
            comparison=comparison or dict(mode='absolute', tolerance=.00005)), NOW)
        return selected, frozen

    def run_command(self, frozen, request='first'):
        return dict(action='run', itemId=frozen['itemId'], specId=frozen['spec']['id'],
                    requestId=request, confirmed=True)

    def test_live_http_workflow_restart_request_reconciliation_and_offline_handoff(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(self.store, 'test-app-token'))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        def post(data, route='/api/fisher/step', token='test-app-token'):
            connection = HTTPConnection('127.0.0.1', server.server_port, timeout=5)
            connection.request('POST', route, json.dumps(data),
                {'Content-Type': 'application/json', 'X-Pero-App-Token': token})
            response = connection.getresponse()
            result = response.status, response.read()
            connection.close()
            return result
        def command(data):
            status, body = post(data)
            self.assertEqual(status, 200, body)
            return json.loads(body)
        try:
            self.assertEqual(post(dict(action='select', documentId=self.document.id), token='wrong')[0], 401)
            selected = command(dict(action='select', documentId=self.document.id))['annotation']
            self.assertEqual(selected['anchor']['rects'], [RESULT_RECT])
            self.assertEqual(selected['note'], SOURCE_NOTE)
            overview = command(dict(action='status', annotationId=selected['id']))
            self.assertEqual(overview['items'], [])
            self.assertEqual(len(overview['data']['rows']), 100)
            self.assertEqual(overview['data']['rows'][31]['length_cm'], 5.4)
            self.assertIn(sys.version, overview['preview']['python_version'])
            frozen = command(dict(action='freeze', annotationId=selected['id'], confirmed=True,
                comparison=dict(mode='absolute', tolerance=.00005)))
            request = self.run_command(frozen)
            attempt = command(request)
            self.assertEqual(attempt['report']['result_verdict'], 'REPRODUCED')
            self.assertEqual(attempt['report']['actual'], 19.1434)
            self.assertEqual(attempt['report']['difference'], 0)
            self.assertEqual(attempt['report']['paper_verdict'], 'NOT_ASSESSED')
            self.assertEqual(attempt['independent']['numeric_recomputation'], 'PASS')
            self.assertEqual(command(request), attempt)
            saved = self.store.annotation(attempt['annotation']['resultAnnotationId'])
            self.assertEqual(saved.anchor.to_dict(), selected['anchor'])
            reopened = FisherApp(ResearchStore(self.home), self.files)
            self.assertEqual(reopened.command(request, NOW), attempt)
            again = command(self.run_command(frozen, 'second'))
            self.assertNotEqual(again['attemptId'], attempt['attemptId'])
            self.assertEqual(len(command(dict(action='status', annotationId=selected['id']))['items'][0]['attempts']), 2)
            status, archive_bytes = post(dict(itemId=frozen['itemId'], attemptId=attempt['attemptId']), '/api/fisher/evidence-archive')
            self.assertEqual(status, 200)
            target = self.home / 'recipient'
            with ZipFile(BytesIO(archive_bytes)) as archive:
                self.assertIn('README.txt', archive.namelist())
                self.assertIn('paper.pdf', archive.namelist())
                archive.extractall(target)
            checked = subprocess.run([sys.executable, '-I', '-S', str(target / 'verify.py')],
                                     capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(checked.stdout)['exact_numerator'], 95717)
            self.assertEqual(json.loads(checked.stdout)['exact_denominator'], 5000)
            logs = command(dict(action='logs', itemId=frozen['itemId'], attemptId=attempt['attemptId']))
            self.assertIn('numeric_recomputation', logs['text'])
            # Existing PC-Gym public start still cannot bypass its Host authority.
            self.assertEqual(post(dict(action='start', specId='a'*64, requestId='pcgym', confirmation='x'), '/api/reproduction/step')[0], 403)
        finally:
            server.shutdown(); worker.join(timeout=3); server.server_close()
            self.store.program_jobs.close()

    def test_changed_policy_is_a_new_frozen_item_and_mismatch_is_not_execution_failure(self):
        selected, first = self.freeze()
        _, second = self.freeze(dict(mode='bounds', lower=0, upper=1))
        self.assertNotEqual(first['itemId'], second['itemId'])
        result = self.app.command(self.run_command(second), NOW)
        self.assertEqual(result['execution']['status'], 'completed')
        self.assertEqual(result['report']['result_verdict'], 'MISMATCH')
        self.assertEqual(result['independent']['numeric_recomputation'], 'PASS')
        self.assertEqual(len(self.app.command(dict(action='status', annotationId=selected['id']), NOW)['items']), 2)

    def test_environment_changed_remains_inconclusive_with_readable_failure_log(self):
        _, frozen = self.freeze()
        with patch('paper_agent.fisher_reproduction.interpreter_digest', return_value='changed'):
            result = self.app.command(self.run_command(frozen), NOW)
        self.assertEqual(result['execution']['status'], 'environment_failed')
        self.assertEqual(result['report']['result_verdict'], 'INCONCLUSIVE')
        self.assertIsNone(result['independent'])
        logs = self.app.command(dict(action='logs', itemId=frozen['itemId'], attemptId=result['attemptId']), NOW)
        self.assertIn('prepare a new protocol', logs['text'])

    def test_wrong_source_or_changed_spec_refused_and_unfinished_attempt_not_replayed(self):
        _, frozen = self.freeze()
        with self.assertRaises(Invalid):
            self.app.command({**self.run_command(frozen), 'specId': 'a'*64}, NOW)
        self.assertFalse((self.app.bundle(frozen['itemId']) / 'attempts').exists())
        target = self.app.bundle(frozen['itemId']) / 'attempts' / ('b'*32)
        target.mkdir(parents=True)
        write_json(target / 'execution.json', dict(status='running', request_id='first', started_at=NOW))
        self.assertEqual(self.app.command(self.run_command(frozen), NOW)['execution']['status'], 'running')
        with self.assertRaisesRegex(Invalid, 'unfinished'):
            self.app.command(self.run_command(frozen, 'second'), NOW)
        # A crash after calculation but before comparison is also unresolved.
        write_json(target / 'execution.json', dict(status='completed', request_id='first', started_at=NOW))
        with self.assertRaisesRegex(Invalid, 'unfinished'):
            self.app.command(self.run_command(frozen, 'third'), NOW)
        self.assertEqual(len(list(target.parent.iterdir())), 1)
        wrong = replace(self.document, file_digest='0'*64)
        with patch.object(self.store, 'pdf', return_value=wrong), self.assertRaises(Invalid):
            self.app.command(dict(action='select', documentId=self.document.id), NOW)


if __name__ == '__main__':
    unittest.main()
