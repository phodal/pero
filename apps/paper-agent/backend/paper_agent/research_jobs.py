"""Finite, killable literature/PDF operations. The Agent chooses each next step."""
from dataclasses import replace
from datetime import datetime
import json
from pathlib import Path
import tempfile
import threading

from .acquisition_worker import acquire_bounded
from .discovery import DiscoveryQuery
from .literature import LiteratureClient, SearchQuery
from .local_pdf import MAX_PDF_BYTES
from .model import Invalid, PaperSnapshot, canonical, digest
from .pdf import PdfDocument, PdfPage
from .pdf_files import PdfFiles
from .research_candidates import DiscoveryPath, ResearchCandidate
from .research_program import reference, ResearchEvent
from .research_lookup import ResearchLookupOutcome
from .resource_fetch import PublicMetadata
from .research_resources import ResearchResource, ResearchBundle, OfficialHtml, ProgramHtmlAuthorization


def research_work(output, directory, value):
    operation = value['operation']
    if operation == 'search':
        result = LiteratureClient().search(value['query'])
    elif operation == 'discover':
        result = LiteratureClient().discover(DiscoveryQuery.parse(value['query']), PaperSnapshot.from_record(value['seed'])).to_dict()
    elif operation == 'acquire-html':
        from .paper_documents import prepare_html
        return prepare_html(output, directory, value['url'], value['paperId'], PublicMetadata(), value['byteAllowance'])
    else:
        response = PublicMetadata().fetch_pdf(value['url'], limit=value['byteAllowance'])
        pages = PdfFiles().pages(response.data)
        (Path(directory) / 'original.pdf').write_bytes(response.data)
        (Path(directory) / 'pages.json').write_bytes(canonical([p.to_dict() for p in pages]))
        result = dict(url=response.url, size=len(response.data), fileDigest=digest(response.data))
    output.send(('complete', result))


