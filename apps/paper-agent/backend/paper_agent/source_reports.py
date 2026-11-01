"""Immutable tool-observed source evidence, separate from scientific interpretation.

The read tool alone creates observations. Reports select their IDs; callers cannot
supply anchors, read scopes, image-review assertions or verification verdicts.
"""
from dataclasses import asdict, dataclass, replace

from .model import ID, Invalid, digest, text

LIMITATIONS = (
    'Verification covers original hashes and tool-returned scopes, not scientific correctness.',
    'Literal TeX is not macro evaluation; unknown macros and missing data remain unresolved.',
    'An image preview returned by a tool is not evidence of model vision or correct interpretation.',
)


@dataclass(frozen=True)
class SourceLocation:
    archiveDigest: str
    memberId: str
    memberPath: str
    memberDigest: str
    startLine: int | None = None
    endLine: int | None = None
    start: int | None = None
    end: int | None = None
    contentDigest: str | None = None

    @classmethod
    def observed(cls, value, content=None):
        return cls(*(value[key] for key in ('archiveDigest', 'memberId', 'memberPath', 'memberDigest')),
                   *(value.get(key) for key in ('startLine', 'endLine', 'start', 'end')),
                   digest(content.encode('utf-8')) if content is not None else None)


@dataclass(frozen=True)
class PdfLocation:
    documentId: str
    fileDigest: str
    page: int
    start: int
    end: int
    contentDigest: str


@dataclass(frozen=True)
class SourceObservation:
    bundleId: str
    resourceId: str
    kind: str
    sources: tuple[SourceLocation, ...]
    pdfs: tuple[PdfLocation, ...] = ()
    pdfResourceId: str | None = None
    previewSha256: str | None = None
    comparisonStatus: str | None = None
    reason: str | None = None
    archiveDigest: str | None = None

    @property
    def id(self):
        return digest(asdict(self))

    @classmethod
    def from_record(cls, value):
        return cls(value['bundleId'], value['resourceId'], value['kind'],
                   tuple(SourceLocation(**item) for item in value['sources']),
                   tuple(PdfLocation(**item) for item in value['pdfs']), value['pdfResourceId'],
                   value['previewSha256'], value['comparisonStatus'], value['reason'], value['archiveDigest'])

    def to_dict(self):
        anchor = asdict(self.sources[0]) if self.sources else {}
        if self.kind == 'source_image':
            anchor.update(previewSha256=self.previewSha256, visualReview='not_reviewed', delivery='preview_returned')
        if self.kind == 'source_pdf_comparison':
            anchor = dict(archiveDigest=self.archiveDigest, pdfResourceId=self.pdfResourceId, status=self.comparisonStatus, reason=self.reason,
                          matches=[dict(source=asdict(source), pdf=asdict(pdf)) for source, pdf in zip(self.sources, self.pdfs)])
        return dict(id=self.id, bundleId=self.bundleId, resourceId=self.resourceId, kind=self.kind,
                    anchor=anchor, limitations=list(LIMITATIONS))


def record_observation(store, value, result):
    """Called only after the existing approved read operation succeeds."""
    operation = value['operation']
    if operation == 'read':
        if not result['content']:
            return dict(result, observationWarning='Empty source window contains no readable text; no reportable observation was recorded.')
        observation = SourceObservation(value['bundleId'], value['resourceId'], 'source_text',
                                        (SourceLocation.observed(result, result['content']),))
    elif operation == 'image':
        provenance = result['provenance']
        archive = store._read('source-archives', provenance['archiveDigest'])
        member = next(member for member in archive['members'] if member['id'] == provenance['memberId'])
        observation = SourceObservation(value['bundleId'], value['resourceId'], 'source_image',
            (SourceLocation(provenance['archiveDigest'], member['id'], member['path'], member['sha256']),),
            previewSha256=provenance['previewSha256'])
    elif operation == 'compare':
        sources, pdfs = [], []
        for match in result['matches']:
            source, pdf = match['source'], match['pdf']
            content = (store.root / 'source-members' / (source['memberDigest'] + '.bin')).read_bytes().decode('utf-8')
            sources.append(SourceLocation.observed(source, content[source['start']:source['end']]))
            pdfs.append(PdfLocation(pdf['documentId'], pdf['fileDigest'], pdf['page'], pdf['start'], pdf['end'],
                                    digest(pdf['quote'].encode('utf-8'))))
        observation = SourceObservation(value['bundleId'], value['resourceId'], 'source_pdf_comparison',
            tuple(sources), tuple(pdfs), value.get('pdfResourceId'), comparisonStatus=result['status'], reason=result['reason'])
    else:
        return result
    _, job = store.source_downloads.job(value['bundleId'], value['resourceId'])
    observation = replace(observation, archiveDigest=job.receipt.archiveDigest)
    try:
        with store.lock:
            store._write('source-observations', observation.id, dict(asdict(observation),
                sources=[asdict(item) for item in observation.sources], pdfs=[asdict(item) for item in observation.pdfs]))
    except (Invalid, OSError) as error:
        if isinstance(error, Invalid) and error.status != 413:
            raise
        # A bounded journal must not disable existing source reading. Do not
        # invent an ID when persistence fails: this delivery is not reportable.
        return dict(result, observationWarning='Read delivered, but its observation could not be saved. This read cannot be added to a report; existing reports are unchanged.')
    return dict(result, observationId=observation.id)


def observed(store, identity, bundle_id):
    observation = SourceObservation.from_record(store._read('source-observations', identity))
    if observation.id != identity or observation.bundleId != bundle_id:
        raise Invalid('Observation is outside this bundle or failed its identity check', 409)
    store.imports.approved_source(bundle_id, observation.resourceId)
    return observation


