"""Paper claims reference Data-owned immutable query evidence; Paper never runs SQL."""
from dataclasses import asdict, dataclass

from .model import Invalid, digest, mapping
from .research_program import reference
from .research_rounds import ResearchClaim
from .retrieval import SourceVersion


@dataclass(frozen=True)
class DataEvidence:
    claim: ResearchClaim
    source: SourceVersion
    queryId: str
    snapshotId: str
    definitionId: str
    resultId: str
    acceptance: str = 'needs_review'

    @classmethod
    def bind(cls, claim, source, query):
        query = mapping(query, 'Data query evidence')
        receipt = mapping(query.get('receipt'), 'Data query receipt')
        intent = mapping(query.get('intent'), 'Data query intent')
        if receipt.get('status') != 'completed' or receipt.get('queryId') != query.get('id'):
            raise Invalid('Only a completed Data-owned query can be cited; execution is not scientific acceptance')
        return cls(claim, source, reference(query.get('id'), 'Data query'),
                   reference(intent.get('snapshotId'), 'Data snapshot'), reference(intent.get('definitionId'), 'Data definition'),
                   reference(receipt.get('resultId'), 'Data result'))

    def to_dict(self):
        value = asdict(self)
        value['source'] = self.source.to_dict()
        return dict(id=digest(value), **value)


def request(store, value, internal=False):
    operation = value.get('operation')
    if operation == 'list' and set(value) == {'operation'}:
        return dict(links=[store._read('data-evidence', identity) for identity in store._list('data-evidence')])
    if operation == 'bind' and internal and set(value) == {'operation', 'claim', 'query'}:
        claim_value = mapping(value['claim'], 'research claim')
        report = store.report(reference(claim_value.get('reportId'), 'claim report'))
        claim = ResearchClaim.parse(claim_value, (report,))
        paper = store.paper(claim.paperId)
        intent = store.intent(report.report.intent_id)
        passage = next((p for p in intent.passages if p.id == claim.passageId and p.paper_id == claim.paperId), None)
        if passage is None:
            raise Invalid('Select a report quotation anchored in an observed PDF passage')
        document = store.pdf(passage.document_id)
        if document.file_digest != passage.file_digest or digest(store.pdf_bytes(document)) != passage.file_digest:
            raise Invalid('The frozen cited PDF original is missing or changed', 409)
        link = DataEvidence.bind(claim, SourceVersion.of(paper, document), value['query']).to_dict()
        store._write('data-evidence', link['id'], link)
        return link
    raise Invalid('Data evidence must be selected through the authorized Host handoff', 403)
