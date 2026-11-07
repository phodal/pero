"""Deterministic App wiring; fixtures do not establish scientific reproduction."""
from contextlib import ExitStack
import hashlib
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from io import BytesIO
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from test_pcgym_reproduction import synthetic_sources, observation
from test_research import reading, NOW
from paper_agent import pcgym
from paper_agent.pcgym_app import PcgymApp
from paper_agent.pcgym_domain import COMMIT, Invalid, REQUIRED_PACKAGES
from paper_agent.model import PaperSnapshot, Invalid as RequestInvalid, digest
from paper_agent.pdf import PdfAnnotation, PdfDocument, PdfPage
from paper_agent.research_record_commands import record_command, record_handoff
from paper_agent.store import ResearchStore


class ProcessFixture:
    """The CLI process seam; no solver or subprocess is started."""
    def __init__(self):
        self.returncode = None
        self.terminated = False

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        self.returncode = -15

    def wait(self, timeout=None):
        return self.returncode


class PcgymAppTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.home = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.store = ResearchStore(self.home)
        self.sources = synthetic_sources()
        pins = {s.path: s.blob for s in self.sources}
        self.stack.enter_context(patch.dict('paper_agent.pcgym_sources.PINS', pins, clear=True))
        self.checkout = Path(self.home) / 'checkout'
        self.checkout.mkdir()
        manifest = dict(repository='https://github.com/MaximilianB2/pc-gym', commit=COMMIT,
                        core_tree='fixture', files=[s.manifest() for s in self.sources])
        self.stack.enter_context(patch('paper_agent.pcgym_app.read_checkout',
            return_value=(self.checkout, self.sources, manifest)))
        self.stack.enter_context(patch('paper_agent.scientific_python.package_inventory',
            return_value={name: 'fixture-version' for name in REQUIRED_PACKAGES}))
        self.fetches = []
        def fetch(url):
            self.fetches.append(url)
            source = next(s for s in self.sources if url.endswith('/' + s.path))
            return SimpleNamespace(url=url, text=source.text)
        self.app = PcgymApp(self.store, fetch=fetch, checkout=self.checkout)
        self.store.pcgym = self.app
        self.paper = self.store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
        pages = tuple(PdfPage(n, 400, 600, 'arXiv 2410.22093v4' if n == 1 else
            'Table 6 Base reward 0.0727 Shaped reward 0.0003 Oracle 0.0000 episodes trajectory' if n == 20 else 'Fixture')
            for n in range(1, 21))
        self.document = self.store.save_pdf(PdfDocument.create(self.paper.id, digest(b'synthetic fixture'),
            'https://arxiv.org/pdf/2410.22093v4', pages, NOW), b'synthetic fixture')
        self.annotation = self.store.save_annotation(PdfAnnotation.create(dict(page=20, kind='highlight',
            quote='Table 6', rects=[dict(x=.1, y=.1, width=.3, height=.1)]), self.document, NOW))
        source_ids = [self.app.command(dict(action='inspect-source', source=s.path))['id'] for s in self.sources]
        self.audit_command = dict(action='audit', paperId=self.paper.id, sourceIds=source_ids,
                                  annotationId=self.annotation.id)

    def freeze(self, app=None):
        app = app or self.app
        audit = app.command(self.audit_command)
        command = dict(action='freeze', auditId=audit['id'], profile='smoke', seed=0,
                       includeOracle=False, maxSeconds=30)
        return app.command(command), command

    def evidence(self):
        frozen, _ = self.freeze()
        root = self.app.bundle(frozen['id'])
        spec = pcgym.load_spec(root)
        raw = observation(spec)
        raw['policies'] = [p for p in raw['policies'] if p['policy'] in spec.policies]
        attempt = root / 'attempts' / raw['attempt_id']
        attempt.mkdir(parents=True)
        pcgym.write_json(attempt / 'observations.json', raw)
        receipt = dict(spec_id=spec.id, attempt_id=raw['attempt_id'], status='completed', started_at=NOW,
            observations_sha256=hashlib.sha256((attempt / 'observations.json').read_bytes()).hexdigest())
        pcgym.write_json(attempt / 'execution.json', receipt)
        return spec, raw, attempt

    def test_json_persistence_is_idempotent_and_optional_oracle_is_frozen(self):
        frozen, command = self.freeze()
        reopened = ResearchStore(self.home)
        app = PcgymApp(reopened, checkout=self.checkout)
        self.assertEqual(app.command(self.audit_command)['id'], command['auditId'])
        self.assertEqual(app.command(command), frozen)
        spec = pcgym.load_spec(app.bundle(frozen['id']))
        self.assertEqual(spec.policies, ('base', 'shaped'))
        self.assertEqual(spec.anchor.document_id, self.document.id)
        self.assertNotEqual(spec.anchor.passage_id, self.annotation.id)
        self.assertEqual(len(self.fetches), 4)

    def test_refreeze_changed_runtime_preserves_historical_bundle(self):
        from dataclasses import replace
        from paper_agent.scientific_python import current
        runtime = current()
        frozen, command = self.freeze()
        original = {p.name: p.read_bytes() for p in self.app.bundle(frozen['id']).iterdir() if p.is_file()}
        for changed in (replace(runtime, executable_sha256='a' * 64),
                        replace(runtime, executable=runtime.executable + '-replacement')):
            with self.subTest(runtime=changed.identity), patch('paper_agent.pcgym_app.observe_scientific_python', return_value=changed):
                fresh = self.app.command(command)
                self.assertNotEqual(fresh['id'], frozen['id'])
                spec = pcgym.load_spec(self.app.bundle(fresh['id']))
                changed.require(spec)
                with self.assertRaises(Invalid):
                    runtime.require(spec)
                self.assertEqual(self.app.command(command), fresh)
        self.assertEqual(original, {p.name: p.read_bytes() for p in self.app.bundle(frozen['id']).iterdir() if p.is_file()})

    def test_wrong_pdf_annotation_and_changed_source_are_refused(self):
        wrong = self.store.save_annotation(PdfAnnotation.create(dict(page=1, kind='highlight',
            quote='arXiv', rects=[dict(x=.1, y=.1, width=.3, height=.1)]), self.document, NOW))
        with self.assertRaisesRegex(Invalid, 'page 20'):
            self.app.command({**self.audit_command, 'annotationId': wrong.id})
        source_id = self.audit_command['sourceIds'][0]
        path = self.store.root / 'pcgym-sources' / (source_id + '.json')
        value = json.loads(path.read_text()); value['text'] += '# changed'
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(Invalid, 'changed'):
            self.app.command(self.audit_command)

    def test_annotation_identity_is_frozen_and_binding_tamper_blocks_compute_and_verify(self):
        spec, raw, _ = self.evidence()
        annotation = self.store.save_annotation(PdfAnnotation.create(dict(page=20, kind='highlight',
            quote='Table 6', note='A separate saved selection',
            rects=[dict(x=.2, y=.1, width=.3, height=.1)]), self.document, NOW))
        audit = self.app.command({**self.audit_command, 'annotationId': annotation.id})
        other = self.app.command(dict(action='freeze', auditId=audit['id'], profile='smoke',
            seed=0, includeOracle=False, maxSeconds=30))
        self.assertNotEqual(spec.id, other['id'])
        self.assertEqual(spec.anchor.passage_id, other['spec']['anchor']['passage_id'])
        self.assertNotEqual(spec.paper_binding_digest, other['spec']['paper_binding_digest'])
        path = self.app.bundle(spec.id) / 'paper-binding.json'
        binding = pcgym.read_json(path)
        binding['annotation_id'] = annotation.id
        pcgym.write_json(path, binding)
        app = PcgymApp(self.store, checkout=self.checkout, allow_execution=True)
        with patch('paper_agent.pcgym_app.subprocess.Popen') as spawn:
            for action in ('verify', 'export'):
                with self.subTest(action=action), self.assertRaises(Invalid) as failure:
                    app.command(dict(action=action, specId=spec.id, attemptId=raw['attempt_id']))
                self.assertEqual(failure.exception.code, 'binding_changed')
            with self.assertRaises(Invalid) as failure:
                app.command(dict(action='start', specId=spec.id, requestId='changed-binding',
                    confirmation='execute-frozen-local-simulation'))
            self.assertEqual(failure.exception.code, 'binding_changed')
            spawn.assert_not_called()

    def test_version_claim_and_online_pin_checks_fail_closed(self):
        for first, result in (('arXiv 2410.22093v3', self.document.page(20).text),
                              ('arXiv 2410.22093v4', 'Table 6 Base reward 0.0003 Shaped reward 0.0727 Oracle 0.0000 episodes trajectory')):
            with self.subTest(first=first, result=result):
                paper = self.store.save_paper(PaperSnapshot.from_reading(reading(content=first + result), NOW))
                pages = tuple(PdfPage(p.number, p.width, p.height,
                    first if p.number == 1 else result if p.number == 20 else p.text)
                    for p in self.document.pages)
                self.store.save_pdf(PdfDocument.create(paper.id, digest(b'fixture'),
                    self.document.source_url, pages, NOW), b'fixture')
                with self.assertRaises(Invalid):
                    self.app.binding(paper.id)
        source = self.sources[0]
        for redirect, content in ((True, source.text), (False, source.text + '# changed')):
            with self.subTest(redirect=redirect):
                def changed(url):
                    return SimpleNamespace(url=url + '?redirect' if redirect else url, text=content)
                app = PcgymApp(self.store, fetch=changed)
                with self.assertRaises(Invalid):
                    app.command(dict(action='inspect-source', source=source.path))

    def test_pdf_replacement_cannot_reuse_audit(self):
        _, command = self.freeze()
        replacement = PdfDocument.create(self.paper.id, digest(b'different fixture'), self.document.source_url,
                                         self.document.pages, '2026-11-01T00:00:00Z')
        self.store.save_pdf(replacement, b'different fixture')
        with self.assertRaises(Invalid):
            self.app.command(command)

    def test_restart_unknown_cancel_never_replays_and_artifact_tamper_fails(self):
        spec, raw, attempt = self.evidence()
        verify = dict(action='verify', specId=spec.id, attemptId=raw['attempt_id'])
        report = self.app.command(verify)
        self.assertEqual(report['numeric_recomputation'], 'PASS')
        self.assertEqual(report['paper_verdict'], 'INCONCLUSIVE')
        self.assertEqual(len(report['metrics']), 2)
        exported = self.app.command({**verify, 'action': 'export'})
        self.assertEqual(exported['spec']['id'], spec.id)
        receipt = pcgym.read_json(attempt / 'execution.json'); receipt['status'] = 'running'
        pcgym.write_json(attempt / 'execution.json', receipt)
        pcgym.write_json(self.app.bundle(spec.id) / 'running.lock', {'attempt_id': raw['attempt_id']})
        app = PcgymApp(ResearchStore(self.home), checkout=self.checkout, allow_execution=True)
        with patch('paper_agent.pcgym_app.subprocess.Popen') as spawn:
            status = app.command(dict(action='cancel', specId=spec.id))
            self.assertEqual(status['attempts'][0]['status'], 'unknown')
            with self.assertRaises(RequestInvalid):
                app.command(dict(action='start', specId=spec.id, requestId='new',
                    confirmation='execute-frozen-local-simulation'))
            spawn.assert_not_called()
        raw['policies'][0]['temperatures'][0][0] = 328
        pcgym.write_json(attempt / 'observations.json', raw)
        self.assertEqual(app.command(verify)['numeric_recomputation'], 'FAIL')
        with self.assertRaises(Invalid):
            app.command({**verify, 'action': 'export'})
        spec_path = self.app.bundle(spec.id) / 'spec.json'
        value = pcgym.read_json(spec_path); value['seed'] += 1
        pcgym.write_json(spec_path, value)
        with self.assertRaises(Invalid):
            app.command(verify)

    def test_early_cancel_and_restart_preserve_request_without_replay(self):
        frozen, _ = self.freeze()
        app = PcgymApp(self.store, checkout=self.checkout, allow_execution=True)
        command = dict(action='start', specId=frozen['id'], requestId='stable-launch',
                       confirmation='execute-frozen-local-simulation')
        process = ProcessFixture()
        with patch('paper_agent.pcgym_app.subprocess.Popen', return_value=process) as spawn:
            self.assertEqual(app.command(command)['status'], 'starting')
            self.assertEqual(app.command(command)['requests'][0]['status'], 'starting')
            cancelled = app.command(dict(action='cancel', specId=frozen['id']))
            self.assertTrue(cancelled['cancellation_requested'])
            self.assertTrue(process.terminated)
            self.assertEqual(cancelled['requests'][0]['status'], 'unknown')
            reopened = PcgymApp(ResearchStore(self.home), checkout=self.checkout, allow_execution=True)
            with patch('paper_agent.pcgym_app.observe_scientific_python', side_effect=Invalid('missing', 'Environment removed')):
                self.assertEqual(reopened.command(command)['requests'][0]['status'], 'unknown')
            self.assertFalse(reopened.command(dict(action='cancel', specId=frozen['id']))['cancellation_requested'])
            with self.assertRaises(RequestInvalid):
                reopened.command({**command, 'requestId': 'do-not-replay'})
            _, freeze_command = self.freeze()
            other = reopened.command({**freeze_command, 'seed': 1})
            for request_id in ('stable-launch', 'different-spec-retry'):
                with self.subTest(request_id=request_id), self.assertRaises(RequestInvalid):
                    reopened.command({**command, 'specId': other['id'], 'requestId': request_id})
            self.assertEqual(spawn.call_count, 1)

    def test_failed_launch_and_exited_process_remain_unknown(self):
        frozen, _ = self.freeze()
        app = PcgymApp(self.store, checkout=self.checkout, allow_execution=True)
        command = dict(action='start', specId=frozen['id'], requestId='failed-launch',
                       confirmation='execute-frozen-local-simulation')
        with patch('paper_agent.pcgym_app.subprocess.Popen', side_effect=OSError('fixture refusal')) as spawn:
            with self.assertRaises(OSError):
                app.command(command)
            self.assertEqual(app.command(command)['requests'][0]['status'], 'unknown')
            self.assertEqual(spawn.call_count, 1)
        attempt = app.bundle(frozen['id']) / 'attempts' / ('b' * 64)
        attempt.mkdir(parents=True)
        pcgym.write_json(attempt / 'execution.json', dict(spec_id=frozen['id'], attempt_id='b' * 64, status='running'))
        process = ProcessFixture(); process.returncode = 1
        app.processes[frozen['id']] = process
        result = app.command(dict(action='status', specId=frozen['id']))
        self.assertEqual(result['attempts'][0]['status'], 'unknown')
        self.assertEqual(result['requests'][0]['status'], 'unknown')

    def test_numeric_item_is_frozen_and_comparison_never_accepts_fixture(self):
        frozen, _ = self.freeze()
        command = dict(action='create-item', specId=frozen['id'], policy='base',
                       comparison=dict(mode='absolute', tolerance=1))
        with self.assertRaisesRegex(Invalid, 'report value'):
            self.app.command(command)
        annotation = self.store.save_annotation(PdfAnnotation.create(dict(page=20, kind='highlight',
            quote='0.0727', rects=[dict(x=.1, y=.2, width=.1, height=.1)]), self.document, NOW))
        self.audit_command['annotationId'] = annotation.id
        spec, raw, attempt = self.evidence()
        command['specId'] = spec.id
        item = self.app.command(command)
        self.assertEqual(self.app.command(command), item)
        self.assertEqual(PcgymApp(ResearchStore(self.home)).command(dict(action='item', itemId=item['id'])), item)
        self.assertEqual(item['annotation_id'], annotation.id)
        revision = self.app.command({**command, 'comparison': dict(mode='relative', tolerance=.1)})
        self.assertNotEqual(item['id'], revision['id'])
        self.assertEqual(item['spec_id'], revision['spec_id'])
        comparison = self.app.command(dict(action='compare-item', itemId=item['id'], attemptId=raw['attempt_id']))
        self.assertEqual(comparison['execution_status'], 'completed')
        self.assertEqual(comparison['comparison_status'], 'inconclusive')
        self.assertEqual(comparison['paper_verdict'], 'INCONCLUSIVE')
        self.assertIn('unverified_execution_evidence', comparison['reasons'])
        self.assertIsNone(comparison['diagnostic'])
        self.assertIn('id', comparison)
        (attempt / 'execution.log').write_bytes(b'x' * 65537)
        log = self.app.command(dict(action='logs', specId=spec.id, attemptId=raw['attempt_id']))
        self.assertEqual(len(log['text']), 65536)
        self.assertTrue(log['truncated'])
        with self.assertRaises(Invalid):
            self.app.command(dict(action='compare-item', itemId=item['id'], attemptId='f' * 64))

    def test_numeric_selection_does_not_strip_signs_or_exponents(self):
        pages = tuple(PdfPage(p.number, p.width, p.height,
            p.text + ' -0.0727 +0.0727 0.0727e2' if p.number == 20 else p.text)
            for p in self.document.pages)
        document = self.store.save_pdf(PdfDocument.create(self.paper.id, digest(b'signed fixture'),
            self.document.source_url, pages, '2026-11-02T00:00:00Z'), b'signed fixture')
        for quote in ('-0.0727', '+0.0727', '0.0727e2'):
            with self.subTest(quote=quote):
                annotation = self.store.save_annotation(PdfAnnotation.create(dict(page=20,
                    kind='highlight', quote=quote, rects=[dict(x=.1, y=.2, width=.1, height=.1)]), document, NOW))
                self.audit_command['annotationId'] = annotation.id
                frozen, _ = self.freeze()
                with self.assertRaisesRegex(Invalid, 'report value'):
                    self.app.command(dict(action='create-item', specId=frozen['id'], policy='base',
                                          comparison=dict(mode='absolute', tolerance=1)))

    def test_research_handoff_preserves_selected_attempts_and_freezes_the_exported_item(self):
        annotation = self.store.save_annotation(PdfAnnotation.create(dict(page=20, kind='highlight',
            quote='0.0727', rects=[dict(x=.1, y=.2, width=.1, height=.1)]), self.document, NOW))
        self.audit_command['annotationId'] = annotation.id
        spec, raw, target = self.evidence()
        item = self.app.command(dict(action='create-item', specId=spec.id, policy='base',
                                     comparison=dict(mode='absolute', tolerance=.001)))
        failed = target.parent / ('f' * 64)
        failed.mkdir()
        pcgym.write_json(failed / 'execution.json', dict(spec_id=spec.id, attempt_id=failed.name, status='failed', started_at=NOW))
        links = [dict(itemId=item['id'], attemptId=identity) for identity in (raw['attempt_id'], failed.name)]
        create = dict(operation='create', question='Review the measured value', scope='Synthetic fixture',
            inclusion='Frozen attempts', exclusion='Unbound data', paperIds=[self.paper.id],
            decisions=[dict(paperId=self.paper.id, decision='include', reason='Versioned source')], attempts=links)
        record = record_command(self.store, create, NOW)
        self.assertEqual([attempt['status'] for attempt in record['attempts']], ['completed', 'failed'])
        self.assertEqual(record['sourceVersions'][0]['pdfDigest'], self.document.file_digest)
        for denied in (dict(recordId=record['id'], **links[0]),
                       dict(recordId=record['id'], includeNotes=True, **links[1])):
            with self.assertRaises(RequestInvalid):
                record_handoff(self.store, denied)
        exported = record_handoff(self.store, dict(recordId=record['id'], includeNotes=True, **links[0]))
        with ZipFile(BytesIO(exported)) as archive:
            self.assertEqual(json.loads(archive.read('verification-item.json')), json.loads(pcgym.canonical(item)))
            self.assertEqual(json.loads(archive.read('research-record.json')), record)
            self.assertNotIn('local.json', archive.namelist())
            self.assertNotIn('execution.log', archive.namelist())
        self.assertNotIn(create['question'], json.dumps(record_command(self.store, dict(operation='export', recordId=record['id']), NOW)))

    def test_confirmed_terminal_requests_allow_new_attempt_without_rebinding_history(self):
        frozen, _ = self.freeze()
        app = PcgymApp(self.store, checkout=self.checkout, allow_execution=True)
        command = dict(action='start', specId=frozen['id'], requestId='first',
                       confirmation='execute-frozen-local-simulation')
        process = ProcessFixture()
        with patch('paper_agent.pcgym_app.subprocess.Popen', return_value=process) as spawn:
            app.command(command)
            for index, terminal in enumerate(('completed', 'failed', 'cancelled')):
                attempt_id = str(3 - index) * 64  # reverse sort order must not rebind earlier requests
                target = app.bundle(frozen['id']) / 'attempts' / attempt_id
                target.mkdir(parents=True)
                pcgym.write_json(target / 'execution.json', dict(spec_id=frozen['id'],
                    attempt_id=attempt_id, status=terminal))
                process.returncode = 0
                status = app.command(dict(action='status', specId=frozen['id']))
                request = next(r for r in status['requests'] if r['request_id'] == command['requestId'])
                self.assertEqual((request['status'], request['attempt_id']), (terminal, attempt_id))
                app.command(command)  # an identical request is a read, not a launch
                self.assertEqual(spawn.call_count, index + 1)
                if index < 2:
                    command = {**command, 'requestId': f'rerun-{index}'}
                    app.command(command)
                    process.returncode = None
            reopened = PcgymApp(ResearchStore(self.home), checkout=self.checkout, allow_execution=True)
            requests = reopened.command(dict(action='status', specId=frozen['id']))['requests']
            self.assertEqual({r['request_id']: r['attempt_id'] for r in requests},
                             {'first': '3' * 64, 'rerun-0': '2' * 64, 'rerun-1': '1' * 64})
            self.assertEqual(spawn.call_count, 3)

    def test_http_authenticated_roundtrip_and_default_no_execution(self):
        from paper_agent.http import handler
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(self.store, 'fixture-token'))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        def post(value, token='fixture-token'):
            connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            connection.request('POST', '/api/reproduction/step', json.dumps(value),
                {'Content-Type': 'application/json', 'X-Pero-App-Token': token})
            response = connection.getresponse()
            result = response.status, json.loads(response.read())
            connection.close()
            return result
        try:
            with patch('paper_agent.pcgym_app.subprocess.Popen') as spawn:
                self.assertEqual(post(dict(action='case'), 'wrong')[0], 401)
                self.assertEqual(post(dict(action='case'))[1]['execution_available'], False)
                status, audit = post(self.audit_command)
                self.assertEqual(status, 200)
                self.assertEqual(post(self.audit_command), (status, audit))
                command = dict(action='freeze', auditId=audit['id'], profile='smoke', seed=0,
                               includeOracle=False, maxSeconds=30)
                status, frozen = post(command)
                self.assertEqual(status, 200)
                self.assertEqual(post(command), (status, frozen))
                start = dict(action='start', specId=frozen['id'], requestId='one',
                             confirmation='execute-frozen-local-simulation')
                self.assertEqual(post(start)[0], 403)
                self.assertEqual(post({**start, 'allow_execution': True})[0], 400)
                spawn.assert_not_called()
                self.assertEqual(len(self.fetches), 4)
        finally:
            server.shutdown(); worker.join(timeout=3); server.server_close()
