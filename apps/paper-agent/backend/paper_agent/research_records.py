"""Manual research revisions over existing source/report owners; never execution."""
from dataclasses import asdict, dataclass

from .model import ID, Invalid, PaperSnapshot, digest, mapping, sequence, text
from .research_resources import ArxivPaper


def reference(value, label):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise Invalid('Invalid ' + label)
    return value


@dataclass(frozen=True)
class ScreeningDecision:
    paperId: str
    decision: str
    reason: str

    @classmethod
    def parse(cls, value, papers):
        value = mapping(value, 'screening decision')
        if set(value) != {'paperId', 'decision', 'reason'} or value.get('paperId') not in papers:
            raise Invalid('Screening must reference a selected paper')
        if value.get('decision') not in ('include', 'exclude', 'pending'):
            raise Invalid('Choose include, exclude or pending')
        return cls(value['paperId'], value['decision'], text(value.get('reason'), 2000, 'screening reason'))


@dataclass(frozen=True)
class EvidenceLink:
    paperId: str
    reportId: str | None
    stance: str
    note: str

    @classmethod
    def parse(cls, value, papers):
        value = mapping(value, 'evidence link')
        if set(value) - {'paperId', 'reportId', 'stance', 'note'} or value.get('paperId') not in papers:
            raise Invalid('Evidence must reference a selected paper')
        stance = value.get('stance')
        if stance not in ('support', 'counterevidence', 'gap'):
            raise Invalid('Choose support, counterevidence or gap')
        report = value.get('reportId')
        if report is not None or stance != 'gap':
            report = reference(report, 'saved report reference')
        return cls(value['paperId'], report, stance, text(value.get('note'), 2000, 'evidence interpretation'))


@dataclass(frozen=True)
class SourceVersion:
    paperId: str
    contentDigest: str
    pdfDocumentId: str | None = None
    pdfDigest: str | None = None
    structuredDocumentIds: tuple[str, ...] = ()

    def to_dict(self):
        value = dict(paperId=self.paperId, contentDigest=self.contentDigest)
        if self.pdfDocumentId is not None:
            value.update(pdfDocumentId=self.pdfDocumentId, pdfDigest=self.pdfDigest)
        if self.structuredDocumentIds:
            value['structuredDocumentIds'] = list(self.structuredDocumentIds)
        return value


@dataclass(frozen=True)
class ResearchAttempt:
    paperId: str
    documentId: str
    annotationId: str
    page: int
    itemId: str
    specId: str
    attemptId: str
    policy: str
    profile: str
    seed: int
    methodDigest: str
    status: str
    startedAt: str


@dataclass(frozen=True)
class ReviewDecision:
    decision: str
    note: str
    identityScope: str = 'local-user-declared'

    @classmethod
    def parse(cls, value):
        value = mapping(value, 'review decision')
        if set(value) != {'decision', 'note'} or value.get('decision') not in ('needs_review', 'accepted', 'rejected'):
            raise Invalid('Review needs a decision and reason; no independent identity is asserted')
        return cls(value['decision'], text(value['note'], 2000, 'review reason'))


