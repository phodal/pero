"""Persistence shell for manual research revisions. Reuses existing owners."""
from .model import Invalid, sequence
from .research_records import ResearchRecord


def record_command(store, value, now):
    operation = value.get('operation')

    def read(identity):
        return ResearchRecord.from_record(store._read('research-records', identity), identity)

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
        record = ResearchRecord.create(value, tuple(paper(identity) for identity in ids), now)
        if record.parentId:
            read(record.parentId)  # A revision links an existing immutable parent.
        for link in record.evidence:
            if link.reportId is None:
                continue  # An explicitly missing evidence gap is not an observation.
            saved = report(link.reportId)  # Owner rechecks input and report digests.
            if not any(ref.paper_id == link.paperId for section in saved.report.sections for ref in section.evidence):
                raise Invalid('This report has no cited evidence for the selected paper')
        store._write('research-records', record.id, record.to_dict())
        return record.to_dict()
    allowed = {'operation'} if operation == 'list' else {'operation', 'recordId', 'paperIds'} if operation == 'select' else {'operation', 'recordId'}
    if set(value) - allowed or operation not in ('list', 'read', 'impact', 'select', 'export'):
        raise Invalid('Choose create, list, read, impact, select or export')
    if operation == 'list':
        records = [read(identity).to_dict() for identity in store._list('research-records')]
        return dict(records=sorted(records, key=lambda item: (item['createdAt'], item['id']), reverse=True))
    record = read(value.get('recordId'))
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
    return dict(record.impact(tuple(papers)), unavailablePaperIds=unavailable)