class ResearchJobs:
    def __init__(self, programs, worker=research_work):
        self.programs, self.worker, self.running = programs, worker, {}
        for path in programs.root.glob('*/jobs/*/job.json'):
            record = programs._read(path)
            if record['status'] == 'running':
                programs._write(path, {**record, 'status': 'interrupted', 'error': 'Worker interrupted by restart. Start a new operation within the remaining allowance.'})

    def close(self):
        for cancelled, _ in self.running.values():
            cancelled.set()
        for _, thread in self.running.values():
            thread.join(timeout=3)

    def cancel(self, program_id):
        for identity in self.programs.read(program_id).jobIds:
            if identity in self.running:
                self.running[identity][0].set()

    def command(self, value, now):
        programs, store = self.programs, self.programs.store
        with store.lock:
            program = programs.read(value.get('programId'))
            if value.get('operation') == 'poll':
                return self.poll(program, reference(value.get('jobId'), 'job'), now)
            replay = programs.replay(program, value)
            if replay is not None:
                return replay
            program.admit(value.get('expectedCheckpoint'), now)
            for identity in program.jobIds:
                record = programs._read(programs.directory(program.id) / 'jobs' / identity / 'job.json')
                if record['status'] in ('running', 'ready'):
                    raise Invalid('Poll the pending research job before starting more work', 409)
            operation = value.get('operation')
            if operation not in ('search', 'discover', 'acquire'):
                raise Invalid('Choose search, discover, acquire or poll')
            identity = digest(dict(programId=program.id, operationId=value['operationId']))
            work = dict(operation=operation)
            if operation in ('search', 'discover'):
                usage = program.usage.spend('searches', 1, program.protocol.limits)
                if operation == 'search':
                    work['query'] = SearchQuery.parse(value.get('query')).document()
                else:
                    query = DiscoveryQuery.parse(value.get('query'))
                    if not any(c.paperId == query.seed_id for c in program.candidates):
                        raise Invalid('Discovery seed must belong to this program')
                    work.update(query=value['query'], seed=store.paper(query.seed_id).to_dict())
            else:
                candidate = program.candidate(value.get('candidateId'))
                if candidate.decision != 'include':
                    raise Invalid('Screen this candidate before acquiring it')
                representation = value.get('representation', 'pdf')
                if representation not in ('pdf', 'html'):
                    raise Invalid('Choose pdf or html acquisition')
                if representation == 'html' and candidate.htmlDocumentId:
                    from .paper_documents import PaperDocuments
                    PaperDocuments(store).read(candidate.htmlDocumentId)
                    return programs.commit(program, program.advance(), value, now=now)
                if representation == 'pdf' and candidate.paperId and (document := store.paper_pdf(candidate.paperId)) is not None:
                    if store.pdf_available(document.file_digest, len(store.pdf_bytes(document))):
                        next_program = program.update_candidate(replace(candidate, documentId=document.id, blocker=None))
                        return programs.commit(program, next_program, value, now=now)
                if representation == 'pdf' and (program.protocol.acquisition not in ('public_pdf', 'public_fulltext') or not candidate.pdfUrl):
                    raise Invalid('No approved public PDF is available for this candidate; exclude it or finish with needs_input')
                if representation == 'html' and program.protocol.acquisition != 'public_fulltext':
                    raise Invalid('This plan does not authorize official HTML acquisition', 403)
                remaining = min(8 * 1024 * 1024 if representation == 'html' else MAX_PDF_BYTES, program.protocol.limits.downloadBytes - program.usage.downloadBytes)
                if remaining < 1:
                    raise Invalid('Research download byte budget exhausted', 409)
                usage = program.usage.spend('downloads', 1, program.protocol.limits).spend('downloadBytes', remaining, program.protocol.limits)
                work.update(candidateId=candidate.id, url=candidate.pdfUrl, byteAllowance=remaining)
                if representation == 'html':
                    if candidate.paperId:
                        paper = store.paper(candidate.paperId)
                    else:
                        paper = store.save_paper(PaperSnapshot.from_reading(dict(source=candidate.source, sourceId=candidate.sourceId,
                            title=candidate.title, url=candidate.url, authors=list(candidate.authors), pdfUrl=candidate.pdfUrl,
                            content=candidate.abstract, contentKind='abstract'), now))
                    resource = replace(ResearchResource.linked(candidate.officialHtmlUrl or candidate.url, candidate.url, candidate.title), paperId=paper.id)
                    source = OfficialHtml.from_resource(resource)
                    grant = ProgramHtmlAuthorization(program.id, digest(program.protocol.to_dict()), program.checkpoint, candidate.id, source.url)
                    grant.validate(program, resource)
                    bundle = ResearchBundle(digest(dict(programId=program.id, candidateId=candidate.id, source=source.url)),
                        candidate.url, candidate.title, (resource,), now, now, programAuthorization=grant)
                    record = bundle.to_dict()
                    revision = digest(record)
                    store._write('bundle-revisions', revision, record)
                    store.imports._replace('research-bundles', bundle.id, dict(revisionId=revision))
                    work.update(operation='acquire-html', url=source.url, paperId=paper.id, bundleId=bundle.id, resourceId=resource.id)
            directory = programs.directory(program.id) / 'jobs' / identity
            record = dict(id=identity, status='running', input=work, createdAt=now, error='')
            programs._write(directory / 'job.json', record)
            reserved = program.advance(usage=usage, jobIds=(*program.jobIds, identity))
            result = programs.commit(program, reserved, value, {**programs.view(reserved), 'job': programs.job_view(record)}, now=now)
            cancelled = threading.Event()
            seconds = min(45, max(0, (datetime.fromisoformat(program.protocol.deadline.replace('Z', '+00:00')) - datetime.fromisoformat(now.replace('Z', '+00:00'))).total_seconds()))
            thread = threading.Thread(target=self.run, args=(directory, record, cancelled, seconds), daemon=True)
            self.running[identity] = cancelled, thread
            thread.start()
            return result

    def run(self, directory, record, cancelled, seconds):
        result = acquire_bounded(self.worker, (str(directory), record['input']), cancelled, seconds, lambda _: None)
        if result[0] == 'complete' and record['input']['operation'] in ('search', 'discover'):
            try:
                record = {**record, 'outcome': ResearchLookupOutcome.parse(result[1]).to_dict()}
            except Invalid as error:
                result = ('failed', str(error))
        with self.programs.store.lock:
            self.programs._write(directory / 'job.json', {**record,
                'status': 'ready' if result[0] == 'complete' and not cancelled.is_set() else 'cancelled' if cancelled.is_set() else result[0],
                **({'result': result[1]} if result[0] == 'complete' else {'error': result[1]})})

    def poll(self, program, identity, now):
        if identity not in program.jobIds:
            raise Invalid('Job is outside this program')
        programs, store = self.programs, self.programs.store
        path = programs.directory(program.id) / 'jobs' / identity / 'job.json'
        record = programs._read(path)
        if record['status'] == 'ready' and not program.stopReason:
            value = dict(operation='apply-job', programId=program.id, operationId='apply-' + identity)
            existing = programs.replay(program, value)
            if existing is not None:
                program = programs.read(program.id)
            else:
                try:
                    work, result = record['input'], record['result']
                    if work['operation'] in ('search', 'discover'):
                        # Preserve the complete observed response in this immutable job record.
                        relation = work.get('query', {}).get('relation', 'search')
                        provenance = DiscoveryPath(identity, work.get('query', {}).get('seedId', ''), relation)
                        observed = tuple(ResearchCandidate.observed(item, provenance) for item in result.get('items', []))
                        available = program.protocol.limits.candidates - program.usage.candidates
                        known = list(program.candidates)
                        selected = []
                        for candidate in observed:
                            duplicate = any(item.matches(candidate) for item in known)
                            if duplicate or available > 0:
                                selected.append(candidate)
                                if not duplicate: available -= 1
                                known.append(candidate)
                        next_program = program.discover(tuple(selected), reserved=True)
                    elif work['operation'] == 'acquire-html':
                        from base64 import b64encode
                        from .paper_documents import PaperDocuments
                        from .scientific_document import ScientificDocument
                        record_json = json.loads((path.parent / 'document.json').read_bytes())
                        document = ScientificDocument.from_record(record_json)
                        original = (path.parent / 'source.html').read_bytes()
                        bundle = store.imports.bundle(work['bundleId'])
                        resource = bundle.approved_html(work['resourceId'])
                        documents = PaperDocuments(store)
                        documents._register_receipt(document, bundle, resource, now)
                        store._write('scientific-documents', document.id, dict(document=record_json, sourceBytes=b64encode(original).decode('ascii')))
                        documents.read(document.id)
                        candidate = program.candidate(work['candidateId'])
                        next_program = program.update_candidate(replace(candidate, paperId=work['paperId'], htmlDocumentId=document.id, blocker=None))
                        next_program = replace(next_program, usage=replace(next_program.usage,
                            downloadBytes=next_program.usage.downloadBytes - work['byteAllowance'] + len(original)))
                    else:
                        candidate = program.candidate(work['candidateId'])
                        data = (path.parent / 'original.pdf').read_bytes()
                        if len(data) != result['size'] or digest(data) != result['fileDigest']:
                            raise Invalid('Acquired PDF integrity mismatch', 409)
                        pages = tuple(PdfPage(**p) for p in json.loads((path.parent / 'pages.json').read_bytes()))
                        if candidate.paperId:
                            paper = store.paper(candidate.paperId)
                        else:
                            content = candidate.abstract or '\n\n'.join(p.text for p in pages)[:1000000]
                            if content.strip():
                                paper = store.save_paper(PaperSnapshot.from_reading(dict(source=candidate.source, sourceId=candidate.sourceId,
                                    title=candidate.title, url=candidate.url, authors=list(candidate.authors),
                                    pdfUrl=candidate.pdfUrl, content=content, contentKind='abstract' if candidate.abstract else 'full-text'), now))
                            else:
                                # Preserve bibliographic metadata even for scans, without inventing readable text.
                                from .local_pdf import LocalPdf
                                paper, _ = PdfFiles.from_pages(LocalPdf.parse(data, candidate.title + '.pdf'), pages, now)
                                paper = store.save_paper(paper)
                        document = PdfDocument.create(paper.id, result['fileDigest'], result['url'], pages, now)
                        store.save_pdf(document, data)
                        next_program = program.update_candidate(replace(candidate, paperId=paper.id, documentId=document.id,
                            blocker=None if document.has_selectable_text else 'No selectable PDF text; inspect the original manually.'))
                        next_program = replace(next_program, usage=replace(next_program.usage,
                            downloadBytes=next_program.usage.downloadBytes - work['byteAllowance'] + len(data)))
                except (Invalid, ValueError, OSError, KeyError, TypeError) as error:
                    record = {**record, 'status': 'failed', 'error': str(error)}
                    programs._write(path, record)
                else:
                    programs.commit(program, next_program, value, now=now)
                    program = programs.read(program.id)
            outcome = record.get('outcome', {}).get('status')
            record = {**record, 'status': 'failed' if record['status'] == 'failed' or outcome == 'failed' else 'needs_input' if outcome == 'choose-seed' else 'completed'}
            programs._write(path, record)
        if record['status'] not in ('running', 'ready'):
            value = dict(operation='observe-job', programId=program.id, operationId='observe-' + identity)
            if programs.replay(program, value) is None:
                detail = json.dumps(dict(query=record['input'].get('query'), error=record.get('error'),
                                         outcome=record.get('outcome')), ensure_ascii=False)
                programs.commit(program, program.advance(), value, now=now,
                    event=ResearchEvent(record['input']['operation'], record['status'], identity, detail[:4000], now))
                program = programs.read(program.id)
        return {**programs.view(program), 'job': programs.job_view(record)}
