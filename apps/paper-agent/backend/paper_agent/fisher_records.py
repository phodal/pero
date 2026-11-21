"""Read-only Fisher evidence adapter for immutable Paper research references.

No execution, copying of private notes, source acquisition or new verdicts.
The existing standalone checker owns artifact validation and exact arithmetic.
"""
from dataclasses import asdict, dataclass
import re

from .model import Invalid, digest
from .pcgym import read_json
from .pcgym_domain import Invalid as FisherInvalid
from .fisher_result import PDF_SHA256, FisherProtocol, FisherSelection
from .fisher_verify import check
from .research_records import FisherResearchAttempt


def _attempt(store, item_id, attempt_id):
    item = store._read('fisher-items', item_id)
    root = store.root / 'fisher-bundles' / item_id
    protocol = FisherProtocol.parse(read_json(root / 'spec.json'))
    annotation = store.annotation(item['annotationId'])
    selection = FisherSelection.create(store.pdf(annotation.document_id), annotation)
    if protocol.id != item_id or item['specId'] != item_id or digest(selection.to_dict()) != protocol.selection_digest:
        raise Invalid('Frozen Fisher source binding changed', 409)
    target = root / 'attempts' / attempt_id
    checked = check(target)
    execution = read_json(target / 'execution.json')
    if checked['spec_id'] != protocol.id or checked['attempt_id'] != attempt_id or execution['status'] != 'completed':
        raise Invalid('Fisher attempt does not belong to the frozen specification', 409)
    reference = FisherResearchAttempt(annotation.paper_id, annotation.document_id, annotation.id,
        annotation.page, item_id, protocol.id, attempt_id, protocol.pipeline_digest,
        execution['status'], execution['started_at'])
    return reference, checked, execution['observations_sha256']


def fisher_attempts(store, paper_ids):
    rows = []
    try:
        for item_id in store._list('fisher-items'):
            item = store._read('fisher-items', item_id)
            if store.annotation(item['annotationId']).paper_id not in paper_ids:
                continue
            root = store.root / 'fisher-bundles' / item_id / 'attempts'
            for path in root.glob('*/execution.json'):
                if read_json(path).get('status') == 'completed':
                    rows.append(_attempt(store, item_id, path.parent.name)[0])
    except (FisherInvalid, ValueError, OSError, KeyError, TypeError) as error:
        raise Invalid('Saved Fisher evidence failed validation: ' + str(error), 409) from error
    return tuple(sorted(rows, key=lambda row: (row.startedAt, row.attemptId), reverse=True))


def check_fisher_reference(store, reference):
    try:
        current, _, _ = _attempt(store, reference.itemId, reference.attemptId)
    except (FisherInvalid, ValueError, OSError, KeyError, TypeError) as error:
        raise Invalid('Saved Fisher evidence failed validation: ' + str(error), 409) from error
    if current != reference:
        raise Invalid('Frozen Fisher attempt reference changed', 409)


@dataclass(frozen=True)
class FisherNotebookEvidence:
    """A reference-only projection; its hash is integrity, not authentication."""

    itemId: str
    attemptId: str
    paperId: str
    documentId: str
    annotationId: str
    page: int
    fileDigest: str
    observationsDigest: str
    exactNumerator: int
    exactDenominator: int
    resultVerdict: str
    numericRecomputation: str
    paperVerdict: str
    kind: str = 'fisher-attempt'

    def wire(self):
        snapshot = asdict(self)
        return dict(schema='pero.fisher-notebook-evidence.v1', id=digest(snapshot), snapshot=snapshot)


def notebook_evidence(store, request):
    if not isinstance(request, dict) or set(request) not in (
            {'itemId', 'attemptId'}, {'itemId', 'attemptId', 'receiptId'}):
        raise Invalid('Choose an exact Fisher item and attempt')
    for key, length in (('itemId', 64), ('attemptId', 32), ('receiptId', 64)):
        if key in request and (not isinstance(request[key], str)
                or re.fullmatch('[a-f0-9]{%d}' % length, request[key]) is None):
            raise Invalid('Invalid Fisher ' + key)
    try:
        row, checked, observations_digest = _attempt(store, request['itemId'], request['attemptId'])
    except (FisherInvalid, ValueError, OSError, KeyError, TypeError) as error:
        raise Invalid('Saved Fisher evidence failed validation: ' + str(error), 409) from error
    if not store.pdf_available(PDF_SHA256, 494_926):
        raise Invalid('The exact original Fisher PDF is missing or changed', 409)
    receipt = FisherNotebookEvidence(row.itemId, row.attemptId, row.paperId, row.documentId,
        row.annotationId, row.page, PDF_SHA256, observations_digest,
        checked['exact_numerator'], checked['exact_denominator'], checked['result_verdict'],
        checked['numeric_recomputation'], checked['paper_verdict']).wire()
    if 'receiptId' in request and receipt['id'] != request['receiptId']:
        raise Invalid('The saved Fisher evidence does not match this Notebook receipt', 409)
    return receipt
