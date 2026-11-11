"""Evaluation-only reviewed Markdown projection. No daemon, model or database."""
from dataclasses import dataclass, replace
from hashlib import sha256
import json
import re

from model import Question, Retrieved, assess


@dataclass(frozen=True)
class Draft:
    key: str
    question: Question
    watermark: int
    references: tuple[Retrieved, ...]
    markdown: str


@dataclass(frozen=True)
class Page:
    revision: int
    draft: Draft


@dataclass(frozen=True)
class ReviewState:
    revision: int = 0
    watermark: int = 0
    applied: tuple[str, ...] = ()
    history: tuple[Page, ...] = ()
    active: tuple[Page, ...] = ()

    @classmethod
    def parse(cls, value):
        def page(row):
            raw = row["draft"]
            question = dict(raw["question"], conditions=dict(raw["question"]["conditions"]))
            draft = Draft(raw["key"], Question.parse(question), raw["watermark"],
                          tuple(Retrieved(**ref) for ref in raw["references"]), raw["markdown"])
            if draft.key != sha256((str(draft.watermark) + "\n" + draft.markdown).encode()).hexdigest():
                raise ValueError("checkpoint_draft_hash_mismatch")
            return Page(row["revision"], draft)
        return cls(value["revision"], value["watermark"], tuple(value["applied"]),
                   tuple(page(row) for row in value["history"]), tuple(page(row) for row in value["active"]))


def render(question, decision, sources):
    rows = [f"# {question.topic}", "", f"Project: {question.project}",
            f"As of: {question.as_of}", f"Decision: {decision.status}",
            "Reviewed representation; scientific status belongs to its source evidence.", ""]
    for ref in decision.source_refs:
        source = sources[ref]
        claim = source.claim
        rows += [f"- {claim.statement}", f"  - Value: {claim.value}; status: {claim.verification}",
                 f"  - Conditions: {json.dumps(dict(claim.conditions), sort_keys=True)}",
                 f"  - Observed: {claim.observed_at}; valid: {claim.valid_from} to {claim.valid_to or 'open'}",
                 f"  - Source: [{claim.id}]({ref}); SHA-256: {source.sha256}",
                 f"  - Evidence: {', '.join(claim.evidence_refs) or 'none'}",
                 f"  - Supersedes: {', '.join(claim.supersedes) or 'none'}"]
    return "\n".join(rows) + "\n"


def analyze(question, retrieved, sources, revoked, receipts, *, closed, permitted,
            watermark, max_input_bytes=16384):
    if not permitted:
        raise ValueError("scope_not_authorized")
    if not closed:
        raise ValueError("session_not_closed")
    if sum(len(s.claim.text().encode()) for s in sources.values()) > max_input_bytes:
        raise ValueError("analysis_budget_exceeded")
    decision = assess(question, retrieved, sources, revoked, receipts)
    if not decision.ids:
        raise ValueError("no_admissible_evidence")
    # A narrow, disclosed secret-field filter, not a claim of arbitrary DLP.
    for ref in decision.source_refs:
        if re.search(r"(?i)\b(api[_-]?key|password|secret)\s*[:=]\s*\S+", sources[ref].claim.statement):
            raise ValueError("sensitive_source")
    references = tuple(Retrieved(ref, sources[ref].sha256) for ref in decision.source_refs)
    text = render(question, decision, sources)
    identity = sha256((str(watermark) + "\n" + text).encode()).hexdigest()
    return Draft(identity, question, watermark, references, text)


def publish(state, draft, sources, revoked, receipts, *, approved_key=None,
            expected_revision, cancelled=False):
    if cancelled:
        raise ValueError("cancelled")
    if approved_key != draft.key:
        raise ValueError("review_required")
    if draft.key in state.applied:
        return state  # Retry after a committed checkpoint is idempotent.
    if expected_revision != state.revision:
        raise ValueError("revision_conflict")
    if draft.watermark < state.watermark:
        raise ValueError("watermark_regression")
    # Publication is a new transition: re-read current sources in the shell and
    # reuse the one admission rule to reject edits/revocation during review.
    decision = assess(draft.question, draft.references, sources, revoked, receipts)
    if decision.source_refs != tuple(ref.source_ref for ref in draft.references):
        raise ValueError("draft_sources_changed_or_revoked")
    page = Page(state.revision + 1, draft)
    active = tuple(p for p in state.active if (p.draft.question.project, p.draft.question.topic)
                   != (draft.question.project, draft.question.topic)) + (page,)
    return ReviewState(page.revision, draft.watermark, state.applied + (draft.key,), state.history + (page,), active)


def revoke(state, refs):
    active = tuple(p for p in state.active if not any(r.source_ref in refs for r in p.draft.references))
    return replace(state, revision=state.revision + 1, active=active)


def rollback(state, revision, sources, revoked, receipts):
    original = next(p for p in state.history if p.revision == revision)
    draft = original.draft
    decision = assess(draft.question, draft.references, sources, revoked, receipts)
    if decision.source_refs != tuple(ref.source_ref for ref in draft.references):
        raise ValueError("rollback_sources_unavailable")
    page = Page(state.revision + 1, draft)
    active = tuple(p for p in state.active if (p.draft.question.project, p.draft.question.topic)
                   != (draft.question.project, draft.question.topic)) + (page,)
    return replace(state, revision=page.revision, history=state.history + (page,), active=active)


def context(state, question, sources, revoked, receipts, max_bytes):
    refs = tuple(ref for page in state.active if page.draft.question.project == question.project
                 and page.draft.question.topic == question.topic for ref in page.draft.references)
    decision = assess(question, refs, sources, revoked, receipts)
    if not decision.ids:
        return "", decision
    text = render(question, decision, sources)
    return (text if len(text.encode()) <= max_bytes else ""), decision
