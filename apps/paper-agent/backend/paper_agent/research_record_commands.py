"""Persistence shell for saved research revisions. Reuses existing source owners."""
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


def record_command(store, value, now, *, data_versions=None):
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

    def evidence(link):
        if link.reportId is None:
            return
        if link.sourceKind == 'pdf':
            if not _report_cites_paper(report(link.reportId).report, link.paperId):
                raise Invalid('This report has no cited evidence for the selected paper')
            return
        from .source_reports import report_view
        saved = report_view(store, store._read('source-reports', link.reportId), link.reportId)
        if not all(item['available'] for item in saved['currentAvailability']):
            raise Invalid('Observed HTML originals are unavailable', 409)
        if not any(PaperDocuments(store).read(scope['documentId'])[0].paper_id == link.paperId
                   for observation in saved['observations'] for scope in observation['anchor'].get('documentScopes', ())):
            raise Invalid('This HTML report has no observed evidence for the selected paper')

    if operation == 'create':
        ids = sequence(value.get('paperIds'), 32, 'saved papers')
        papers = tuple(paper(identity) for identity in ids)
        parent = read_record(store, value['parentId']) if value.get('parentId') is not None else None
        record = ResearchRecord.create(value, papers, now, sources=tuple(source_version(store, item) for item in papers),
                                       available_attempts=store.pcgym.research_attempts(ids) if value.get('attempts') else (),
                                       data_versions=data_versions if data_versions is not None else parent.dataVersions if parent else ())
        for link in record.evidence:
            evidence(link)
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
            evidence(link)
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
