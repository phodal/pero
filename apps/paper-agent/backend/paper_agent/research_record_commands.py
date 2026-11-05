"""Persistence shell for manual research revisions. Reuses existing owners."""
from dataclasses import asdict
from .model import Invalid, digest, sequence
from .paper_documents import PaperDocuments
from .pcgym_sources import pipeline_digest
from .research_records import ResearchRecord, SourceVersion
from .research_resources import ArxivPaper


def read_record(store, identity):
    return ResearchRecord.from_record(store._read('research-records', identity), identity)


def source_version(store, paper, *, check_original=False):
    pdf = store.paper_pdf(paper.id)
    if check_original and pdf is not None and digest(store.pdf_bytes(pdf)) != pdf.file_digest:
        raise Invalid('Saved PDF original failed its identity check', 409)
    structured = PaperDocuments(store).overview(paper.id)['revisions']
    return SourceVersion(paper.id, paper.content_digest, pdf.id if pdf else None,
                         pdf.file_digest if pdf else None, tuple(sorted(row['id'] for row in structured)))


def record_handoff(store, value):
    if set(value) != {'recordId', 'itemId', 'attemptId', 'includeNotes'} or value['includeNotes'] is not True:
        raise Invalid('Choose a saved revision and confirm inclusion of its notes and bound PDF excerpt')
    record = read_record(store, value['recordId'])
    attempt = next((item for item in record.attempts if item.itemId == value['itemId']
                    and item.attemptId == value['attemptId'] and item.status == 'completed'), None)
    if attempt is None:
        raise Invalid('The completed attempt is not part of this research revision', 409)
    # The explicit handoff includes research notes and one attempt's numeric outputs.
    # Linked reports, other attempts and full original documents are referenced by identity.
    record_command(store, dict(operation='export', recordId=record.id), None)
    return store.pcgym.evidence_archive(attempt.itemId, attempt.attemptId, research_record=record.to_dict())


def record_command(store, value, now):
    operation = value.get('operation')

    def paper(identity):
        result = store.paper(identity)
        if result.id != identity:
            raise Invalid('Source reference identity mismatch', 409)
        return result

    def report(identity):
        result = store.report(identity)
        if result.id != identity:
            raise Invalid('Report reference identity mismatch', 409)
        return result

    if operation == 'create':
        ids = sequence(value.get('paperIds'), 32, 'saved papers')
        papers = tuple(paper(identity) for identity in ids)
        record = ResearchRecord.create(value, papers, now, sources=tuple(source_version(store, item) for item in papers),
                                       available_attempts=store.pcgym.research_attempts(ids) if value.get('attempts') else ())
        if record.parentId:
            read_record(store, record.parentId)
        for link in record.evidence:
            if link.reportId is None:
                continue  # An explicitly missing evidence gap is not an observation.
            saved = report(link.reportId)  # Owner rechecks input and report digests.
            if not _report_cites_paper(saved.report, link.paperId):
                raise Invalid('This report has no cited evidence for the selected paper')
        store._write('research-records', record.id, record.to_dict())
        return record.to_dict()
    if operation == 'attempts':
        if set(value) != {'operation', 'paperIds'}:
            raise Invalid('Choose saved papers for the attempt list')
        ids = tuple(paper(identity).id for identity in sequence(value['paperIds'], 32, 'saved papers'))
        return dict(attempts=[asdict(item) for item in store.pcgym.research_attempts(ids)])
    allowed = {'operation'} if operation == 'list' else {'operation', 'recordId', 'paperIds'} if operation == 'select' else {'operation', 'recordId'}
    if set(value) - allowed or operation not in ('list', 'read', 'impact', 'select', 'export'):
        raise Invalid('Choose create, list, read, impact, select, attempts or export')
    if operation == 'list':
        records = [read_record(store, identity).to_dict() for identity in store._list('research-records')]
        return dict(records=sorted(records, key=lambda item: (item['createdAt'], item['id']), reverse=True))
    record = read_record(store, value.get('recordId'))
    if operation == 'read':
        selections = []
        for identity in store._list('research-reread-selections'):
            item = store._read('research-reread-selections', identity)
            if item['recordId'] == record.id:
                selections.append(record.read_selection(item, identity))
        return dict(record.to_dict(), selections=sorted(selections, key=lambda item: (item['createdAt'], item['id'])))
    if operation == 'export':
        # Recheck referenced owners; missing/modified evidence cannot silently be
        # represented as valid. Historical record remains available via read.
        for source in record.sourceVersions:
            if paper(source.paperId).content_digest != source.contentDigest:
                raise Invalid('Frozen source digest mismatch', 409)
        for link in record.evidence:
            if link.reportId:
                report(link.reportId)
        return record.export_index()
    if operation == 'select':
        selection = record.selection(value.get('paperIds'), now)
        store._write('research-reread-selections', selection['id'], selection)
        return selection
    papers = []
    unavailable = []
    for identity in store._list('papers'):
        try:
            papers.append(paper(identity))
        except Invalid:
            unavailable.append(identity)
    current_sources = []
    for item in papers:
        if item.id in record.paperIds:
            try:
                current_sources.append(source_version(store, item, check_original=True))
            except (Invalid, OSError):
                unavailable.append(item.id)
    works = {}
    for item in papers:
        try:
            works[item.id] = ArxivPaper.from_snapshot(item)
        except Invalid:
            pass  # An unresolved work cannot link versions across source IDs.
    return dict(record.impact(tuple(papers), tuple(current_sources), works, pipeline_digest() if record.attempts else None),
                unavailablePaperIds=unavailable)


def _report_cites_paper(report, paper_id):
    """Match validated evidence, never paper labels or intent membership."""
    groups = list(report.sections) + list(report.experiments)
    if report.matrix is not None:
        groups.extend(report.matrix.cells)
    return any(reference.paper_id == paper_id for group in groups for reference in group.evidence)
