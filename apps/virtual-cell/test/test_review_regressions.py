"""Scientific-state, context and prospective-decision regression cases."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import fixture
from baselines import predictions, run_baseline
from candidates import PLAN_SCHEMA, propose
from contract import Invalid, digest, sealed, validate_spec
from dataset import comparison_support, training_view, validate_dataset
from evaluation import evaluate, test_queries
from split import check_split, freeze_split


class ScientificStates(unittest.TestCase):
    def test_zero_and_negative_thresholds_are_rejected(self):
        data = fixture.dataset()
        for threshold in (0, -0.1):
            with self.subTest(threshold=threshold), self.assertRaisesRegex(Invalid, "spec_evaluation_min_skill"):
                validate_spec(fixture.spec(data, **{"evaluation.min_skill": threshold}))

    def test_tiny_improvement_and_copied_truth_never_become_scientific_acceptance(self):
        data = fixture.dataset()
        spec = fixture.spec(data)
        split = freeze_split(data, spec)
        view = training_view(data, split)
        truth = {c["id"]: c["mean"] for c in data["conditions"]}
        additive = {r["id"]: r["mean"] for r in run_baseline("additive", split, view, test_queries(data, split))["conditions"]}
        for factor, expected in ((0, "above_threshold"), (0.999999, "below_threshold"), (1.01, "below_threshold")):
            rows = {cid: [t + factor * (a - t) for t, a in zip(truth[cid], additive[cid])] for cid in additive}
            doc = predictions({"id": "candidate", "kind": "external", "version": "1"}, split, view, rows)
            # A sealed caller assertion does not create Host authority.
            doc = sealed({**doc, "isolation": "verified", "scientific_evidence": "supported"})
            report = evaluate(data, spec, split, [doc])
            result = report["models"][-1]
            self.assertFalse(report["blind"])
            self.assertEqual(result["metric_status"], expected)
            self.assertEqual(result["claim"], "non_blind")
            self.assertEqual(result["scientific_evidence"]["status"], "insufficient")
            self.assertEqual(result["acceptance"]["status"], "not_reviewed")
        with self.assertRaisesRegex(Invalid, "split_blind_mismatch"):
            check_split(data, spec, sealed({**split, "blind": True}),)

    def test_unknown_or_mismatched_batches_and_missing_targets_are_visible(self):
        data = fixture.dataset()
        data["genes"][0] = "unrelated"  # remove A, preserve numeric alignment
        for c in data["conditions"]:
            if c["id"] == "A":
                c["strata"][0]["batch"] = "another_batch"
        spec = fixture.spec(data)
        split = freeze_split(data, spec)
        report = evaluate(data, spec, split)
        additive = report["models"][-1]
        affected = [c for c in additive["conditions"] if "A" in c["id"].split("+")]
        self.assertTrue(affected)
        for c in affected:
            self.assertEqual(c["support"]["readouts"]["targets_missing"], ["A"])
            self.assertIn("batch_sets_mismatch", c["support"]["design"]["reasons"])
        self.assertEqual(additive["coverage"]["predictions"]["evaluated"], len(split["assignments"]["test"]))
        self.assertLess(additive["coverage"]["target_readouts_complete"], additive["coverage"]["attempted"])
        self.assertIn("readout_coverage_incomplete", additive["scientific_evidence"]["reasons"])
        data["design"]["batch_key"] = None
        for c in data["conditions"]:
            c["strata"][0]["batch"] = "unrecorded"
        self.assertIn("batch_unknown", comparison_support(data, ["A", "B"])["reasons"])

    def test_resealed_counts_cannot_change_the_registered_split(self):
        data = fixture.dataset()
        spec = fixture.spec(data)
        split = freeze_split(data, spec)
        changed = copy.deepcopy(split)
        changed["counts"]["combination_test"] += 1
        with self.assertRaisesRegex(Invalid, "split_protocol_mismatch"):
            check_split(data, spec, sealed(changed))


def candidate_fixture():
    data = fixture.dataset()
    data["conditions"] = [c for c in data["conditions"] if c["id"] not in ("A+B", "A+C", "A+D")]
    spec = fixture.spec(data, **{"context.time": {"value": "24 h"}})
    split = freeze_split(data, spec)
    plan = {
        "schema": PLAN_SCHEMA, "spec_digest": digest(spec), "split_digest": split["digest"],
        "objective": {"readout": "transcript_expression", "gene": "A", "direction": "increase",
                      "min_effect": 0.1, "scale": data["scale"], "assay": "scRNA-seq", "sampling_time": {"value": "24 h"}},
        "budget": {"max_candidates": 2, "max_total_cost": 25, "cost_unit": "assay_units"},
        "controls": [{"condition": "ctrl", "role": "negative", "cost": 5},
                     {"condition": "A", "role": "positive", "cost": 5}],
        "candidates": [{"targets": ["A", "B"], "cost": 10}, {"targets": ["A", "D"], "cost": 10},
                       {"targets": ["A", "C"], "cost": 1}, {"targets": ["B", "C"], "cost": 1}],
    }
    return data, spec, split, plan


class CandidateDecisions(unittest.TestCase):
    def test_source_readout_and_assay_must_agree_with_spec_and_candidate_plan(self):
        data, spec, split, plan = candidate_fixture()
        spec["context"]["readout"] = {"value": "protein abundance"}
        with self.assertRaisesRegex(Invalid, "spec_measurement_mismatch"):
            freeze_split(data, spec)
        for measurement in ({"readout": "protein_abundance", "assay": "mass_spectrometry"},
                            {"readout": "transcript_expression", "assay": "bulk_RNA-seq"}):
            with self.subTest(measurement=measurement):
                data, spec, split, plan = candidate_fixture()
                data["measurement"] = measurement
                for key, value in measurement.items():
                    spec["context"][key] = {"value": value}
                spec["dataset"]["digest"] = validate_dataset(data)
                split = freeze_split(data, spec)
                plan.update(spec_digest=digest(spec), split_digest=split["digest"])
                with self.assertRaisesRegex(Invalid, "candidate_source_measurement"):
                    propose(data, spec, split, plan)

    def test_ranks_unmeasured_effect_with_controls_and_cost_cap(self):
        data, spec, split, plan = candidate_fixture()
        report = propose(data, spec, split, plan)
        # Gene A: AB delta +0.75, AD +0.50, AC -0.25.
        self.assertEqual(report["selected_for_review"], ["A+B"])
        self.assertEqual(report["budget"]["proposed_cost"], 20)
        by_id = {c["id"]: c for c in report["conditions"]}
        self.assertEqual(by_id["A+D"]["selection"], "cost_limit")
        self.assertIn("below_effect_threshold", by_id["A+C"]["reasons"])
        self.assertIn("already_observed", by_id["B+C"]["reasons"])
        self.assertEqual((report["status"], report["acceptance"]), ("proposal_only", "not_reviewed"))
        self.assertEqual(report["denominator"], {"attempted": 4, "eligible": 2, "proposed": 1, "ineligible": 2})

    def test_candidate_rank_does_not_depend_on_heldout_readouts(self):
        data, spec, split, plan = candidate_fixture()
        original = propose(data, spec, split, plan)
        for c in data["conditions"]:
            if c["id"] in split["assignments"]["test"]:
                for key in ("mean", "pooled_mean"):
                    c[key] = [v + 1000 for v in c[key]]
                c["strata"][0]["mean"] = list(c["mean"])
        spec["dataset"]["digest"] = validate_dataset(data)
        split = freeze_split(data, spec)
        plan.update(spec_digest=digest(spec), split_digest=split["digest"])
        changed = propose(data, spec, split, plan)
        self.assertEqual(original["conditions"], changed["conditions"])
        self.assertEqual(original["selected_for_review"], changed["selected_for_review"])

    def test_direction_and_candidate_limit_are_applied_before_proposal(self):
        data, spec, split, plan = candidate_fixture()
        plan["objective"]["direction"] = "decrease"
        report = propose(data, spec, split, plan)
        self.assertEqual(report["selected_for_review"], ["A+C"])
        plan["objective"]["direction"] = "increase"
        plan["budget"].update(max_candidates=1, max_total_cost=100)
        report = propose(data, spec, split, plan)
        self.assertEqual(report["selected_for_review"], ["A+B"])
        self.assertEqual(next(c for c in report["conditions"] if c["id"] == "A+D")["selection"], "candidate_limit")

    def test_missing_endpoint_target_time_or_batch_blocks_proposal(self):
        for reason in ("endpoint", "target", "time", "batch"):
            with self.subTest(reason=reason):
                data, spec, split, plan = candidate_fixture()
                plan["candidates"] = plan["candidates"][:1]
                if reason == "endpoint":
                    plan["objective"]["gene"] = "absent"
                elif reason == "target":
                    data["genes"][1] = "absent_B"
                elif reason == "time":
                    spec["context"]["time"] = {"status": "unknown"}
                else:
                    next(c for c in data["conditions"] if c["id"] == "B")["strata"][0]["batch"] = "other"
                spec["dataset"]["digest"] = validate_dataset(data)
                split = freeze_split(data, spec)
                plan.update(spec_digest=digest(spec), split_digest=split["digest"])
                report = propose(data, spec, split, plan)
                self.assertFalse(report["selected_for_review"])
                self.assertTrue(report["conditions"][0]["reasons"])

    def test_stale_plan_unsupported_assay_and_controls_over_budget_are_rejected(self):
        for mutation, error in (("stale", "candidate_plan_stale"), ("assay", "candidate_endpoint_unsupported"),
                                ("budget", "candidate_controls_over_budget")):
            data, spec, split, plan = candidate_fixture()
            if mutation == "stale":
                plan["split_digest"] = "old"
            elif mutation == "assay":
                plan["objective"]["assay"] = "viability"
            else:
                plan["budget"]["max_total_cost"] = 1
            with self.subTest(mutation=mutation), self.assertRaisesRegex(Invalid, error):
                propose(data, spec, split, plan)

    def test_cli_exports_a_frozen_reviewable_proposal(self):
        data, spec, split, plan = candidate_fixture()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name, obj in (("dataset", data), ("spec", spec), ("split", split), ("plan", plan)):
                (root / f"{name}.json").write_text(json.dumps(obj))
            command = [sys.executable, str(Path(__file__).resolve().parents[1] / "backend/cli.py"), "candidates"]
            for name in ("dataset", "spec", "split", "plan"):
                command += [f"--{name}", str(root / f"{name}.json")]
            command += ["--out", str(root / "proposal.json")]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads((root / "proposal.json").read_text())["selected_for_review"], ["A+B"])


if __name__ == "__main__":
    unittest.main()
