"""Cross-study interpretations retain exact observed report evidence."""
from dataclasses import asdict, dataclass
import json

from .model import Invalid, digest, mapping, sequence, text
from .research_program import reference


@dataclass(frozen=True)
class ResearchClaim:
    text: str
    stance: str
    reportId: str
    paperId: str
    passageId: str
    quote: str

    @classmethod
    def parse(cls, value, reports):
        value = mapping(value, 'research claim')
        report_id = reference(value.get('reportId'), 'claim report')
        report = next((r for r in reports if r.id == report_id), None)
        if report is None:
            raise Invalid('Claim report is outside this round')
        groups = list(report.report.sections)
        if report.report.matrix:
            groups.extend(report.report.matrix.cells)
        # The report is immutable: section evidence followed by matrix evidence
        # gives a stable selector without asking the model to rewrite source bytes.
        matches = [(index, ref) for index, ref in enumerate(ref for group in groups for ref in group.evidence)
                   if ref.paper_id == value.get('paperId') and ref.passage_id == value.get('passageId')]
        if not matches:
            raise Invalid('Claim must cite an exact observed passage in its saved report; '
                          'use reportId, paperId and passageId from the finalized report')
        choices = json.dumps([dict(evidenceIndex=index, quote=ref.quote) for index, ref in matches], ensure_ascii=False)
        if 'evidenceIndex' in value:
            index = value['evidenceIndex']
            if type(index) is not int or not any(index == i for i, _ in matches):
                raise Invalid('Choose a saved evidenceIndex for this report/paper/passage: ' + choices)
            matches = [(i, ref) for i, ref in matches if i == index]
        if value.get('quote') is not None:
            matches = [(i, ref) for i, ref in matches if ref.quote == value['quote']]
            if not matches:
                raise Invalid('Claim quote must exactly match a saved report quotation, including line endings. '
                              'Omit quote and select a saved evidenceIndex; do not rewrite it or create another Study. '
                              'Saved choices: ' + choices)
        if len({ref.quote for _, ref in matches}) != 1:
            raise Invalid('This report cites multiple quotations for the passage; '
                          'select a saved evidenceIndex (omit quote), or supply its exact quote. Saved choices: ' + choices)
        if value.get('stance') not in ('support', 'counterevidence', 'limitation'):
            raise Invalid('Choose support, counterevidence or limitation')
        _, ref = matches[0]
        return cls(text(value.get('text'), 4000, 'claim'), value['stance'], report_id, ref.paper_id, ref.passage_id, ref.quote)


@dataclass(frozen=True)
class DocumentEvidence:
    reportId: str
    observationId: str
    paperId: str
    documentId: str
    blockId: str
    sourceUrl: str
    texts: tuple[str, ...]


@dataclass(frozen=True)
class DocumentClaim:
    text: str
    stance: str
    reportId: str
    paperId: str
    observationId: str
    documentId: str
    blockId: str
    quote: str
    sourceUrl: str
    sourceKind: str = 'html'

    @classmethod
    def parse(cls, value, evidence):
        quote = text(value.get('quote'), 4000, 'observed HTML quote')
        match = next((item for item in evidence if all(value.get(key) == getattr(item, key)
            for key in ('reportId', 'observationId', 'paperId', 'documentId', 'blockId'))
            and any(quote in part for part in item.texts)), None)
        if match is None:
            raise Invalid('HTML claim must cite text in an exact observed window of its saved report')
        if value.get('stance') not in ('support', 'counterevidence', 'limitation'):
            raise Invalid('Choose support, counterevidence or limitation')
        return cls(text(value.get('text'), 4000, 'claim'), value['stance'], match.reportId, match.paperId,
                   match.observationId, match.documentId, match.blockId, quote, match.sourceUrl)


def evidence_key(claim):
    return (claim.get('sourceKind', 'pdf'), claim['paperId'], claim.get('passageId') or claim.get('documentId'),
            claim.get('blockId', ''), claim['quote'] if claim.get('sourceKind') == 'html' else '')


@dataclass(frozen=True)
class ResearchRound:
    number: int
    question: str
    reportIds: tuple[str, ...]
    claims: tuple[ResearchClaim | DocumentClaim, ...]
    gaps: tuple[str, ...]
    nextAction: str
    createdAt: str
    previousCheckpoint: str
    screeningDigest: str
    newEvidence: int
    acceptance: str = 'needs_review'
    researchRecordIds: tuple[str, ...] = ()

    @property
    def id(self):
        return digest(asdict(self))

    @classmethod
    def create(cls, value, program, reports, previous, now, document_evidence=()):
        values = [mapping(c, 'research claim') for c in sequence(value.get('claims'), 64, 'claims')]
        if any(c.get('sourceKind', 'pdf') not in ('pdf', 'html') for c in values):
            raise Invalid('Choose PDF or HTML evidence')
        claims = tuple(DocumentClaim.parse(c, document_evidence) if c.get('sourceKind') == 'html' else ResearchClaim.parse(c, reports) for c in values)
        if not claims:
            raise Invalid('A completed research round needs at least one observed claim; use finish for blocked work')
        gaps = tuple(text(g, 2000, 'gap') for g in sequence(value.get('gaps', []), 32, 'gaps'))
        old = {evidence_key(c) for r in previous for c in r['claims']}
        added = len({evidence_key(asdict(c)) for c in claims} - old)
        screening = digest([(c.id, c.decision) for c in program.candidates])
        return cls(len(program.roundIds) + 1, text(value.get('question'), 2000, 'round question'),
                   tuple(value['reportIds']), claims, gaps, text(value.get('nextAction'), 2000, 'next action'),
                   now, program.checkpoint, screening, added)

    def to_dict(self):
        return dict(id=self.id, **asdict(self))
