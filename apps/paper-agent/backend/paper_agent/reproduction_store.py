"""PC-Gym handoff in the existing Paper store; one local numerical thread, no Agent loop."""
from dataclasses import asdict
import threading

from .pcgym_audit import SourceEvidence, audit_sources, case_summary, source_url
from .reproduction import (ReproductionError, ReproductionSpec, ResearchClaim, Trajectory,
                           digest, fields, identity, verify)
from . import pcgym_runner


class PcgymResearch:
    def __init__(self, store, fetch=None, environment=None, execute=None, origin='local-pcgym'):
        self.store = store
        self.fetch = fetch
        self.environment = environment or pcgym_runner.observe_environment
        self.execute = execute or pcgym_runner.execute
        self.origin = origin  # Composition-root test seam, never a request argument.
        self.lock = threading.RLock()
        self.thread = None
        self.active = None
        self.cancelled = threading.Event()
        self.progress = {}

    def optional(self, kind, record_id):
        identity(record_id)
        if record_id not in self.store._list(kind):
            return None
        return self.store._read(kind, record_id)

    def source(self, key):
        url = source_url(key)
        if self.fetch is None:
            from .resource_fetch import PublicMetadata
            self.fetch = PublicMetadata().fetch
        document = self.fetch(url)
        source = SourceEvidence.capture(key, document.url, document.text)
        self.store._write('reproduction-sources', source.id, asdict(source))
        return dict(id=source.id, key=source.key, locator=source.locator())

    def audit(self, data):
        fields(data, ('action', 'paperId', 'sourceIds'), ('annotationId',))
        paper = self.store.paper(data['paperId'])
        document = self.store.paper_pdf(paper.id)
        if document is None:
            raise ReproductionError('pdf_required', 'Prepare the saved arXiv v4 PDF through Paper first', 409)
        annotation_id = data.get('annotationId')
        if annotation_id:
            annotation = self.store.annotation(annotation_id)
            if annotation.document_id != document.id or annotation.page != 20:
                raise ReproductionError('anchor', 'The selected annotation must refer to this PDF page 20')
        claim = ResearchClaim.from_document(paper.id, document.id, document.file_digest,
                    document.page(1).text, document.page(20).text, annotation_id)
        source_ids = data['sourceIds']
        if not isinstance(source_ids, list) or len(source_ids) != 4:
            raise ReproductionError('sources', 'Provide four inspected source IDs')
        sources = []
        for record_id in source_ids:
            raw = self.store._read('reproduction-sources', identity(record_id))
            source = SourceEvidence.capture(raw['key'], raw['url'], raw['text'])
            if source.id != record_id:
                raise ReproductionError('source_digest', 'Stored source evidence was changed')
            sources.append(source)
        audit = audit_sources(claim.id, sources)
        self.store._write('reproduction-claims', claim.id, claim.to_dict())
        self.store._write('reproduction-audits', audit.id, audit.to_dict())
        return dict(id=audit.id, claim=claim.to_dict(), **audit.to_dict())

    def spec(self, record_id):
        spec = ReproductionSpec.restore(self.store._read('reproduction-specs', identity(record_id)))
        if spec.id != record_id:
            raise ReproductionError('spec_digest', 'Stored specification digest differs')
        return spec

    def freeze(self, data):
        fields(data, ('action', 'auditId', 'profile', 'seed', 'includeOracle', 'maxSeconds'))
        audit_id = identity(data['auditId'])
        audit = self.store._read('reproduction-audits', audit_id)
        if digest(audit) != audit_id or audit['status'] != 'audited-with-gaps':
            raise ReproductionError('audit', 'A stored, intact source audit is required')
        raw = self.store._read('reproduction-claims', audit['claim_id'])
        claim = ResearchClaim.restore(raw)
        if claim.id != audit['claim_id']:
            raise ReproductionError('claim_digest', 'Stored claim differs from the audit')
        spec = ReproductionSpec.prepare(claim, audit_id, self.environment(),
            {key: data[key] for key in ('profile','seed','includeOracle','maxSeconds')})
        self.store._write('reproduction-specs', spec.id, spec.to_dict())
        return dict(id=spec.id, spec=spec.to_dict(), execution='not-run',
                    paper_comparison='INCONCLUSIVE', requires='explicit local execution confirmation')

    def start(self, data, now):
        fields(data, ('action', 'specId', 'requestId', 'confirmation'), ('acknowledgeInterrupted',))
        if data['confirmation'] != 'execute-frozen-local-simulation':
            raise ReproductionError('confirmation', 'Explicit frozen-plan execution confirmation is required', 403)
        request_id = data['requestId']
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
            raise ReproductionError('request_id', 'A stable request ID is required')
        attempt_id = digest(dict(kind='pcgym-execution', request_id=request_id))
        with self.lock:
            previous = self.optional('reproduction-attempts', attempt_id)
            if previous:
                if previous['spec_id'] != data['specId']:
                    raise ReproductionError('request_conflict', 'This request ID belongs to another frozen spec', 409)
                return self.status(attempt_id)
            spec = self.spec(data['specId'])
            spec.require_environment(self.environment())
            if self.thread and self.thread.is_alive():
                raise ReproductionError('busy', 'Another local simulation is running', 409)
            unresolved = [key for key in self.store._list('reproduction-attempts')
                          if self.optional('reproduction-results', key) is None]
            if unresolved and data.get('acknowledgeInterrupted') is not True:
                raise ReproductionError('interrupted', 'Inspect interrupted attempts before explicitly starting a new one', 409)
            attempt = dict(id=attempt_id, spec_id=spec.id, request_id=request_id, created_at=now,
                           origin=self.origin, acknowledged_interrupted=unresolved, owner='paper-local-numerical-adapter')
            self.store._write('reproduction-attempts', attempt_id, attempt)
            self.active = attempt_id
            self.cancelled = threading.Event()
            self.progress = dict(phase='starting')
            self.thread = threading.Thread(target=self._run, args=(attempt, spec), daemon=True,
                                           name='paper-pcgym-calculation')
            self.thread.start()
            return self.status(attempt_id)

    def _run(self, attempt, spec):
        evidence_ids, status, error = [], 'succeeded', None
        def emit(trace):
            payload = dict(attempt_id=attempt['id'], spec_id=spec.id,
                           trajectory=trace.to_dict(), origin=attempt['origin'])
            record_id = digest(payload)
            self.store._write('reproduction-observations/' + attempt['id'], record_id, payload)
            evidence_ids.append(record_id)
        def progress(value):
            with self.lock:
                self.progress = value
        try:
            self.execute(spec, emit, progress, self.cancelled)
            if self.cancelled.is_set():
                status = 'cancelled'
        except pcgym_runner.RunStopped as stopped:
            status, error = stopped.status, str(stopped)
        except Exception as failure:
            status, error = 'failed', f'{type(failure).__name__}: {str(failure)[:1000]}'
        finally:
            result = dict(attempt_id=attempt['id'], spec_id=spec.id, status=status,
                          evidence_ids=evidence_ids, error=error, origin=attempt['origin'])
            try:
                self.store._write('reproduction-results', attempt['id'], result)
            finally:
                with self.lock:
                    self.active = None
                    self.progress = {}

    def status(self, attempt_id):
        attempt = self.store._read('reproduction-attempts', identity(attempt_id))
        result = self.optional('reproduction-results', attempt_id)
        with self.lock:
            status = result['status'] if result else ('running' if self.active == attempt_id else 'unknown')
            progress = dict(self.progress) if self.active == attempt_id else {}
        return dict(attempt=attempt, status=status, result=result, progress=progress,
                    cancellation_requested=self.cancelled.is_set() if self.active == attempt_id else False,
                    paper_comparison='not-checked')

    def evaluate(self, attempt_id):
        view = self.status(attempt_id)
        if view['status'] == 'running':
            raise ReproductionError('running', 'Wait for the numerical operation to stop', 409)
        spec = self.spec(view['attempt']['spec_id'])
        result = view['result']
        keys = result['evidence_ids'] if result else [key for key in self.store._list('reproduction-observations/' + attempt_id)
            if self.store._read('reproduction-observations/' + attempt_id, key)['attempt_id'] == attempt_id]
        traces = []
        for key in keys:
            value = self.store._read('reproduction-observations/' + attempt_id, key)
            if digest(value) != key or value['attempt_id'] != attempt_id or value['spec_id'] != spec.id:
                raise ReproductionError('evidence_binding', 'Evidence digest or attempt binding does not match')
            traces.append(Trajectory.parse(value['trajectory'], spec))
        report = verify(spec, traces, view['status'], view['attempt']['origin'])
        report.update(attempt_id=attempt_id, evidence_ids=keys, source=spec.claim.to_dict())
        report_id = digest(report)
        self.store._write('reproduction-verifications', report_id, report)
        return dict(id=report_id, **report)

    def command(self, data, now):
        action = data.get('action')
        if action in ('case', 'environment', 'list'):
            fields(data, ('action',))
            if action == 'case': return case_summary()
            if action == 'environment': return self.environment().to_dict()
            return dict(specs=[dict(id=k, spec=self.spec(k).to_dict()) for k in self.store._list('reproduction-specs')],
                        attempts=[self.status(k) for k in self.store._list('reproduction-attempts')])
        if action == 'inspect-source':
            fields(data, ('action','source'))
            return self.source(data['source'])
        if action == 'audit': return self.audit(data)
        if action == 'freeze': return self.freeze(data)
        if action == 'start': return self.start(data, now)
        if action in ('status', 'cancel', 'verify', 'export'):
            fields(data, ('action', 'attemptId'))
            attempt_id = identity(data['attemptId'])
            if action == 'status': return self.status(attempt_id)
            if action == 'cancel':
                self.status(attempt_id)
                with self.lock:
                    if self.active == attempt_id: self.cancelled.set()
                return self.status(attempt_id)
            report = self.evaluate(attempt_id)
            if action == 'verify': return report
            spec = self.spec(report['spec_id'])
            return dict(schema='pero.pcgym-research-package.v1', spec=spec.to_dict(), verification=report,
                audit=self.store._read('reproduction-audits', spec.audit_id),
                attempt=self.status(attempt_id),
                observations=[self.store._read('reproduction-observations/' + attempt_id, k) for k in report['evidence_ids']],
                limitations=['No original paper, repository archive, credentials or model weights are redistributed.',
                             'Independent recalculation is supported; this package is not a blind scientific validation.'])
        raise ReproductionError('action', 'Unknown PC-Gym research operation')

    def close(self):
        self.cancelled.set()
        if self.thread:
            self.thread.join(timeout=2)
