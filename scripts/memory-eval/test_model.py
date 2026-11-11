"""Tests explicit admission behavior, not LLM semantic correctness."""
from dataclasses import replace
from pathlib import Path
import json
import unittest

from model import Claim, Source, Question, Retrieved, Receipt, assess


class RecallAdmission(unittest.TestCase):
    def test_current_historical_conflict_verification_and_absence(self):
        data = json.loads(Path(__file__).with_name("fixtures.json").read_text())
        claims = tuple(Claim.parse(row) for row in data["records"])
        sources = {c.source_ref: Source(c, c.digest()) for c in claims if c.export}
        blue = next(c for c in claims if c.id == "a06")
        receipts = (Receipt("verifier://synthetic/run-blue", blue.source_ref, "0.62", "passed", True),)
        for row in data["questions"]:
            question = Question.parse(row)
            if question.phase != "initial" or question.id == "Q15-semantic-query":
                continue
            with self.subTest(question=question.id):
                hits = tuple(Retrieved(c.source_ref, c.digest()) for c in claims if c.topic == question.topic)
                got = assess(question, hits, sources, frozenset(), receipts)
                self.assertEqual((got.status, got.ids), (question.expected_status, question.expected_ids))

    def test_reference_lifecycle_and_untrusted_payload(self):
        data = json.loads(Path(__file__).with_name("fixtures.json").read_text())
        claim = Claim.parse(data["records"][0])
        question = replace(Question.parse(data["questions"][1]), expected_ids=("deliberately-wrong-gold",))
        hit = Retrieved(claim.source_ref, claim.digest())
        for name, source, revoked, want, reason in (
            ("original", Source(claim, claim.digest()), frozenset(), "candidate", None),
            ("deleted", None, frozenset(), "abstain", "missing_source"),
            ("revoked", Source(claim, claim.digest()), frozenset({claim.source_ref}), "abstain", "revoked"),
            ("same parsed fields changed bytes", Source(claim, "different-byte-hash"), frozenset(), "abstain", "changed_source"),
            ("wrong project", Source(replace(claim, project="beta"), claim.digest()), frozenset(), "abstain", "wrong_scope"),
        ):
            with self.subTest(name=name):
                got = assess(question, (hit,), {claim.source_ref: source} if source else {}, revoked, ())
                self.assertEqual(got.status, want)
                if reason:
                    self.assertEqual(got.rejected[0][1], reason)
                else:
                    self.assertEqual(got.ids, (claim.id,))  # Gold labels cannot decide the result.

    def test_verifier_exists_but_does_not_support_claim(self):
        data = json.loads(Path(__file__).with_name("fixtures.json").read_text())
        claim = Claim.parse(data["records"][5])
        question = Question.parse(data["questions"][6])
        hit = Retrieved(claim.source_ref, claim.digest())
        source = {claim.source_ref: Source(claim, claim.digest())}
        for receipt in (
            Receipt(claim.evidence_refs[0], "transcript://alpha/other#event", claim.value, "passed", True),
            Receipt(claim.evidence_refs[0], claim.source_ref, "wrong value", "passed", True),
            Receipt(claim.evidence_refs[0], claim.source_ref, claim.value, "failed", True),
        ):
            with self.subTest(receipt=receipt):
                self.assertEqual(assess(question, (hit,), source, frozenset(), (receipt,)).status, "abstain")


if __name__ == "__main__":
    unittest.main()
