"""Read-only Fisher evidence adapter for immutable Paper research references.

No execution, copying of private notes, source acquisition or new verdicts.
The existing standalone checker owns artifact validation and exact arithmetic.
"""
from .model import Invalid
from .pcgym import read_json
from .pcgym_domain import Invalid as FisherInvalid
from .fisher_result import FisherProtocol, FisherSelection
from .fisher_verify import check
from .research_records import FisherResearchAttempt


def _attempt(store, item_id, attempt_id):
    item = store._read('fisher-items', item_id)
    root = store.root / 'fisher-bundles' / item_id
    protocol = FisherProtocol.parse(read_json(root / 'spec.json'))
    annotation = store.annotation(item['annotationId'])
    selection = FisherSelection.create(store.pdf(annotation.document_id), annotation)
    from .pcgym_domain import digest
    if protocol.id != item_id or item['specId'] != item_id or digest(selection.to_dict()) != protocol.selection_digest:
        raise Invalid('Frozen Fisher source binding changed', 409)
    target = root / 'attempts' / attempt_id
    checked = check(target)
    execution = read_json(target / 'execution.json')
    if checked['spec_id'] != protocol.id or checked['attempt_id'] != attempt_id or execution['status'] != 'completed':
        raise Invalid('Fisher attempt does not belong to the frozen specification', 409)
    return FisherResearchAttempt(annotation.paper_id, annotation.document_id, annotation.id,
        annotation.page, item_id, protocol.id, attempt_id, protocol.pipeline_digest,
        execution['status'], execution['started_at'])


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
                    rows.append(_attempt(store, item_id, path.parent.name))
    except (FisherInvalid, ValueError, OSError, KeyError, TypeError) as error:
        raise Invalid('Saved Fisher evidence failed validation: ' + str(error), 409) from error
    return tuple(sorted(rows, key=lambda row: (row.startedAt, row.attemptId), reverse=True))


def check_fisher_reference(store, reference):
    try:
        current = _attempt(store, reference.itemId, reference.attemptId)
    except (FisherInvalid, ValueError, OSError, KeyError, TypeError) as error:
        raise Invalid('Saved Fisher evidence failed validation: ' + str(error), 409) from error
    if current != reference:
        raise Invalid('Frozen Fisher attempt reference changed', 409)