def verify_observation(store, observation):
    """Recheck original bytes and exact scopes, without new acquisition or read claims."""
    _, job = store.source_downloads.job(observation.bundleId, observation.resourceId)
    if not job.receipt or observation.archiveDigest != job.receipt.archiveDigest or not store.source_downloads.available(job):
        return False
    archive = store._read('source-archives', job.receipt.archiveDigest)
    for source in observation.sources:
        member = next((m for m in archive['members'] if m['id'] == source.memberId), None)
        if (source.archiveDigest != job.receipt.archiveDigest or not member
                or member['sha256'] != source.memberDigest or member['path'] != source.memberPath):
            return False
        data = (store.root / 'source-members' / (source.memberDigest + '.bin')).read_bytes()
        if digest(data) != source.memberDigest:
            return False
        if source.start is not None:
            content = data.decode('utf-8')
            if not 0 <= source.start < source.end <= len(content):
                return False
            if digest(content[source.start:source.end].encode('utf-8')) != source.contentDigest:
                return False
        if observation.previewSha256:
            from .source_archive import SourceMember
            from .source_reading import checked_preview
            if digest(checked_preview(store, SourceMember.from_record(member))) != observation.previewSha256:
                return False
    if observation.pdfs:
        store.imports.approved_pdf(observation.bundleId, observation.pdfResourceId)
        job_id = digest(dict(bundleId=observation.bundleId, resourceId=observation.pdfResourceId))
        pdf_job = store.pdf_downloads._read(job_id)
        if not pdf_job.receipt or not store.pdf_downloads.available(pdf_job):
            return False
        document = store.pdf(pdf_job.receipt.documentId)
        for pdf in observation.pdfs:
            if pdf.documentId != document.id or pdf.fileDigest != document.file_digest:
                return False
            content = document.page(pdf.page).text
            if not 0 <= pdf.start < pdf.end <= len(content) or digest(content[pdf.start:pdf.end].encode('utf-8')) != pdf.contentDigest:
                return False
    return True


@dataclass(frozen=True)
class SourceEvidenceReport:
    bundleId: str
    title: str
    observationIds: tuple[str, ...]
    interpretations: tuple[str, ...]

    @property
    def id(self):
        return digest(asdict(self))

    @classmethod
    def parse(cls, value):
        title = text(value.get('title'), 200, 'report title')
        ids = value.get('observationIds')
        notes = value.get('interpretations', [])
        if (not isinstance(ids, list) or not 1 <= len(ids) <= 64 or
                any(not isinstance(item, str) or not ID.fullmatch(item) for item in ids) or len(set(ids)) != len(ids)):
            raise Invalid('Choose 1–64 distinct tool-observed evidence IDs')
        if not isinstance(notes, list) or len(notes) > 16:
            raise Invalid('Choose at most 16 unresolved interpretations')
        return cls(value['bundleId'], title, tuple(ids), tuple(text(note, 1000, 'unresolved interpretation') for note in notes))


def report_view(store, record, expected_id):
    report = SourceEvidenceReport(record['bundleId'], record['title'], tuple(record['observationIds']), tuple(record['interpretations']))
    if report.id != record['id'] or report.id != expected_id:
        raise Invalid('Report identity check failed', 409)
    observations, availability = [], []
    for identity in report.observationIds:
        observation = observed(store, identity, report.bundleId)
        observations.append(observation.to_dict())
        try:
            available = verify_observation(store, observation)
        except (OSError, Invalid, UnicodeError):
            available = False
        availability.append(dict(observationId=identity, available=available))
    return dict(id=report.id, bundleId=report.bundleId, title=report.title, createdAt=record['createdAt'],
                observationIds=list(report.observationIds), observations=observations,
                interpretations=[dict(text=note, status='unresolved') for note in report.interpretations],
                verification='tool_observed_scopes_only', limitations=list(LIMITATIONS), currentAvailability=availability)


def source_report(store, value, now):
    operation = value.get('operation')
    allowed = {'operation', 'bundleId'} | ({'title', 'observationIds', 'interpretations'} if operation == 'create' else {'reportId'} if operation == 'read' else set())
    if operation not in ('observations', 'create', 'read', 'list') or set(value) - allowed:
        raise Invalid('Choose observations, create, read or list for a source evidence report')
    bundle = store.imports.bundle(value.get('bundleId'))
    if operation == 'observations':
        items = [observed(store, identity, bundle.id).to_dict() for identity in store._list('source-observations')
                 if store._read('source-observations', identity)['bundleId'] == bundle.id]
        return dict(observations=items)
    if operation == 'list':
        return dict(reports=[report_view(store, store._read('source-reports', identity), identity) for identity in store._list('source-reports')
                             if store._read('source-reports', identity)['bundleId'] == bundle.id])
    if operation == 'read':
        record = store._read('source-reports', value.get('reportId'))
        if record['bundleId'] != bundle.id:
            raise Invalid('Report is outside this bundle', 403)
        return report_view(store, record, value.get('reportId'))
    report = SourceEvidenceReport.parse(value)
    with store.lock:
        if report.id not in store._list('source-reports'):
            for identity in report.observationIds:
                if not verify_observation(store, observed(store, identity, bundle.id)):
                    raise Invalid('Observed originals unavailable; restore their exact bytes before creating a report', 409)
            store._write('source-reports', report.id, dict(asdict(report), id=report.id, createdAt=now))
        return report_view(store, store._read('source-reports', report.id), report.id)
