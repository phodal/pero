"""Paper persistence/HTTP adapter for the single PC-Gym CLI and frozen core.

No execution authority is obtained from an HTTP body or a source document.
The shipped server has no trusted checkout and therefore cannot start compute.
"""
from dataclasses import asdict
import json
import platform
import re
import subprocess
import sys
import threading
from pathlib import Path

from . import pcgym
from .model import Invalid as RequestInvalid, PdfPassage
from .pcgym_domain import (Claim, COMMIT, Invalid, PaperAnchor, ReproductionSpec,
                           canonical, digest, fields, identifier)
from .pcgym_sources import (PINS, SourceFile, audit_sources, package_inventory,
                            pipeline_digest, read_checkout)


class PcgymApp:
    def __init__(self, store, *, fetch=None, checkout=None, allow_execution=False):
        self.store, self.fetch = store, fetch
        self.checkout, self.allow_execution = checkout, allow_execution
        self.lock = threading.RLock()
        self.processes = {}

    def save(self, kind, value):
        # Immutable store compares decoded JSON: normalize tuple-bearing core values once.
        value = json.loads(canonical(value))
        key = digest(value)
        self.store._write('pcgym-' + kind, key, value)
        return key

    def read(self, kind, key):
        identifier(key, kind)
        value = self.store._read('pcgym-' + kind, key)
        if digest(value) != key:
            raise Invalid('record_changed', 'Saved reproduction evidence has changed')
        return value

    def source(self, name):
        if name not in PINS:
            raise Invalid('source', 'Choose one of the four pinned case source paths')
        url = f'https://raw.githubusercontent.com/MaximilianB2/pc-gym/{COMMIT}/{name}'
        fetch = self.fetch
        if fetch is None:
            from .resource_fetch import PublicMetadata
            fetch = PublicMetadata().fetch
        document = fetch(url)
        if document.url != url:
            raise Invalid('source_url', 'Pinned source fetch must retain its exact URL')
        source = SourceFile.parse(name, document.text.encode('utf-8'), PINS[name])
        return dict(id=self.save('sources', asdict(source)), **source.manifest())

    def binding(self, paper_id, annotation_id=None):
        paper = self.store.paper(paper_id)
        document = self.store.paper_pdf(paper.id)
        if document is None:
            raise Invalid('pdf_required', 'Save the arXiv v4 PDF in Paper first')
        if '2410.22093v4' not in re.sub(r'\s+', '', document.page(1).text):
            raise Invalid('paper_version', 'This case requires the saved arXiv 2410.22093v4 PDF')
        page = document.page(20)
        compact = re.sub(r'\s+', '', page.text).lower()
        for marker in ('table6', 'basereward0.0727', 'shapedreward0.0003', 'oracle0.0000', 'episodes', 'trajectory'):
            if marker not in compact:
                raise Invalid('claim_source', 'Cannot locate Table 6 / Equation 37 on saved PDF page 20')
        if annotation_id is not None:
            annotation = self.store.annotation(annotation_id)
            if annotation.document_id != document.id or annotation.page != 20:
                raise Invalid('annotation', 'Annotation must belong to this PDF version and page 20')
        passage = PdfPassage.create(paper.id, document.id, document.file_digest, 20, 0, page.text)
        anchor = PaperAnchor.parse(dict(paper_id=paper.id, document_id=document.id,
            file_digest=document.file_digest.removeprefix('sha256:'), passage_id=passage.id, page=20))
        return dict(anchor=asdict(anchor), passage=passage.to_dict(), annotation_id=annotation_id,
                    paper_content_digest=paper.content_digest)

    def audit(self, data):
        fields(data, ('action', 'paperId', 'sourceIds'), ('annotationId',))
        ids = data['sourceIds']
        if not isinstance(ids, list) or len(ids) != 4 or len(set(ids)) != 4:
            raise Invalid('sources', 'Provide four distinct pinned source IDs')
        sources = []
        for key in ids:
            raw = self.read('sources', key)
            source = SourceFile.parse(raw['path'], raw['text'].encode('utf-8'), PINS[raw['path']])
            if asdict(source) != raw:
                raise Invalid('source_changed', 'Stored source metadata has changed')
            sources.append(source)
        audit = audit_sources(sources, pinned=True)
        value = dict(audit=audit, claim=Claim().to_dict(), source_ids=sorted(ids),
                     binding=self.binding(data['paperId'], data.get('annotationId')))
        key = self.save('audits', value)
        return dict(id=key, **value)

    def freeze(self, data):
        fields(data, ('action', 'auditId', 'profile', 'seed', 'includeOracle', 'maxSeconds'))
        audited = self.read('audits', data['auditId'])
        binding = audited['binding']
        if self.binding(binding['anchor']['paper_id'], binding['annotation_id']) != binding:
            raise Invalid('pdf_changed', 'Saved Paper/PDF version changed; audit the new version explicitly')
        # HTTP cannot select a filesystem path or an interpreter.
        if self.checkout is None:
            raise Invalid('checkout_unavailable', 'A trusted fixed checkout must be configured before freezing a runnable specification')
        checkout, sources, manifest = read_checkout(self.checkout)
        if sorted(audited['audit']['source_manifest'], key=lambda f: f['path']) != sorted(manifest['files'], key=lambda f: f['path']):
            raise Invalid('source_changed', 'Execution checkout differs from the inspected source bytes')
        spec = ReproductionSpec.create(seed=data['seed'], profile=data['profile'],
            packages=package_inventory(), source_manifest_digest=digest(manifest),
            python_version=platform.python_version(), pipeline_digest=pipeline_digest(),
            timeout_seconds=data['maxSeconds'], anchor=PaperAnchor.parse(binding['anchor']),
            include_oracle=data['includeOracle'], paper_binding_digest=digest(binding))
        with self.lock:
            root = self.bundle(spec.id)
            root.mkdir(parents=True, exist_ok=True)
            for name, value in {'spec': spec.to_dict(), 'audit': audited['audit'], 'claim': audited['claim'],
                                'source-manifest': manifest, 'paper-binding': binding,
                                'local': dict(checkout=str(checkout), interpreter=sys.executable)}.items():
                path = root / (name + '.json')
                if path.exists():
                    if pcgym.read_json(path) != json.loads(canonical(value)):
                        raise Invalid('bundle_changed', 'Frozen bundle conflicts with saved content')
                else:
                    pcgym.write_json(path, value)
        return dict(id=spec.id, spec=spec.to_dict(), execution='not-run', paper_verdict='INCONCLUSIVE',
                    execution_available=self.allow_execution)

    def bundle(self, spec_id):
        identifier(spec_id, 'spec_id')
        return pcgym.root_path(self.store.root / 'pcgym-bundles' / spec_id)

    def frozen_binding(self, root, spec):
        binding = pcgym.read_json(root / 'paper-binding.json')
        if digest(binding) != spec.paper_binding_digest or binding['anchor'] != asdict(spec.anchor):
            raise Invalid('binding_changed', 'Paper binding differs from the frozen specification')
        return binding

    def status(self, spec_id):
        root = self.bundle(spec_id)
        value = pcgym.status(root)
        for attempt in value['attempts']:
            # Restart never treats a stale receipt as a live execution or replays it.
            if attempt['status'] == 'running' and (spec_id not in self.processes or self.processes[spec_id].poll() is not None):
                attempt['status'] = 'unknown'
        requests = []
        for key in self.store._list('pcgym-requests'):
            request = self.store._read('pcgym-requests', key)
            if request['spec_id'] != spec_id:
                continue
            new = [a for a in value['attempts'] if a['attempt_id'] not in request['prior_attempt_ids']]
            process = self.processes.get(spec_id)
            requests.append(dict(request_id=request['request_id'],
                status=new[0]['status'] if new else ('starting' if process is not None and process.poll() is None else 'unknown')))
        value['requests'] = requests
        return value

    def start(self, data):
        fields(data, ('action', 'specId', 'requestId', 'confirmation'))
        if not self.allow_execution or self.checkout is None:
            raise RequestInvalid('Local compute is not enabled by the trusted composition root', 403)
        if data['confirmation'] != 'execute-frozen-local-simulation':
            raise RequestInvalid('Explicit frozen-spec execution confirmation is required', 403)
        request_id = data['requestId']
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
            raise Invalid('request_id', 'Use a stable request ID of 1–128 characters')
        root = self.bundle(data['specId'])
        spec = pcgym.load_spec(root)
        binding = self.frozen_binding(root, spec)
        if self.binding(binding['anchor']['paper_id'], binding['annotation_id']) != binding:
            raise Invalid('pdf_changed', 'Paper/PDF version changed since freeze')
        if str(Path(self.checkout).absolute()) != pcgym.read_json(root / 'local.json')['checkout']:
            raise Invalid('checkout_changed', 'Trusted checkout changed since freeze')
        key = digest(dict(request_id=request_id))
        with self.lock:
            if key in self.store._list('pcgym-requests'):
                prior = self.store._read('pcgym-requests', key)
                if prior['spec_id'] != spec.id:
                    raise RequestInvalid('Request ID belongs to another specification', 409)
                return self.status(spec.id)
            if any(self.store._read('pcgym-requests', previous)['spec_id'] == spec.id
                   for previous in self.store._list('pcgym-requests')):
                raise RequestInvalid('This frozen spec already has a launch request; inspect its original request instead of replaying', 409)
            unresolved = any(request['status'] in ('running', 'starting', 'unknown')
                for previous in self.store._list('pcgym-requests')
                for request in self.status(self.store._read('pcgym-requests', previous)['spec_id'])['requests'])
            if unresolved or any(process.poll() is None for process in self.processes.values()) or (root / 'running.lock').exists():
                raise RequestInvalid('A live or interrupted operation requires reconciliation before retry', 409)
            self.store._write('pcgym-requests', key, dict(spec_id=spec.id, request_id=request_id,
                prior_attempt_ids=[a['attempt_id'] for a in self.status(spec.id)['attempts']]))
            # Reuse the CLI's sole runtime owner, timeout, cancellation and checker.
            self.processes[spec.id] = subprocess.Popen([sys.executable, '-m', 'paper_agent.pcgym',
                'run', '--bundle', str(root), '--spec-sha', spec.id,
                '--confirm-execution', '--accept-audit-findings'],
                cwd=str(Path(__file__).resolve().parents[1]), stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return dict(spec_id=spec.id, status='starting', paper_verdict='INCONCLUSIVE')

    def command(self, data):
        action = data.get('action')
        if action == 'case':
            fields(data, ('action',))
            return dict(claim=Claim().to_dict(), sources=list(PINS), execution_available=self.allow_execution,
                        paper_verdict='INCONCLUSIVE')
        if action == 'inspect-source':
            fields(data, ('action', 'source'))
            return self.source(data['source'])
        if action == 'audit': return self.audit(data)
        if action == 'freeze': return self.freeze(data)
        if action == 'start': return self.start(data)
        if action in ('status', 'cancel'):
            fields(data, ('action', 'specId'))
            with self.lock:
                requested = False
                if action == 'cancel':
                    process = self.processes.get(data['specId'])
                    if process is not None and process.poll() is None:
                        process.terminate()
                        requested = True
                result = self.status(data['specId'])
                result['cancellation_requested'] = requested
                return result
        if action in ('verify', 'export'):
            fields(data, ('action', 'specId', 'attemptId'))
            root = self.bundle(data['specId'])
            spec = pcgym.load_spec(root)
            binding = self.frozen_binding(root, spec)
            report = pcgym.check_attempt(root, data['attemptId'])
            if action == 'verify': return report
            if report['numeric_recomputation'] != 'PASS':
                raise Invalid('integrity', 'Cannot export changed observation bytes')
            target = pcgym.attempt_directory(root, data['attemptId'])
            return dict(spec=pcgym.load_spec(root).to_dict(), verification=report,
                observation=pcgym.read_json(target / 'observations.json'),
                receipt=pcgym.read_json(target / 'execution.json'),
                audit=pcgym.read_json(root / 'audit.json'),
                binding=binding,
                limitation='JSON evidence view; CLI export supplies the portable offline checker. No scientific acceptance.')
        raise Invalid('action', 'Unknown PC-Gym operation')

    def close(self):
        for process in self.processes.values():
            if process.poll() is None:
                process.terminate()
        for process in self.processes.values():
            try:
                process.wait(timeout=12)
            except subprocess.TimeoutExpired:
                pass  # Unknown remains unknown; never erase lock or replay an operation.
