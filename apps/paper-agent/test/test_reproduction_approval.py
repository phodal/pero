"""Host-only approval contracts; no PC-Gym engine or model is invoked."""
from dataclasses import replace
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import threading
import unittest
import subprocess
import sys
import time
from unittest.mock import patch

import test_pcgym_app as fixtures
from test_pcgym_app import ProcessFixture
from paper_agent import pcgym
from paper_agent.pcgym_app import PcgymApp
from paper_agent.scientific_python import current
from paper_agent.pcgym_domain import Invalid
from paper_agent.model import Invalid as RequestInvalid
from paper_agent.pdf import PdfAnnotation
from paper_agent.store import ResearchStore
from test_research import NOW


class HostApprovalTests(unittest.TestCase):
    setUp = fixtures.PcgymAppTests.setUp
    freeze = fixtures.PcgymAppTests.freeze
    # Reuse the existing App/storage seam, not a second fake scientific runtime.
    def prepared(self):
        annotation = self.store.save_annotation(PdfAnnotation.create(dict(page=20, kind='highlight',
            quote='0.0727', rects=[dict(x=.1, y=.2, width=.1, height=.1)]), self.document, NOW))
        self.audit_command['annotationId'] = annotation.id
        frozen, _ = self.freeze()
        item = self.app.command(dict(action='create-item', specId=frozen['id'], policy='base',
                                    comparison=dict(mode='absolute', tolerance=.001)))
        app = PcgymApp(self.store, checkout=self.checkout, allow_execution=True)
        self.store.pcgym = app
        return app, dict(itemId=item['id'], specId=frozen['id'], requestId='one-fixed-run')

    def test_private_allow_is_one_shot_and_repeat_request_does_not_launch(self):
        app, ids = self.prepared()
        with patch('paper_agent.pcgym_app.subprocess.Popen', return_value=ProcessFixture()) as spawn:
            prepared = app.host_command(dict(operation='prepare', **ids))
            self.assertEqual(prepared, app.host_command(dict(operation='prepare', **ids)))
            self.assertIn(ids['specId'], prepared['summary'])
            self.assertIn('INCONCLUSIVE', prepared['summary'])
            decision = dict(operation='decide', **ids, ticket=prepared['ticket'],
                            bindingDigest=prepared['bindingDigest'], decision='allow')
            for changed in ({'ticket': 'not-a-capability'}, {'bindingDigest': 'a' * 64}):
                with self.assertRaises(RequestInvalid):
                    app.host_command({**decision, **changed})
            spawn.assert_not_called()
            result = app.host_command(decision)
            self.assertEqual((result['state'], result['status']), ('allowed', 'starting'))
            self.assertEqual(app.host_command(decision), result)
            self.assertEqual(app.host_command(dict(operation='prepare', **ids)), result)
            self.assertEqual(spawn.call_count, 1)
            saved = ''.join(p.read_text() for p in self.store.root.rglob('*.json'))
            self.assertNotIn(prepared['ticket'], saved)

    def test_scientific_runtime_drift_blocks_approval_but_keeps_cancellation(self):
        for change in ('executable', 'binary', 'version', 'packages'):
            with self.subTest(change=change):
                app, ids = self.prepared()
                ids['requestId'] = 'runtime-' + change
                prepared = app.host_command(dict(operation='prepare', **ids))
                runtime = current()
                altered = {
                    'executable': replace(runtime, executable='/different/bin/python'),
                    'binary': replace(runtime, executable_sha256='0' * 64),
                    'version': replace(runtime, python_version='0.0.0'),
                    'packages': replace(runtime, packages=()),
                }[change]
                with patch('paper_agent.pcgym_app.observe_scientific_python', return_value=altered), \
                        patch('paper_agent.pcgym_app.subprocess.Popen') as spawn:
                    with self.assertRaises(Invalid):
                        app.host_command(dict(operation='decide', **ids, ticket=prepared['ticket'],
                            bindingDigest=prepared['bindingDigest'], decision='allow'))
                    self.assertEqual(app.host_command(dict(operation='cancel', **ids))['state'], 'cancelled')
                    spawn.assert_not_called()

    def test_deny_cancel_close_restart_and_changed_spec_never_launch(self):
        for action in ('deny', 'cancel', 'close', 'restart', 'change-local'):
            with self.subTest(action=action):
                app, ids = self.prepared()
                ids['requestId'] = action
                prepared = app.host_command(dict(operation='prepare', **ids))
                decision = dict(operation='decide', **ids, ticket=prepared['ticket'],
                                bindingDigest=prepared['bindingDigest'], decision='allow')
                with patch('paper_agent.pcgym_app.subprocess.Popen') as spawn:
                    if action == 'deny':
                        self.assertEqual(app.host_command({**decision, 'decision': 'deny'})['state'], 'denied')
                        self.assertEqual(app.host_command(decision)['state'], 'denied')
                    elif action == 'cancel':
                        self.assertEqual(app.host_command(dict(operation='cancel', **ids))['state'], 'cancelled')
                        self.assertEqual(app.host_command(decision)['state'], 'cancelled')
                    elif action == 'close':
                        app.close()
                        with self.assertRaises(RequestInvalid): app.host_command(decision)
                    elif action == 'restart':
                        reopened = PcgymApp(ResearchStore(self.home), checkout=self.checkout, allow_execution=True)
                        self.assertEqual(reopened.host_command(dict(operation='prepare', **ids))['state'], 'cancelled')
                        self.assertEqual(reopened.host_command(decision)['state'], 'cancelled')
                    else:
                        path = app.bundle(ids['specId']) / 'local.json'
                        local = pcgym.read_json(path)
                        pcgym.write_json(path, {**local, 'interpreter': 'changed-after-display'})
                        with self.assertRaises(Invalid): app.host_command(decision)
                        pcgym.write_json(path, local)
                    spawn.assert_not_called()

    def test_core_intents_never_dispatch_after_persistence_failure(self):
        for failed_collection in ('pcgym-approval-requests', 'pcgym-approval-decisions'):
            with self.subTest(collection=failed_collection):
                app, ids = self.prepared()
                write = self.store._write
                def fail(collection, key, value):
                    if collection == failed_collection:
                        raise OSError('Synthetic approval persistence failure')
                    return write(collection, key, value)
                if failed_collection == 'pcgym-approval-requests':
                    with patch.object(self.store, '_write', side_effect=fail), patch('paper_agent.pcgym_app.subprocess.Popen') as spawn:
                        with self.assertRaises(OSError):
                            app.host_command(dict(operation='prepare', **ids))
                        spawn.assert_not_called()
                    self.assertFalse(app.pending_approvals)
                else:
                    ticket = app.host_command(dict(operation='prepare', **ids))
                    decision = dict(operation='decide', **ids, ticket=ticket['ticket'],
                                    bindingDigest=ticket['bindingDigest'], decision='allow')
                    with patch.object(self.store, '_write', side_effect=fail), patch('paper_agent.pcgym_app.subprocess.Popen') as spawn:
                        with self.assertRaises(OSError): app.host_command(decision)
                        spawn.assert_not_called()
                    self.assertFalse(app.pending_approvals)
                    with patch('paper_agent.pcgym_app.subprocess.Popen') as spawn:
                        with self.assertRaises(RequestInvalid): app.host_command(decision)
                        self.assertEqual(app.host_command(dict(operation='prepare', **ids))['state'], 'cancelled')
                        spawn.assert_not_called()

    def test_same_request_cannot_change_item_and_unknown_blocks_new_request(self):
        app, ids = self.prepared()
        prepared = app.host_command(dict(operation='prepare', **ids))
        revision = app.command(dict(action='create-item', specId=ids['specId'], policy='base',
                                   comparison=dict(mode='absolute', tolerance=.002)))
        with self.assertRaises(Invalid):
            app.host_command(dict(operation='prepare', **{**ids, 'itemId': revision['id']}))
        with patch('paper_agent.pcgym_app.subprocess.Popen', side_effect=OSError('fixture launch failed')):
            with self.assertRaises(OSError):
                app.host_command(dict(operation='decide', **ids, ticket=prepared['ticket'],
                                      bindingDigest=prepared['bindingDigest'], decision='allow'))
        self.assertEqual(app.host_command(dict(operation='prepare', **ids))['status'], 'unknown')
        new = dict(ids, requestId='not-a-blind-retry')
        self.assertEqual(app.host_command(dict(operation='prepare', **new))['state'], 'blocked')

    def test_approved_disposable_worker_cancels_and_same_spec_reruns_without_model(self):
        app, ids = self.prepared()
        root = app.bundle(ids['specId'])
        worker = root / 'disposable-fixture.py'
        worker.write_text("""
import json, signal, sys
from pathlib import Path
root, attempt_id, mode = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
target = root / 'attempts' / attempt_id
target.mkdir(parents=True)
receipt = dict(spec_id=json.loads((root / 'spec.json').read_text())['id'], attempt_id=attempt_id,
               status='running', origin='synthetic-fixture', phase='fixture', worker_started=True)
def save(status):
    receipt['status'] = status
    temporary = target / 'execution.tmp'
    temporary.write_text(json.dumps(receipt)); temporary.replace(target / 'execution.json')
def stop(signum, frame):
    save('cancelled'); sys.exit(0)
signal.signal(signal.SIGTERM, stop)
save('running')
(target / 'ready').write_text('test fixture, not a scientific result')
if mode == 'complete': save('completed')
else:
    while True: signal.pause()
""")
        original = subprocess.Popen
        for index, mode in enumerate(('wait', 'complete')):
            request = dict(ids, requestId=f'disposable-{index}')
            attempt_id = str(index + 1) * 64
            prepared = app.host_command(dict(operation='prepare', **request))
            def launch(_args, **kwargs):
                return original([sys.executable, str(worker), str(root), attempt_id, mode], **kwargs)
            with patch('paper_agent.pcgym_app.subprocess.Popen', side_effect=launch):
                result = app.host_command(dict(operation='decide', **request, ticket=prepared['ticket'],
                    bindingDigest=prepared['bindingDigest'], decision='allow'))
            process = app.processes[ids['specId']]
            try:
                deadline = time.monotonic() + 5
                ready = root / 'attempts' / attempt_id / 'ready'
                while not ready.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(.01)  # bounded observation of an external fixture process
                self.assertTrue(ready.exists())
                if mode == 'wait':
                    local_path = root / 'local.json'
                    local = pcgym.read_json(local_path)
                    pcgym.write_json(local_path, {**local, 'interpreter': 'changed-after-launch'})
                    app.host_command(dict(operation='cancel', **request))
                    pcgym.write_json(local_path, local)
                process.wait(timeout=5)
                result = app.host_command(dict(operation='prepare', **request))
                self.assertEqual(result['status'], 'cancelled' if mode == 'wait' else 'completed')
                self.assertEqual(result['attemptId'], attempt_id)
                self.assertEqual(result['specId'], ids['specId'])
            finally:
                if process.poll() is None: process.kill(); process.wait(timeout=5)
        self.assertEqual(len(app.status(ids['specId'])['attempts']), 2)

    def test_competing_approvals_report_known_prelaunch_refusal_without_replay(self):
        app, ids = self.prepared()
        second = dict(ids, requestId='competing-request')
        first_ticket = app.host_command(dict(operation='prepare', **ids))
        second_ticket = app.host_command(dict(operation='prepare', **second))
        with patch('paper_agent.pcgym_app.subprocess.Popen', return_value=ProcessFixture()) as spawn:
            app.host_command(dict(operation='decide', **ids, ticket=first_ticket['ticket'],
                bindingDigest=first_ticket['bindingDigest'], decision='allow'))
            blocked = app.host_command(dict(operation='decide', **second, ticket=second_ticket['ticket'],
                bindingDigest=second_ticket['bindingDigest'], decision='allow'))
            self.assertEqual((blocked['state'], blocked['status']), ('blocked', 'not_started'))
            self.assertEqual(app.host_command(dict(operation='prepare', **second)), blocked)
            self.assertEqual(spawn.call_count, 1)

    def test_approved_request_can_be_cancelled_after_pdf_replacement(self):
        from paper_agent.pdf import PdfDocument
        from paper_agent.model import digest
        app, ids = self.prepared()
        prepared = app.host_command(dict(operation='prepare', **ids))
        process = ProcessFixture()
        with patch('paper_agent.pcgym_app.subprocess.Popen', return_value=process) as spawn:
            app.host_command(dict(operation='decide', **ids, ticket=prepared['ticket'],
                bindingDigest=prepared['bindingDigest'], decision='allow'))
            self.store.save_pdf(PdfDocument.create(self.paper.id, digest(b'replaced fixture'),
                self.document.source_url, self.document.pages, '2026-11-02T00:00:00Z'), b'replaced fixture')
            result = app.host_command(dict(operation='cancel', **ids))
            self.assertTrue(process.terminated)
            self.assertEqual(result['status'], 'unknown')  # fixture has no execution receipt
            self.assertEqual(app.host_command(dict(operation='prepare', **ids)), result)
            self.assertEqual(spawn.call_count, 1)

    def test_local_preparation_uses_existing_pins_and_recovers_pending_decisions(self):
        annotation = self.store.save_annotation(PdfAnnotation.create(dict(page=20, kind='highlight',
            quote='0.0727', rects=[dict(x=.1, y=.2, width=.1, height=.1)]), self.document, NOW))
        app = PcgymApp(self.store, checkout=self.checkout, allow_execution=True)
        with patch('paper_agent.pcgym_app.subprocess.Popen') as spawn:
            item = app.command(dict(action='prepare-item', annotationId=annotation.id, policy='base',
                comparison=dict(mode='absolute', tolerance=.001), profile='smoke', seed=0,
                includeOracle=False, maxSeconds=30))
            self.assertEqual(len(self.fetches), 4)  # only setUp's source fixture; no preparation fetch
            spec = pcgym.load_spec(app.bundle(item['spec_id']))
            binding = pcgym.read_json(app.bundle(spec.id) / 'paper-binding.json')
            self.assertEqual(binding['selection_anchor'], annotation.anchor.to_dict())
            ids = dict(itemId=item['id'], specId=spec.id, requestId='recover-pending')
            ticket = app.host_command(dict(operation='prepare', **ids))
            read = dict(action='annotation-evidence', annotationId=annotation.id)
            evidence = app.command(read)
            self.assertTrue(evidence['executionAvailable'])
            self.assertEqual(evidence['items'][0]['requests'][0]['status'], 'awaiting_approval')
            self.assertNotIn(ticket['ticket'], json.dumps(evidence))
            app.host_command(dict(operation='cancel', **ids))
            self.assertEqual(app.command(read)['items'][0]['requests'][0]['status'], 'cancelled')
            spawn.assert_not_called()

    def test_corrupt_spec_does_not_prevent_cancelling_exact_live_request(self):
        app, ids = self.prepared()
        prepared = app.host_command(dict(operation='prepare', **ids))
        process = ProcessFixture()
        with patch('paper_agent.pcgym_app.subprocess.Popen', return_value=process):
            app.host_command(dict(operation='decide', **ids, ticket=prepared['ticket'],
                bindingDigest=prepared['bindingDigest'], decision='allow'))
        path = app.bundle(ids['specId']) / 'spec.json'
        path.write_text('{invalid')
        result = app.host_command(dict(operation='cancel', **ids))
        self.assertTrue(process.terminated)
        self.assertEqual(result['status'], 'unknown')
        self.assertIn('Cancellation requested', result['reason'])

    def test_close_stops_owned_process_even_if_approval_record_cannot_be_saved(self):
        app, ids = self.prepared()
        app.host_command(dict(operation='prepare', **ids))
        process = ProcessFixture()
        app.processes[ids['specId']] = process
        with patch.object(self.store, '_write', side_effect=OSError('fixture disk unavailable')):
            with self.assertRaises(OSError): app.close()
        self.assertTrue(process.terminated)
        self.assertFalse(app.pending_approvals)

    def test_http_requires_private_capability_even_when_compute_is_configured(self):
        from paper_agent.http import handler
        app, ids = self.prepared()
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(self.store, 'ordinary-app', compute_secret='private-host'))
        worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
        def post(path, body, capability=None):
            connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            headers = {'Content-Type': 'application/json', 'X-Pero-App-Token': 'ordinary-app'}
            if capability: headers['X-Pero-Compute-Token'] = capability
            connection.request('POST', path, json.dumps(body), headers)
            response = connection.getresponse(); result = response.status, json.loads(response.read())
            connection.close(); return result
        try:
            with patch('paper_agent.pcgym_app.subprocess.Popen') as spawn:
                body = dict(operation='prepare', **ids)
                self.assertEqual(post('/api/reproduction/host', body)[0], 403)
                self.assertEqual(post('/api/reproduction/host', {**body, 'approved': True})[0], 403)
                self.assertEqual(post('/api/reproduction/host', body, 'ordinary-app')[0], 403)
                self.assertEqual(post('/api/reproduction/host', {**body, 'approved': True}, 'private-host')[0], 400)
                self.assertEqual(post('/api/reproduction/step', dict(action='start', specId=ids['specId'],
                    requestId=ids['requestId'], confirmation='execute-frozen-local-simulation'))[0], 403)
                self.assertEqual(post('/api/reproduction/host', body, 'private-host')[0], 200)
                spawn.assert_not_called()
        finally:
            server.shutdown(); worker.join(timeout=3); server.server_close()
