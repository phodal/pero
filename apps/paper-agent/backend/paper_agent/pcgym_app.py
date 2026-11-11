"""Paper persistence/HTTP adapter for the single PC-Gym CLI and frozen core.

No execution authority is obtained from an HTTP body or a source document.
The shipped server has no trusted checkout and therefore cannot start compute.
"""
from dataclasses import asdict
from io import BytesIO
import json
import secrets
import re
import subprocess
import sys
import threading
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

from . import pcgym
from .model import Invalid as RequestInvalid, PdfPassage
from .pcgym_domain import (Claim, COMMIT, Invalid, PaperAnchor, ReproductionSpec,
                           canonical, digest, fields, identifier, EPISODE_METRIC, PAPER)
from .verification import ComparisonEvidence, VerificationItem, ReproductionApproval
from .research_records import ResearchAttempt
from .reproduction_approval import (ApprovalCommand, ApprovalState, ApprovalDecision,
    ApprovalDenied, ApprovalUnavailable, PendingApproval, ExecutionFacts, dispatch_failure)
from .pcgym_sources import (PINS, SourceFile, audit_sources,
                            pipeline_digest, read_checkout)
from .scientific_python import ScientificPython, interpreter_environment, observe as observe_scientific_python


class PcgymApp:
    def __init__(self, store, *, fetch=None, checkout=None, allow_execution=False, scientific_python=None):
        self.store, self.fetch = store, fetch
        self.checkout, self.allow_execution = checkout, allow_execution
        self.scientific_python = str(scientific_python or sys.executable)
        self.lock = threading.RLock()
        self.processes = {}
        self.process_requests = {}
        self.pending_approvals = {}
        self.closed = False

    def selected_runtime(self):
        binding = self.store.root.parent / '.compute' / 'binding.json'
        if binding.exists():
            value = pcgym.read_json(binding)
            return observe_scientific_python(str(Path(value['root']) / 'bin/python'), binding)
        return observe_scientific_python(self.scientific_python)

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
        selection_anchor = None
        if annotation_id is not None:
            annotation = self.store.annotation(annotation_id)
            if annotation.document_id != document.id or annotation.page != 20:
                raise Invalid('annotation', 'Annotation must belong to this PDF version and page 20')
            if annotation.anchor is not None:
                selection_anchor = annotation.anchor.check(document, annotation.quote).to_dict()
        passage = PdfPassage.create(paper.id, document.id, document.file_digest, 20, 0, page.text)
        anchor = PaperAnchor.parse(dict(paper_id=paper.id, document_id=document.id,
            file_digest=document.file_digest.removeprefix('sha256:'), passage_id=passage.id, page=20))
        return dict(anchor=asdict(anchor), passage=passage.to_dict(), annotation_id=annotation_id,
                    paper_content_digest=paper.content_digest, selection_anchor=selection_anchor)

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
        runtime = self.selected_runtime()
        spec = ReproductionSpec.create(seed=data['seed'], profile=data['profile'],
            packages=dict(runtime.packages), source_manifest_digest=digest(manifest),
            python_version=runtime.python_version, pipeline_digest=pipeline_digest(), scientific_runtime_digest=runtime.identity,
            timeout_seconds=data['maxSeconds'], anchor=PaperAnchor.parse(binding['anchor']),
            include_oracle=data['includeOracle'], paper_binding_digest=digest(binding))
        with self.lock:
            root = self.bundle(spec.id)
            root.mkdir(parents=True, exist_ok=True)
            frozen = {'spec': spec.to_dict(), 'audit': audited['audit'], 'claim': audited['claim'],
                                'source-manifest': manifest, 'paper-binding': binding,
                                'local': dict(checkout=str(checkout), interpreter=runtime.executable, scientific_runtime=runtime.to_dict())}
            if runtime.prepared_profile:
                frozen['compute-profile'] = pcgym.read_json(self.store.root.parent / '.compute/binding.json')
                if digest(frozen['compute-profile']) != runtime.prepared_profile:
                    raise Invalid('environment_changed', 'Compute selection changed during freeze; retry explicitly')
            for name, value in frozen.items():
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
        # Bind a request once, before permitting another attempt. Old records without
        # an unambiguous receipt remain unknown, never guessed by directory order.
        assignments = {key: self.store._read('pcgym-request-attempts', key)['attempt_id']
                       for key in self.store._list('pcgym-request-attempts')}
        for key in self.store._list('pcgym-requests'):
            request = self.store._read('pcgym-requests', key)
            if request['spec_id'] != spec_id:
                continue
            attempt_id = assignments.get(key)
            if attempt_id is None:
                new = [a for a in value['attempts']
                       if a['attempt_id'] not in request['prior_attempt_ids']
                       and a['attempt_id'] not in assignments.values()]
                if len(new) == 1:
                    attempt_id = new[0]['attempt_id']
                    self.store._write('pcgym-request-attempts', key, dict(attempt_id=attempt_id))
                    assignments[key] = attempt_id
            attempt = next((a for a in value['attempts'] if a['attempt_id'] == attempt_id), None)
            process = self.processes.get(spec_id)
            requests.append(dict(request_id=request['request_id'], attempt_id=attempt_id,
                status=attempt['status'] if attempt else
                    ('starting' if process is not None and process.poll() is None else 'unknown')))
        value['requests'] = requests
        return value

    def start(self, data, *, approval_digest=None):
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
        local = pcgym.read_json(root / 'local.json')
        key = digest(dict(request_id=request_id))
        with self.lock:
            if key in self.store._list('pcgym-requests'):
                prior = self.store._read('pcgym-requests', key)
                if prior['spec_id'] != spec.id:
                    raise RequestInvalid('Request ID belongs to another specification', 409)
                return self.status(spec.id)
            unresolved = any(request['status'] not in ('completed', 'failed', 'cancelled')
                for previous in self.store._list('pcgym-requests')
                for request in self.status(self.store._read('pcgym-requests', previous)['spec_id'])['requests'])
            current = self.status(spec.id)
            unresolved = unresolved or any(a['status'] not in ('completed', 'failed', 'cancelled')
                                           for a in current['attempts'])
            if unresolved or any(process.poll() is None for process in self.processes.values()) or (root / 'running.lock').exists():
                raise RequestInvalid('A live or interrupted operation requires reconciliation before retry', 409)
            runtime = self.selected_runtime()
            if local.get('interpreter') != runtime.executable:
                raise Invalid('execution_configuration_changed', 'Scientific interpreter differs from the frozen selection')
            runtime.require(spec, ScientificPython.parse(local['scientific_runtime']) if 'scientific_runtime' in local else None)
            environment = interpreter_environment()
            if runtime.prepared_profile is not None:
                if approval_digest is None:
                    raise Invalid('approval_required', 'Managed computation requires the original private Host approval')
                from pero_scientific import owner_environment
                environment.update(owner_environment(), PERO_SCIENTIFIC_APPROVAL=approval_digest)
            self.store._write('pcgym-requests', key, dict(spec_id=spec.id, request_id=request_id,
                prior_attempt_ids=[a['attempt_id'] for a in self.status(spec.id)['attempts']]))
            # Reuse the CLI's sole runtime owner, timeout, cancellation and checker.
            self.processes[spec.id] = subprocess.Popen([runtime.executable, '-E', '-s', '-B', '-m', 'paper_agent.pcgym',
                'run', '--bundle', str(root), '--spec-sha', spec.id,
                '--confirm-execution', '--accept-audit-findings'],
                cwd=str(Path(__file__).resolve().parents[1]), env=environment, stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.process_requests[spec.id] = request_id
        return dict(spec_id=spec.id, status='starting', paper_verdict='INCONCLUSIVE')

    def create_item(self, data):
        fields(data, ('action', 'specId', 'policy', 'comparison'))
        root = self.bundle(data['specId'])
        spec = pcgym.load_spec(root)
        binding = self.frozen_binding(root, spec)
        annotation_id = binding['annotation_id']
        if annotation_id is None:
            raise Invalid('annotation_required', 'Select a reported numeric result before creating an item')
        annotation = self.store.annotation(annotation_id)
        if not binding.get('selection_anchor') or binding['selection_anchor'].get('verification') != 'pdf-region':
            raise Invalid('region_required', 'Select a version-bound PDF region before freezing a numeric item')
        item = VerificationItem.create(spec, annotation_id, data['policy'], data['comparison'])
        # The fixed case knows its three reported values; arbitrary text is not a claim.
        numbers = re.findall(r'(?<![\w.+-])(?:\d+\.\d+)(?![\w.])', annotation.quote)
        if f'{item.reported:.4f}' not in numbers:
            raise Invalid('reported_selection', 'The frozen annotation must contain this policy report value')
        key = self.save('items', item.payload())
        return dict(id=key, **item.payload())

    def item(self, item_id):
        raw = self.read('items', item_id)
        spec = pcgym.load_spec(self.bundle(raw['spec_id']))
        item = VerificationItem.create(spec, raw['annotation_id'], raw['policy'], raw['comparison'])
        if json.loads(canonical(item.payload())) != raw:
            raise Invalid('item_changed', 'Frozen verification item differs from its fixed case')
        return item, spec

    def compare_item(self, data):
        fields(data, ('action', 'itemId', 'attemptId'))
        item, spec = self.item(data['itemId'])
        root = self.bundle(spec.id)
        self.frozen_binding(root, spec)
        attempt = next((a for a in self.status(spec.id)['attempts']
                        if a['attempt_id'] == data['attemptId']), None)
        if attempt is None:
            raise Invalid('attempt', 'Choose an existing attempt belonging to this item')
        actual, coverage, integrity, metrics = None, False, False, []
        if attempt['status'] == 'completed':
            report = pcgym.check_attempt(root, data['attemptId'])
            metrics = report['metrics']
            metric = next(m for m in metrics if m['policy'] == item.policy)
            actual = metric['episode_fraction']
            coverage = (metric['total_episodes'] == spec.episodes
                        and metric['total_samples'] == spec.episodes * spec.samples
                        and report['policy_coverage'] == list(spec.policies))
            integrity = (report['numeric_recomputation'] == 'PASS'
                         and report['execution_evidence'] == 'CONSISTENT')
        comparison = item.compare(ComparisonEvidence(spec.id, PAPER, EPISODE_METRIC,
            coverage, attempt['status'], actual, integrity))
        # Only terminal comparisons are immutable evidence, not transient UI state.
        result = dict(**comparison, attempt_id=data['attemptId'])
        if attempt['status'] in ('completed', 'failed', 'cancelled'):
            result['id'] = self.save('comparisons', result)
        return dict(result, metrics=metrics)

    def evidence_archive(self, item_id, attempt_id, *, research_record=None):
        item, spec = self.item(item_id)
        root = self.bundle(spec.id)
        self.frozen_binding(root, spec)
        archive = BytesIO()
        pcgym.export(root, attempt_id, archive, verification_item=item.to_dict(), research_record=research_record)
        if research_record is not None:
            # Handoff instructions can improve without changing the frozen compute pipeline.
            with ZipFile(archive, 'a', compression=ZIP_DEFLATED) as bundle:
                bundle.writestr('README.md', f'''# Research handoff: PC-Gym Table 6

Unpack the ZIP in a new directory. Read `research-record.json`, `spec.json`,
and `audit.json` before deciding whether to rerun. The selected PDF passage
and numeric evidence are included. Data Workspace pins, if present, are
revision references; this PC-Gym method does not consume their data.

## Verify the saved result

From the unpacked directory, run `python3.12 -E -s -S verify.py`.
Python 3.10 or newer is required. No packages, model, or network are needed.
A numeric PASS confirms the saved counts. The separate paper verdict reflects
the unresolved original experiment and metric grain.

## Rerun the frozen method

Provision Python {spec.python_version} with the exact package versions in
`spec.json`, a clean PC-Gym checkout at `{COMMIT}`, and a Pero
Paper backend matching `pipeline_digest` in the spec. These are supplied
separately from the archive. The CLI preflight checks them before compute.

From the unpacked directory, set the three absolute paths below, then run:

```sh
export PYTHONPATH=/absolute/path/to/pero/apps/paper-agent/backend
science_python=/absolute/path/to/scientific-venv/bin/python
checkout=/absolute/path/to/pinned-pc-gym
bundle=$(pwd -P)
"$science_python" -c 'import json, pathlib, sys; pathlib.Path("local.json").write_text(json.dumps({{"checkout":str(pathlib.Path(sys.argv[1]).resolve()),"interpreter":sys.executable}}))' "$checkout"
"$science_python" -m paper_agent.pcgym run --bundle "$bundle" \\
  --spec-sha {spec.id} --confirm-execution --accept-audit-findings
```

Run the last command only if you approve this exact spec and accept its audit
findings. It creates a new attempt. Verify that attempt using its returned ID:

```sh
"$science_python" -m paper_agent.pcgym verify --bundle "$bundle" --attempt ATTEMPT_ID
```

Keep `local.json` out of shared copies; it contains local paths.
''')
        return archive.getvalue()

    def research_attempts(self, paper_ids):
        rows = []
        for item_id in self.store._list('pcgym-items'):
            item, spec = self.item(item_id)
            if spec.anchor.paper_id not in paper_ids:
                continue
            root = self.bundle(spec.id)
            self.frozen_binding(root, spec)
            for attempt in pcgym.status(root)['attempts']:
                if attempt['spec_id'] == spec.id and attempt['status'] in ('completed', 'failed', 'cancelled'):
                    rows.append(ResearchAttempt(spec.anchor.paper_id, spec.anchor.document_id, item.annotation_id, spec.anchor.page,
                        item.id, spec.id, attempt['attempt_id'], item.policy, spec.profile, spec.seed,
                        spec.pipeline_digest, attempt['status'], attempt['started_at']))
        return tuple(sorted(rows, key=lambda row: (row.startedAt, row.attemptId), reverse=True))

    def prepare_item(self, data):
        fields(data, ('action', 'annotationId', 'policy', 'comparison', 'profile', 'seed', 'includeOracle', 'maxSeconds'))
        if self.checkout is None:
            raise RequestInvalid('No trusted local PC-Gym checkout is configured', 403)
        annotation = self.store.annotation(data['annotationId'])
        _checkout, sources, _manifest = read_checkout(self.checkout)
        source_ids = [self.save('sources', asdict(source)) for source in sources]
        audit = self.audit(dict(action='audit', paperId=annotation.paper_id,
                                annotationId=annotation.id, sourceIds=source_ids))
        frozen = self.freeze(dict(action='freeze', auditId=audit['id'], profile=data['profile'],
                                  seed=data['seed'], includeOracle=data['includeOracle'], maxSeconds=data['maxSeconds']))
        return self.create_item(dict(action='create-item', specId=frozen['id'],
                                     policy=data['policy'], comparison=data['comparison']))

    def approval_binding(self, data):
        item, spec = self.item(data['itemId'])
        if spec.id != data['specId']:
            raise Invalid('wrong_spec', 'The selected item belongs to another frozen specification')
        root = self.bundle(spec.id)
        binding = self.frozen_binding(root, spec)
        if self.binding(binding['anchor']['paper_id'], binding['annotation_id']) != binding:
            raise Invalid('pdf_changed', 'The selected Paper/PDF changed since freeze')
        local = pcgym.read_json(root / 'local.json')
        if self.checkout is None or str(Path(self.checkout).absolute()) != local.get('checkout'):
            raise Invalid('execution_configuration_changed', 'The trusted checkout or interpreter differs from the frozen specification')
        runtime = self.selected_runtime()
        if local.get('interpreter') != runtime.executable:
            raise Invalid('execution_configuration_changed', 'Scientific interpreter differs from frozen selection')
        runtime.require(spec, ScientificPython.parse(local['scientific_runtime']) if 'scientific_runtime' in local else None)
        # Legacy bundles retain their bytes; a new approval still binds a fresh observation.
        return ReproductionApproval.create(item, spec, data['requestId'], binding,
            {**local, 'scientific_runtime': runtime.to_dict()}), item, spec

    def approval_outcome(self, approval, state, reason=''):
        result = dict(state=state, itemId=approval.item_id, specId=approval.spec_id,
                      requestId=approval.request_id, paperVerdict='INCONCLUSIVE', reason=reason)
        if state == 'allowed':
            if approval.key in self.store._list('pcgym-approval-dispatch'):
                return {**result, **self.store._read('pcgym-approval-dispatch', approval.key)}
            status = self.status(approval.spec_id)
            request = next((r for r in status['requests'] if r['request_id'] == approval.request_id), None)
            result.update(status=request['status'] if request else 'unknown')
            if request and request.get('attempt_id'):
                result['attemptId'] = request['attempt_id']
        return result

    def approval_summary(self, approval, item, spec):
        summary = (f'Run fixed PC-Gym {spec.profile} locally?\n'
            f'Item: {item.id}\nSpecification: {spec.id}\nRequest: {approval.request_id}\n'
            f'Reported {item.policy}: {item.reported}; paper {item.paper_version}\n'
            f'PDF page {spec.anchor.page}; annotation {item.annotation_id}\n'
            f'PDF SHA-256: {spec.anchor.file_digest}\n'
            f'CPU; {spec.steps} training steps; {spec.episodes} episodes × {spec.samples} samples; '
            f'policies: {", ".join(spec.policies)}; worker wall-time limit: {spec.timeout_seconds}s\n'
            f'Seed: {spec.seed}; code commit: {spec.commit}\n'
            f'Python: {spec.python_version}; packages: {dict(spec.packages)}\n'
            f'Pipeline: {spec.pipeline_digest}\n'
            'Command: configured Python -m paper_agent.pcgym run (this frozen spec only)\n'
            + '\n'.join(spec.deviations()) + '\n' +
            'This runs pinned code with the configured local interpreter. No installation or download is performed.\n'
            'Original metric and experiment identity remain unresolved. Paper verdict remains INCONCLUSIVE.')
        local = pcgym.read_json(self.bundle(spec.id) / 'local.json')
        runtime = local.get('scientific_runtime', {})
        if runtime.get('prepared_profile'):
            summary += f"\nManaged Compute Profile: {runtime['prepared_profile']}\nInstalled content: {runtime['installation']}"
        else:
            summary += '\nObserved existing environment; no complete preparation lock is claimed.'
        return summary

    def host_command(self, data):
        """Private Host transport: load facts, apply core intents, map I/O errors."""
        with self.lock:
            try:
                command = ApprovalCommand.parse(data, available=not self.closed and self.allow_execution)
            except ApprovalUnavailable as error:
                raise RequestInvalid(str(error), 403) from error
            key = command.key
            requests = self.store._list('pcgym-approval-requests')
            decisions = self.store._list('pcgym-approval-decisions')
            state = ApprovalState(
                saved=ReproductionApproval(**self.store._read('pcgym-approval-requests', key)) if key in requests else None,
                decision=ApprovalDecision(**self.store._read('pcgym-approval-decisions', key)) if key in decisions else None,
                pending=self.pending_approvals.get(key))
            approval = state.binding_for(command)
            item = spec = None
            if approval is None:
                approval, item, spec = self.approval_binding(data)
            busy = False
            if state.needs_execution_status(command):
                status = self.status(command.spec_id)
                busy = ExecutionFacts(status['execution_lock_present'],
                    tuple(a['status'] for a in status['attempts']),
                    tuple(r['status'] for r in status['requests'])).busy
            process = self.processes.get(command.spec_id)
            try:
                plan = state.transition(command, approval, busy=busy,
                    owner_request_id=self.process_requests.get(command.spec_id),
                    owner_live=process is not None and process.poll() is None)
            except ApprovalDenied as error:
                raise RequestInvalid(str(error), 403) from error
            # Capabilities are consumed before durable decision persistence, and
            # no worker dispatch can occur if either step fails.
            if plan.pending_action == 'consume':
                self.pending_approvals.pop(key, None)
            if plan.save_approval:
                self.store._write('pcgym-approval-requests', key, approval.to_dict())
            if plan.save_decision is not None:
                self.store._write('pcgym-approval-decisions', key, plan.save_decision.to_dict())
            if plan.pending_action == 'new':
                self.pending_approvals[key] = PendingApproval(secrets.token_hex(32), approval)
            if plan.outcome == 'requires-approval':
                pending = self.pending_approvals[key]
                return dict(state=plan.outcome, ticket=pending.ticket, bindingDigest=approval.digest,
                            summary=self.approval_summary(approval, item, spec))
            if plan.dispatch:
                try:
                    self.start(dict(action='start', specId=approval.spec_id, requestId=approval.request_id,
                                    confirmation='execute-frozen-local-simulation'), approval_digest=approval.digest)
                except (Invalid, RequestInvalid, OSError):
                    failure = dispatch_failure(key in self.store._list('pcgym-requests'))
                    if failure.persist:
                        self.store._write('pcgym-approval-dispatch', key, failure.to_dict())
                    if failure.propagate:
                        raise
            if plan.cancel_matching:
                process.terminate()
            try:
                return self.approval_outcome(approval, plan.outcome, plan.reason)
            except (Invalid, RequestInvalid, OSError):
                if command.operation != 'cancel':
                    raise
                return dict(state=plan.outcome, status='unknown', itemId=approval.item_id,
                    specId=approval.spec_id, requestId=approval.request_id, paperVerdict='INCONCLUSIVE',
                    reason='Cancellation requested; stored evidence unavailable' if plan.cancel_matching else
                           'Execution evidence unavailable; no matching live owner was found')

    def command(self, data):
        action = data.get('action')
        if action == 'prepare-item': return self.prepare_item(data)
        if action == 'annotation-evidence':
            fields(data, ('action', 'annotationId'))
            self.store.annotation(data['annotationId'])
            items = []
            for key in self.store._list('pcgym-items'):
                item, spec = self.item(key)
                if item.annotation_id == data['annotationId']:
                    status = self.status(spec.id)
                    requests = {r['request_id']: r for r in status['requests']}
                    for approval_key in self.store._list('pcgym-approval-requests'):
                        approval = ReproductionApproval(**self.store._read('pcgym-approval-requests', approval_key))
                        if approval.spec_id != spec.id:
                            continue
                        if approval.request_id in requests:
                            requests[approval.request_id]['item_id'] = approval.item_id
                            continue
                        if approval.item_id != item.id:
                            continue
                        if approval_key in self.store._list('pcgym-approval-decisions'):
                            decision = self.store._read('pcgym-approval-decisions', approval_key)
                            outcome = self.approval_outcome(approval, decision['state'])
                            state = outcome.get('status', outcome['state'])
                        else:
                            state = 'awaiting_approval' if approval_key in self.pending_approvals else 'unknown'
                        requests[approval.request_id] = dict(request_id=approval.request_id, item_id=approval.item_id, status=state)
                    items.append(dict(item=item.to_dict(), spec=spec.to_dict(), **{**status, 'requests': list(requests.values())}))
            return dict(items=items, executionAvailable=self.allow_execution and self.checkout is not None)
        if action == 'create-item': return self.create_item(data)
        if action == 'compare-item': return self.compare_item(data)
        if action == 'item':
            fields(data, ('action', 'itemId'))
            return self.item(data['itemId'])[0].to_dict()
        if action == 'logs':
            fields(data, ('action', 'specId', 'attemptId'))
            root = self.bundle(data['specId'])
            pcgym.load_spec(root)
            target = pcgym.attempt_directory(root, data['attemptId'])
            path = target / 'execution.log'
            if path.is_symlink() or not path.is_file():
                raise Invalid('log_unavailable', 'No saved execution log is available for this attempt')
            with path.open('rb') as stream:
                content = stream.read(65537)
            return dict(spec_id=data['specId'], attempt_id=data['attemptId'],
                        text=content[:65536].decode('utf-8', errors='replace'),
                        truncated=len(content) > 65536)
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
        with self.lock:
            self.closed = True
            plans = tuple(ApprovalState(pending=pending).close()
                          for pending in self.pending_approvals.values())
            self.pending_approvals.clear()
        try:
            for plan in plans:
                self.store._write('pcgym-approval-decisions', plan.approval.key, plan.save_decision.to_dict())
        finally:
            # Evidence I/O failure must not skip the existing process cleanup.
            for process in self.processes.values():
                if process.poll() is None:
                    process.terminate()
            for process in self.processes.values():
                try:
                    process.wait(timeout=12)
                except subprocess.TimeoutExpired:
                    pass  # Unknown remains unknown; never erase lock or replay an operation.
