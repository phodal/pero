"""Review lifecycle concepts, with explicit source/permission/closed-session values."""
from dataclasses import asdict, replace
from pathlib import Path
import json
import unittest

from model import Claim, Question, Retrieved, Source
from review import ReviewState, analyze, publish, revoke, rollback, context


class ReviewedProjection(unittest.TestCase):
    def setUp(self):
        raw = json.loads(Path(__file__).with_name("fixtures.json").read_text())
        self.claims = tuple(Claim.parse(row) for row in raw["records"])
        self.sources = {c.source_ref: Source(c, c.digest()) for c in self.claims if c.export}
        self.refs = tuple(Retrieved(c.source_ref, c.digest()) for c in self.claims)
        self.questions = [Question.parse(row) for row in raw["questions"]]

    def test_review_and_recovery_transitions(self):
        draft = analyze(self.questions[0], self.refs, self.sources, (), (), closed=True, permitted=True, watermark=3)
        state = ReviewState()
        for name, changes, reason in [
            ("default off", {}, "review_required"),
            ("wrong approval", {"approved_key": "different"}, "review_required"),
            ("cancelled", {"approved_key": draft.key, "cancelled": True}, "cancelled"),
            ("concurrent revision", {"approved_key": draft.key, "expected_revision": 7}, "revision_conflict"),
        ]:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, reason):
                publish(state, draft, self.sources, (), (), **dict({"expected_revision": 0}, **changes))
        one = publish(state, draft, self.sources, (), (), approved_key=draft.key, expected_revision=0)
        restored = ReviewState.parse(json.loads(json.dumps(asdict(one))))
        self.assertEqual(publish(restored, draft, self.sources, (), (), approved_key=draft.key, expected_revision=0), one)
        changed = analyze(self.questions[2], self.refs, self.sources, (), (), closed=True, permitted=True, watermark=4)
        two = publish(one, changed, self.sources, (), (), approved_key=changed.key, expected_revision=1)
        rolled = rollback(two, 1, self.sources, (), ())
        text, decision = context(rolled, self.questions[0], self.sources, (), (), 4096)
        self.assertEqual(decision.ids, ("a02",)); self.assertIn("transcript://alpha/session-b#a02", text)
        self.assertEqual(context(rolled, self.questions[0], self.sources, (), (), 32)[0], "")
        ref = draft.references[0].source_ref
        withdrawn = revoke(rolled, {ref})
        self.assertEqual(context(withdrawn, self.questions[0], self.sources, {ref}, (), 4096)[0], "")
        with self.assertRaisesRegex(ValueError, "rollback_sources_unavailable"):
            rollback(withdrawn, 1, self.sources, {ref}, ())
        with self.assertRaisesRegex(ValueError, "draft_sources_changed_or_revoked"):
            publish(state, draft, self.sources, {ref}, (), approved_key=draft.key, expected_revision=0)
        stale = dict(self.sources)
        stale[ref] = replace(stale[ref], sha256="changed")
        with self.assertRaisesRegex(ValueError, "draft_sources_changed_or_revoked"):
            publish(state, draft, stale, (), (), approved_key=draft.key, expected_revision=0)
        with self.assertRaisesRegex(ValueError, "watermark_regression"):
            publish(replace(state, watermark=4), draft, self.sources, (), (), approved_key=draft.key, expected_revision=0)
        missing = {k: v for k, v in self.sources.items() if k != ref}
        self.assertEqual(context(one, self.questions[0], missing, (), (), 4096)[0], "")

    def test_analysis_rejects_unfinished_unauthorized_untrusted_and_sensitive_inputs(self):
        for name, q, options, reason in [
            ("open session", self.questions[0], {"closed": False}, "session_not_closed"),
            ("unauthorized", self.questions[0], {"permitted": False}, "scope_not_authorized"),
            ("budget", self.questions[0], {"max_input_bytes": 1}, "analysis_budget_exceeded"),
            ("injection", self.questions[11], {}, "no_admissible_evidence"),
            ("absent", self.questions[9], {}, "no_admissible_evidence"),
            ("other project", self.questions[10], {}, "no_admissible_evidence"),
        ]:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, reason):
                analyze(q, self.refs, self.sources, (), (), **dict({"closed": True, "permitted": True, "watermark": 1}, **options))
        base = next(c for c in self.claims if c.id == "a08")
        sensitive = replace(base, statement="api_key=sk-synthetic-only")
        source = {sensitive.source_ref: Source(sensitive, sensitive.digest())}
        with self.assertRaisesRegex(ValueError, "sensitive_source"):
            analyze(self.questions[8], (Retrieved(sensitive.source_ref, sensitive.digest()),), source,
                    (), (), closed=True, permitted=True, watermark=1)


if __name__ == "__main__":
    unittest.main()
