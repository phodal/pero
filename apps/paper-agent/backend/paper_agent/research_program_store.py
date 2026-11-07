"""Paper-owned program persistence. No model client or Agent loop."""
from dataclasses import replace
import json
import os
from pathlib import Path
import tempfile

from .model import Invalid, ResearchRequest, canonical, digest, mapping, sequence, text
from .research_candidates import DiscoveryPath, ResearchCandidate
from .research_program import ResearchProgram, ResearchEvent, reference


class ResearchPrograms:
    def __init__(self, store):
        self.store = store
        self.root = store.root / 'programs'

    def directory(self, identity):
        return self.root / reference(identity, 'program ID')

    def _read(self, path):
        try:
            return json.loads(path.read_bytes())
        except FileNotFoundError as error:
            raise Invalid('Research program record not found', 404) from error

    def _write(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        handle, temporary = tempfile.mkstemp(dir=path.parent, prefix='.program-')
        try:
            with os.fdopen(handle, 'wb') as output:
                output.write(canonical(value))
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def read(self, identity, checkpoint=None):
        directory = self.directory(identity)
        if checkpoint is None:
            checkpoint = self._read(directory / 'head.json')['checkpoint']
        value = ResearchProgram.restore(self._read(directory / 'checkpoints' / (reference(checkpoint, 'checkpoint') + '.json')))
        if value.id != identity or value.checkpoint != checkpoint:
            raise Invalid('Research checkpoint integrity mismatch', 409)
        return value

    def save(self, program):
        directory = self.directory(program.id)
        self._write(directory / 'checkpoints' / (program.checkpoint + '.json'), program.to_record())
        self._write(directory / 'head.json', dict(checkpoint=program.checkpoint))

    def rounds(self, program):
        return [self._read(self.directory(program.id) / 'rounds' / (r + '.json')) for r in program.roundIds]

    def view(self, program, offset=0, limit=10, round_offset=None, round_limit=4):
        if any(type(n) is not int or n < 0 for n in (offset, round_limit, limit)) or not 1 <= limit <= 50 or not 1 <= round_limit <= 4:
            raise Invalid('Use a nonnegative offset, candidate limit 1–50 and round limit 1–4')
        round_offset = max(0, len(program.roundIds) - 1) if round_offset is None else round_offset
        if type(round_offset) is not int or round_offset < 0:
            raise Invalid('Use a nonnegative round offset')
        candidates = [{k: v for k, v in c.to_dict().items() if k != 'abstract'} for c in program.candidates[offset:offset + limit]]
        # A long report is one page; callers traverse explicit cursors rather than receiving a truncated history.
        rounds, size = [], len(canonical(candidates))
        for identity in program.roundIds[round_offset:round_offset + round_limit]:
            row = self._read(self.directory(program.id) / 'rounds' / (identity + '.json'))
            width = len(canonical(row))
            if rounds and size + width > 1800 * 1024:
                break
            rounds.append(row); size += width
        runtime = self.directory(program.id) / 'runtime.json'
        return dict(id=program.id, checkpoint=program.checkpoint, protocol=program.protocol.to_dict(),
                    createdAt=program.createdAt, usage=program.to_record()['usage'], candidates=candidates,
                    candidatePage=dict(offset=offset, total=len(program.candidates), nextOffset=offset + len(candidates) if offset + len(candidates) < len(program.candidates) else None),
                    rounds=rounds, roundPage=dict(offset=round_offset, total=len(program.roundIds), nextOffset=round_offset + len(rounds) if round_offset + len(rounds) < len(program.roundIds) else None),
                    acceptance='needs_review', gaps=list(program.gaps), stopReason=program.stopReason,
                    researchRecordIds=list(program.researchRecordIds),
                    runtime=self._read(runtime) if runtime.exists() else None,
                    jobs=[self.job_view(self._read(self.directory(program.id) / 'jobs' / identity / 'job.json')) for identity in program.jobIds[-10:]])

    @staticmethod
    def job_view(record):
        return {**{k: v for k, v in record.items() if k not in ('result', 'input')},
                'input': {k: v for k, v in record['input'].items() if k != 'seed'}}

    def receipt_path(self, identity, operation):
        key = digest(text(operation, 200, 'operation ID').encode())
        return self.directory(identity) / 'operations' / (key + '.json')

    def replay(self, program, value):
        path = self.receipt_path(program.id, value.get('operationId'))
        if not path.exists():
            return None
        receipt = self._read(path)
        if receipt['commandDigest'] != digest(value):
            raise Invalid('Operation ID was already used with different arguments', 409)
        # Publish a prepared checkpoint after a failed head write, never rewind a later head.
        if program.checkpoint == receipt['previous']:
            self.save(self.read(program.id, receipt['checkpoint']))
        return receipt['result']

    def commit(self, previous, program, value, result=None, *, now, event=None):
        event = event or ResearchEvent(value['operation'], program.stopReason or 'saved', str(value.get('candidateId') or value.get('jobId') or ''),
                              str(value.get('query', {}).get('query') or value.get('question') or value.get('reason') or '')[:4000],
                              now)
        program = replace(program, events=(*program.events, event))
        if result is not None:
            result = {**result, 'checkpoint': program.checkpoint}
        result = self.view(program) if result is None else result
        self._write(self.directory(program.id) / 'checkpoints' / (program.checkpoint + '.json'), program.to_record())
        self._write(self.receipt_path(program.id, value['operationId']), dict(commandDigest=digest(value),
                    previous=previous.checkpoint, checkpoint=program.checkpoint, result=result))
        self.save(program)
        return result

    def command(self, value, now):
        value = mapping(value, 'program command')
        operation = value.get('operation')
        with self.store.lock:
            if operation == 'create':
                program = ResearchProgram.create(value, now)
                for identity in program.protocol.seedPaperIds:
                    self.store.paper(identity)
                if (self.directory(program.id) / 'head.json').exists():
                    existing = self.read(program.id)
                    if {k: v for k, v in existing.protocol.to_dict().items() if k != 'deadline'} != {k: v for k, v in program.protocol.to_dict().items() if k != 'deadline'}:
                        raise Invalid('Request ID already identifies a different research plan', 409)
                    return self.view(existing)
                seeds = tuple(ResearchCandidate.seed(self.store.paper(i)) for i in program.protocol.seedPaperIds)
                program = replace(program, candidates=seeds, usage=replace(program.usage, candidates=len(seeds)))
                if len(seeds) > program.protocol.limits.candidates:
                    raise Invalid('Candidate budget must include the seeds')
                self.save(program)
                return self.view(program)
            if operation == 'list':
                offset, limit = value.get('offset', 0), value.get('limit', 20)
                if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 50:
                    raise Invalid('Use a nonnegative offset and list limit 1–50')
                paths = [p for p in sorted(self.root.glob('*')) if p.is_dir() and (p / 'head.json').exists()]
                items = []
                for path in paths[offset:offset + limit]:
                    program = self.read(path.name)
                    items.append(dict(id=program.id, checkpoint=program.checkpoint, protocol=program.protocol.to_dict(),
                        usage=program.to_record()['usage'], stopReason=program.stopReason))
                return dict(programs=items, page=dict(offset=offset, total=len(paths), nextOffset=offset + len(items) if offset + len(items) < len(paths) else None))
            if operation == 'read':
                program = self.read(value.get('programId'), value.get('checkpoint'))
                result = self.view(program, value.get('offset', 0), value.get('limit', 10), value.get('roundOffset', 0), value.get('roundLimit', 4))
                if value.get('candidateId'):
                    result['candidate'] = program.candidate(value['candidateId']).to_dict()
                return result
            if operation in ('export', 'export-manifest'):
                from .research_exports import export_program
                program = self.read(value.get('programId'), value.get('checkpoint'))
                exported = export_program(program, self.rounds(program))
                if operation == 'export-manifest':
                    exported['documents'] = [{k: v for k, v in d.items() if k != 'content'} for d in exported['documents']]
                elif value.get('slot'):
                    exported['documents'] = [d for d in exported['documents'] if d['slot'] == value['slot']]
                    if not exported['documents']:
                        raise Invalid('Export slot not found', 404)
                return exported
            program = self.read(value.get('programId'))
            replay = self.replay(program, value)
            if replay is not None:
                return replay
            pending = self.receipt_path(program.id, value['operationId']).with_suffix('.pending.json')
            recovering = operation in ('commit-round', 'study-step') and pending.exists()
            if recovering and self._read(pending)['digest'] != digest(value):
                raise Invalid('Research operation identity conflict', 409)
            program.admit(value.get('expectedCheckpoint'), now, finalizing=operation in ('finish', 'commit-round') or
                          operation == 'study-step' and value.get('document', {}).get('action') == 'finalize', recovering=recovering)
            extra = {}
            if operation == 'adopt-discovery':
                batch = self.store.discovery(value.get('batchId'))
                if not any(c.paperId == batch.seed_id for c in program.candidates):
                    raise Invalid('Discovery seed is outside this program')
                path = DiscoveryPath(batch.id, batch.seed_id, batch.relation)
                next_program = program.discover(tuple(ResearchCandidate.observed(p.to_dict(), path) for p in batch.items))
            elif operation == 'screen':
                candidate = program.candidate(value.get('candidateId')).screen(value.get('decision'), value.get('reason'))
                next_program = program.update_candidate(candidate)
            elif operation == 'prepare-study':
                candidates = tuple(program.candidate(i) for i in sequence(value.get('candidateIds'), 5, 'reading candidates'))
                if not candidates or any(c.decision != 'include' or c.paperId is None for c in candidates):
                    raise Invalid('Choose included candidates with saved original sources')
                for candidate in candidates:
                    document = self.store.paper_pdf(candidate.paperId)
                    if document is None or not self.store.pdf_available(document.file_digest, len(self.store.pdf_bytes(document))):
                        raise Invalid('Acquire and save an approved original PDF before preparing a study')
                request = ResearchRequest.parse(dict(requestId=digest(dict(programId=program.id, operationId=value['operationId']))[:40],
                    paperIds=[c.paperId for c in candidates], question=value.get('question'), fullText=True))
                study = self.store.create_study(request, now)
                next_program = program.advance(studyIds=tuple(dict.fromkeys((*program.studyIds, study.id))))
                extra = dict(study=self.store.study_view(study.id))
                extra['study']['prompt'] += '\nThis Study is one batch within the approved ResearchProgram. Execute its commands through research-program operation=study-step with the command in document and outer expectedCheckpoint/operationId. After finalize, commit-round and continue the approved program; do not end overall research merely because this batch has a report.'
            elif operation == 'study-step':
                document = mapping(value.get('document'), 'study command')
                if document.get('studyId') not in program.studyIds:
                    raise Invalid('Study is outside this research program')
                usage = program.usage if document.get('action') in ('recall', 'context', 'finalize') else program.usage.spend('reads', 1, program.protocol.limits)
                result = self._study_step(program, value, now)
                next_program = program.advance(usage=usage)
                extra = dict(result=result)
            elif operation == 'source-step':
                from .paper_documents import PaperDocuments
                candidate = program.candidate(value.get('candidateId'))
                command = mapping(value.get('document'), 'scientific document command')
                if candidate.decision != 'include' or not candidate.paperId:
                    raise Invalid('Read an included saved candidate')
                documents = PaperDocuments(self.store)
                action = command.get('operation')
                if action == 'list':
                    command = dict(operation='list', paperId=candidate.paperId)
                elif action in ('outline', 'read', 'source', 'trace'):
                    document, _ = documents.read(command.get('documentId'))
                    if document.paper_id != candidate.paperId:
                        raise Invalid('Scientific document is outside this candidate')
                else:
                    raise Invalid('Use acquire for new HTML; source-step allows only saved-document reading')
                usage = program.usage.spend('reads', 1, program.protocol.limits) if action in ('read', 'source') else program.usage
                result = documents.command(command, now)
                if result.get('observationId'):
                    from .source_reports import SourceObservation
                    observation = SourceObservation.from_record(self.store._read('source-observations', result['observationId']))
                    result = dict(result, bundleId=observation.bundleId, resourceId=observation.resourceId)
                observations = tuple(dict.fromkeys((*program.observationIds, result['observationId']))) if result.get('observationId') else program.observationIds
                next_program = program.advance(usage=usage, observationIds=observations)
                extra = dict(result=result)
            elif operation == 'source-report':
                from .source_reports import source_report
                ids = sequence(value.get('observationIds'), 64, 'observed HTML windows')
                if not ids or any(identity not in program.observationIds for identity in ids):
                    raise Invalid('A source report can cite only observations delivered in this program')
                result = source_report(self.store, dict(operation='create', bundleId=value.get('bundleId'),
                    title=value.get('title'), observationIds=list(ids), interpretations=value.get('interpretations', [])), now)
                next_program = program.advance(sourceReportIds=tuple(dict.fromkeys((*program.sourceReportIds, result['id']))))
                extra = dict(sourceReport=result)
            elif operation == 'commit-round':
                from .research_rounds import ResearchRound, DocumentEvidence
                report_ids = sequence(value.get('reportIds'), 32, 'saved round reports')
                allowed = {self.store.study(i).report_id for i in program.studyIds} | set(program.sourceReportIds)
                if not report_ids or len(set(report_ids)) != len(report_ids) or any(i not in allowed for i in report_ids):
                    raise Invalid('Round reports must belong to saved observations or finalized studies in this program')
                reports = tuple(self.store.report(i) for i in report_ids if i not in program.sourceReportIds)
                document_evidence = []
                for identity in (i for i in report_ids if i in program.sourceReportIds):
                    from .source_reports import report_view, observed, verify_observation
                    from .paper_documents import PaperDocuments
                    report = report_view(self.store, self.store._read('source-reports', identity), identity)
                    for item in report['observations']:
                        observation = observed(self.store, item['id'], report['bundleId'])
                        if observation.id not in program.observationIds or not verify_observation(self.store, observation):
                            raise Invalid('HTML observation is unavailable or outside this program', 409)
                        for scope in observation.documentScopes:
                            document, _ = PaperDocuments(self.store).read(scope.documentId)
                            # Preserve scientific structures; only prose already returned by a read is quotable here.
                            # Original markup and visual/mathematical interpretations remain in the source report for review.
                            if scope.unit != 'characters':
                                continue
                            window = document.read(scope.blockId, scope.start, scope.end - scope.start)
                            document_evidence.append(DocumentEvidence(identity, observation.id, document.paper_id, document.id,
                                scope.blockId, document.source.url, (window['content'],)))
                previous = self.rounds(program)
                pending = self.receipt_path(program.id, value['operationId']).with_suffix('.pending.json')
                if pending.exists():
                    saved = self._read(pending)
                    now = saved['createdAt']
                row = ResearchRound.create(value, program, reports, previous, now, tuple(document_evidence))
                next_program = program.complete_round(row, previous[-1]['screeningDigest'] if previous else None)
                if not pending.exists():
                    self._write(pending, dict(digest=digest(value), createdAt=now))
                from .research_record_commands import record_command
                papers = list(dict.fromkeys(claim.paperId for claim in row.claims))
                revisions = []
                parent = program.researchRecordIds[-1] if program.researchRecordIds else None
                for start in range(0, len(papers), 32):
                    selected = papers[start:start + 32]
                    decisions = [dict(paperId=identity, decision=candidate.decision, reason=candidate.reason)
                                 for identity in selected
                                 for candidate in [next(c for c in program.candidates if c.paperId == identity)]]
                    evidence = [dict(paperId=claim.paperId, reportId=claim.reportId,
                                     stance='gap' if claim.stance == 'limitation' else claim.stance,
                                     note=claim.text[:2000], sourceKind=getattr(claim, 'sourceKind', 'pdf'))
                                for claim in row.claims if claim.paperId in selected]
                    revision = record_command(self.store, dict(operation='create', question=row.question,
                        scope=program.protocol.scope, inclusion=program.protocol.inclusion, exclusion=program.protocol.exclusion,
                        paperIds=selected, decisions=decisions, evidence=evidence, parentId=parent,
                        review=dict(decision='needs_review', note='Autonomous research interpretation; independent review and reproduction have not run.')), now)
                    parent = revision['id']
                    revisions.append(parent)
                row = replace(row, researchRecordIds=tuple(revisions))
                next_program = replace(next_program, roundIds=(*program.roundIds, row.id),
                                       researchRecordIds=(*program.researchRecordIds, *revisions))
                self._write(self.directory(program.id) / 'rounds' / (row.id + '.json'), row.to_dict())
            elif operation == 'finish':
                next_program = program.finish(value.get('reason'))
            else:
                raise Invalid('Unknown research program operation')
            return self.commit(program, next_program, value, {**self.view(next_program), **extra}, now=now)

    def _study_step(self, program, value, now):
        """Reconcile an interrupted study write by the original step position."""
        document = value['document']
        study = self.store.study(document['studyId'])
        pending = self.receipt_path(program.id, value['operationId']).with_suffix('.pending.json')
        if pending.exists():
            record = self._read(pending)
            index = record['step']
            if len(study.steps) > index:
                step = study.steps[index]
                return dict(**study.compact(), observation=step.observation())
        else:
            self._write(pending, dict(digest=digest(value), step=len(study.steps)))
        return self.store.study_step(document, now)