@dataclass(frozen=True)
class ResearchRecord:
    question: str
    scope: str
    inclusion: str
    exclusion: str
    paperIds: tuple[str, ...]
    decisions: tuple[ScreeningDecision, ...]
    evidence: tuple[EvidenceLink, ...]
    sourceVersions: tuple[SourceVersion, ...]
    createdAt: str
    parentId: str | None = None
    review: ReviewDecision | None = None
    attempts: tuple[ResearchAttempt, ...] = ()

    @classmethod
    def create(cls, value, papers, now, *, sources=None, available_attempts=()):
        if set(value) - {'operation', 'question', 'scope', 'inclusion', 'exclusion', 'paperIds', 'decisions', 'evidence', 'parentId', 'review', 'attempts'}:
            raise Invalid('Unknown research record fields')
        ids = tuple(p.id for p in papers)
        if not 1 <= len(ids) <= 32 or len(set(ids)) != len(ids):
            raise Invalid('Choose 1–32 distinct saved papers')
        decisions = tuple(ScreeningDecision.parse(item, ids) for item in sequence(value.get('decisions'), 32, 'screening decisions'))
        if len(decisions) != len(ids) or {item.paperId for item in decisions} != set(ids):
            raise Invalid('Give every selected paper exactly one screening decision and reason')
        evidence = tuple(EvidenceLink.parse(item, ids) for item in sequence(value.get('evidence', []), 64, 'evidence links'))
        attempts = []
        for item in sequence(value.get('attempts', []), 32, 'reproduction attempts'):
            item = mapping(item, 'attempt reference')
            if set(item) != {'itemId', 'attemptId'}:
                raise Invalid('Choose a verification item and an execution attempt')
            link = next((row for row in available_attempts if row.itemId == item['itemId']
                         and row.attemptId == item['attemptId'] and row.paperId in ids), None)
            if link is None or link in attempts:
                raise Invalid('Choose distinct completed, failed or cancelled attempts from selected papers')
            attempts.append(link)
        parent = reference(value['parentId'], 'parent revision') if value.get('parentId') is not None else None
        return cls(*(text(value.get(key), 4000, key) for key in ('question', 'scope', 'inclusion', 'exclusion')),
                   ids, decisions, evidence, sources if sources is not None else tuple(SourceVersion(p.id, p.content_digest) for p in papers), now,
                   parent, ReviewDecision.parse(value['review']) if value.get('review') is not None else None, tuple(attempts))

    def body(self):
        value = asdict(self)
        for key in ('paperIds', 'decisions', 'evidence'):
            value[key] = list(value[key])
        value['sourceVersions'] = [item.to_dict() for item in self.sourceVersions]
        if self.attempts:
            value['attempts'] = [asdict(item) for item in self.attempts]
        else:
            del value['attempts']
        return value

    @property
    def id(self):
        return digest(self.body())

    def to_dict(self):
        return dict(self.body(), id=self.id, verification='not_run')

    @classmethod
    def from_record(cls, value, identity):
        result = cls(*(value[key] for key in ('question', 'scope', 'inclusion', 'exclusion')),
                     tuple(value['paperIds']), tuple(ScreeningDecision(**item) for item in value['decisions']),
                     tuple(EvidenceLink(**item) for item in value['evidence']),
                     tuple(SourceVersion(**{**item, 'structuredDocumentIds': tuple(item.get('structuredDocumentIds', ()))})
                           for item in value['sourceVersions']), value['createdAt'], value['parentId'],
                     ReviewDecision(**value['review']) if value['review'] else None,
                     tuple(ResearchAttempt(**item) for item in value.get('attempts', ())))
        if result.id != identity or value != result.to_dict():
            raise Invalid('Research revision identity check failed', 409)
        return result

    def impact(self, saved: tuple[PaperSnapshot, ...], sources: tuple[SourceVersion, ...],
               arxiv_works: dict[str, ArxivPaper], method_digest: str | None):
        """Compare retained versions of an identified work."""
        items = []
        for version in self.sourceVersions:
            original = next((p for p in saved if p.id == version.paperId), None)
            original_work = arxiv_works.get(version.paperId)
            alternatives = tuple(p for p in saved if original and p.id != original.id and (
                (p.source, p.source_id) == (original.source, original.source_id) or
                (original_work and p.id in arxiv_works and arxiv_works[p.id].work == original_work.work)))
            changed = tuple(p for p in alternatives if p.content_digest != version.contentDigest or
                            (original_work and p.id in arxiv_works and arxiv_works[p.id].revision != original_work.revision))
            current = next((item for item in sources if item.paperId == version.paperId), None)
            pdf_changed = current is not None and (current.pdfDocumentId, current.pdfDigest) != (version.pdfDocumentId, version.pdfDigest)
            structured_changed = current is not None and set(current.structuredDocumentIds) != set(version.structuredDocumentIds)
            status = 'unknown' if original is None or current is None else 'changed' if changed or pdf_changed or structured_changed else 'unchanged'
            items.append(dict(paperId=version.paperId, status=status, frozenDigest=version.contentDigest,
                              currentDigest=original.content_digest if original else None,
                              candidatePaperIds=[p.id for p in changed],
                              pdfChanged=pdf_changed, structuredChanged=structured_changed,
                              reason='Saved source or reading artifact unavailable' if status == 'unknown' else
                              'Saved source or reading version differs' if status == 'changed' else 'Saved versions match'))
        changed_ids = {item['paperId'] for item in items if item['status'] == 'changed'}
        affected_attempts = tuple(item for item in self.attempts if item.paperId in changed_ids or
                                  (method_digest and item.methodDigest != method_digest))
        return dict(recordId=self.id, items=items, execution='not_requested', upstreamStatus='unknown',
                    affectedAttempts=[asdict(item) for item in affected_attempts],
                    affectedReportIds=list(dict.fromkeys(item.reportId for item in self.evidence if item.paperId in changed_ids and item.reportId)),
                    dataStatus='generated_by_attempt' if self.attempts else 'not_tracked',
                    methodStatus=('changed' if any(item.methodDigest != method_digest for item in self.attempts) else 'unchanged')
                    if method_digest and self.attempts else 'not_tracked')

    def selection(self, paper_ids, now):
        ids = tuple(reference(item, 'reread paper reference')
                    for item in sequence(paper_ids, 32, 'reread selection'))
        if not ids or len(set(ids)) != len(ids) or not set(ids).issubset(self.paperIds):
            raise Invalid('Select distinct papers from this research revision')
        body = dict(recordId=self.id, paperIds=list(ids), createdAt=now, action='reread',
                    execution='not_requested', verification='not_run')
        return dict(body, id=digest(body))

    def read_selection(self, value, identity):
        expected = self.selection(value.get('paperIds'), value.get('createdAt'))
        if value != expected or expected['id'] != identity:
            raise Invalid('Reread selection identity check failed', 409)
        return expected

    def export_index(self):
        # Even user-authored notes can contain private material. Default export is
        # references only, not a textual report or a computational handoff capsule.
        return dict(schema='pero.research-record-index.v1', recordId=self.id, parentId=self.parentId,
                    sourceVersions=[item.to_dict() for item in self.sourceVersions],
                    reportIds=list(dict.fromkeys(item.reportId for item in self.evidence if item.reportId)),
                    attempts=[asdict(item) for item in self.attempts],
                    verification='not_run', omitted=['Question and scope', 'Notes and screening reasons',
                        'Paper text', 'Report text', 'Private data', 'Paths and credentials'],
                    limitation='Reference index only. Not a portable research record or a recomputation package.')
