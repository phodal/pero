"""Evaluation values. No model extraction, persistence or product memory owner."""
from dataclasses import dataclass, asdict
from datetime import datetime
from hashlib import sha256
import json


@dataclass(frozen=True)
class Claim:
    id: str
    project: str
    session: str
    topic: str
    value: str
    statement: str
    observed_at: str
    valid_from: str
    valid_to: str | None
    conditions: tuple[tuple[str, str], ...]
    verification: str
    supersedes: tuple[str, ...]
    evidence_refs: tuple[str, ...]
    export: bool
    source_ref: str

    @classmethod
    def parse(cls, value):
        row = dict(value)
        for key in ("observed_at", "valid_from", "valid_to"):
            if row[key] is not None:
                if not row[key].endswith("Z"):
                    raise ValueError("fixture timestamps must be UTC")
                datetime.fromisoformat(row[key].replace("Z", "+00:00"))
        row["conditions"] = tuple(sorted(row["conditions"].items()))
        row["supersedes"] = tuple(row["supersedes"])
        row["evidence_refs"] = tuple(row["evidence_refs"])
        result = cls(**row)
        if not result.id.isalnum() or result.project not in ("alpha", "beta"):
            raise ValueError("fixture id/project rejected")
        if result.source_ref != f"transcript://{result.project}/{result.session}#{result.id}":
            raise ValueError("source identity mismatch")
        if result.verification not in ("unverified", "verified", "untrusted"):
            raise ValueError("unknown verification status")
        return result

    def text(self):
        row = asdict(self)
        row["conditions"] = dict(self.conditions)
        return json.dumps(row, sort_keys=True, ensure_ascii=False)

    def digest(self):
        return sha256((self.text() + "\n").encode()).hexdigest()


@dataclass(frozen=True)
class Source:
    claim: Claim
    sha256: str


@dataclass(frozen=True)
class Question:
    id: str
    phase: str
    project: str
    prompt: str
    query: str
    topic: str
    as_of: str
    conditions: tuple[tuple[str, str], ...]
    require_verified: bool
    expected_status: str
    expected_ids: tuple[str, ...]

    @classmethod
    def parse(cls, value):
        row = dict(value)
        row["conditions"] = tuple(sorted(row["conditions"].items()))
        row["expected_ids"] = tuple(row["expected_ids"])
        datetime.fromisoformat(row["as_of"].replace("Z", "+00:00"))
        return cls(**row)


@dataclass(frozen=True)
class Retrieved:
    source_ref: str
    source_sha256: str


@dataclass(frozen=True)
class Receipt:
    ref: str
    source_ref: str
    value: str
    status: str
    synthetic: bool


@dataclass(frozen=True)
class Decision:
    status: str
    ids: tuple[str, ...]
    source_refs: tuple[str, ...]
    rejected: tuple[tuple[str, str], ...]


def assess(question, retrieved, sources, revoked, receipts):
    """Evaluate explicit synthetic annotations, never infer facts from prose.

    Retrieval is not a verdict. Reread exact bytes, then check scope, validity,
    conditions and explicit receipts. This function does not read expected answers.
    """
    eligible, rejected = [], []
    for hit in retrieved:
        snapshot = sources.get(hit.source_ref)
        source = snapshot.claim if snapshot else None
        reason = None
        if hit.source_ref in revoked:
            reason = "revoked"
        elif source is None:
            reason = "missing_source"
        elif source.project != question.project:
            reason = "wrong_scope"
        elif snapshot.sha256 != hit.source_sha256:
            reason = "changed_source"
        elif source.topic != question.topic:
            reason = "wrong_topic"
        elif source.observed_at > question.as_of or source.valid_from > question.as_of:
            reason = "not_yet_observed_or_valid"
        elif source.valid_to and source.valid_to <= question.as_of:
            reason = "expired"
        elif not set(question.conditions).issubset(source.conditions):
            reason = "wrong_conditions"
        elif source.verification == "untrusted":
            reason = "untrusted_data"
        elif question.require_verified and (
            source.verification != "verified"
            or not source.evidence_refs
            or not all(any(r.ref == ref and r.source_ref == source.source_ref
                           and r.value == source.value and r.status == "passed"
                           for r in receipts) for ref in source.evidence_refs)
        ):
            reason = "no_supporting_verifier_receipt"
        if reason:
            rejected.append((hit.source_ref, reason))
        else:
            eligible.append(source)
    superseded = {old for source in eligible for old in source.supersedes}
    eligible = sorted({s.id: s for s in eligible if s.id not in superseded}.values(), key=lambda s: s.id)
    status = "abstain"
    if eligible:
        status = "conflict" if len({s.value for s in eligible}) > 1 else (
            "evidence_reference" if question.require_verified else "candidate")
    return Decision(status, tuple(s.id for s in eligible),
                    tuple(s.source_ref for s in eligible), tuple(rejected))
