import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import fixture
from baselines import predictions, run_baseline
from contract import Invalid, digest, sealed, validate_spec
from dataset import evaluation_view, training_view, validate_dataset
from evaluation import evaluate, test_queries
from split import check_split, freeze_split

CLI = Path(__file__).resolve().parents[1] / "backend" / "cli.py"


def setup(cells=50, **overrides):
    data = fixture.dataset(cells)
    task = fixture.spec(data, **overrides)
    return data, task, freeze_split(data, task)


def model_doc(split, data, rows, model_id="oracle", output="condition_mean"):
    view = training_view(data, split)
    return predictions({"id": model_id, "kind": "test", "version": "1"}, split, view, rows, output)


def oracle_rows(data, split):
    return {cid: fixture.double_truth(*targets) for cid, targets in test_queries(data, split).items()}


class Errors(unittest.TestCase):
    def assertInvalid(self, code, fn, *args):
        with self.assertRaises(Invalid) as caught:
            fn(*args)
        self.assertEqual(caught.exception.code, code)


class SpecTests(Errors):
    def test_context_must_be_stated_not_defaulted(self):
        data = fixture.dataset()
        task = fixture.spec(data)
        del task["context"]["time"]
        self.assertInvalid("spec_context_fields", validate_spec, task)
        task = fixture.spec(data, **{"context.time": {}})
        self.assertInvalid("context_field_invalid", validate_spec, task)
        task = fixture.spec(data, **{"context.dose": {"status": "unknown"}})
        self.assertInvalid("crispr_dose_must_be_not_applicable", validate_spec, task)
        _, facts = validate_spec(fixture.spec(data))
        self.assertEqual((facts["statuses"]["time"], facts["statuses"]["dose"]), ("unknown", "not_applicable"))

    def test_baselines_and_primary_metric_are_frozen(self):
        data = fixture.dataset()
        self.assertInvalid("spec_baselines_required", validate_spec, fixture.spec(data, baselines=["control", "additive"]))
        self.assertInvalid("spec_evaluation_metric", validate_spec, fixture.spec(data, **{"evaluation.primary": "pearson"}))
        self.assertNotEqual(validate_spec(fixture.spec(data))[0], validate_spec(fixture.spec(data, **{"split.seed": 8}))[0])


class DatasetTests(Errors):
    def test_condition_identity_and_values_are_checked(self):
        data = fixture.dataset()
        data["conditions"][-1]["id"] = "F+E"
        self.assertInvalid("condition_id_not_canonical", validate_dataset, data)
        data = fixture.dataset()
        data["conditions"][3]["mean"][0] = float("nan")
        self.assertInvalid("condition_mean_not_finite", validate_dataset, data)
        data = fixture.dataset()
        data["conditions"].append({**data["conditions"][1], "id": "A+B+C", "targets": ["A", "B", "C"]})
        self.assertInvalid("condition_order_unsupported", validate_dataset, data)


class SplitTests(Errors):
    def set_cells(self, data, cid, cells):
        row = next(c for c in data["conditions"] if c["id"] == cid)
        row["cells"] = row["strata"][0]["cells"] = cells
        row["strata"][0]["guide_counts"] = {"synthetic": cells}

    def test_split_is_deterministic_and_whole_combination(self):
        data, task, split = setup()
        self.assertEqual(split, freeze_split(data, task))
        a = split["assignments"]
        self.assertEqual(len(set(a["train"]) | set(a["validation"]) | set(a["test"])), 6 + 15)
        self.assertTrue(all("+" in cid for cid in a["test"] + a["validation"]))
        self.assertEqual(split["counts"], {"combination_candidates": 15, "combination_train": 6, "combination_validation": 3,
                                           "combination_test": 6, "combination_excluded": 0, "single_train": 6, "single_excluded": 0})
        self.assertEqual(check_split(data, task, split), split["digest"])

    def test_unsupported_combinations_stay_in_the_denominator(self):
        data = fixture.dataset()
        self.set_cells(data, "A", 5)
        self.set_cells(data, "E+F", 5)
        split = freeze_split(data, fixture.spec(data))
        reasons = {e["id"]: e["reason"] for e in split["excluded"]}
        self.assertEqual(reasons, {"A": "low_support", "E+F": "low_support", "A+B": "component_single_missing",
                                   "A+C": "component_single_missing", "A+D": "component_single_missing",
                                   "A+E": "component_single_missing", "A+F": "component_single_missing"})
        self.assertEqual(split["counts"]["combination_excluded"] + split["counts"]["combination_test"]
                         + split["counts"]["combination_train"] + split["counts"]["combination_validation"], 15)

    def test_tampered_or_stale_splits_are_rejected(self):
        data, task, split = setup()
        moved = json.loads(json.dumps(split))
        moved["assignments"]["train"].append(moved["assignments"]["test"][0])
        self.assertInvalid("split_digest_mismatch", check_split, data, task, moved)
        self.assertInvalid("split_overlap", check_split, data, task, sealed(moved))
        self.assertInvalid("split_spec_stale", check_split, data, fixture.spec(data, **{"split.seed": 8}), split)
        dropped = json.loads(json.dumps(split))
        dropped["assignments"]["test"].pop()
        self.assertInvalid("split_denominator_incomplete", check_split, data, task, sealed(dropped))

    def test_split_requires_training_combinations(self):
        data = fixture.dataset()
        task = fixture.spec(data, **{"split.test_fraction": 0.8, "split.validation_fraction": 0.19})
        self.assertInvalid("split_infeasible", freeze_split, data, task)


class ModelTests(Errors):
    def test_training_view_has_no_test_readout(self):
        data, _, split = setup()
        held_out = split["assignments"]["test"][0]
        self.assertInvalid("readout_not_in_view", training_view(data, split).mean, held_out)
        self.assertEqual(evaluation_view(data, split).mean(held_out), tuple(fixture.double_truth(*held_out.split("+"))))

    def test_baselines(self):
        data, _, split = setup()
        view = training_view(data, split)
        queries = test_queries(data, split)
        cid, targets = next(iter(queries.items()))
        additive = {r["id"]: r["mean"] for r in run_baseline("additive", split, view, queries)["conditions"]}
        for got, want in zip(additive[cid], fixture.additive_truth(*targets)):
            self.assertAlmostEqual(got, want)
        train_ids = split["assignments"]["train"]
        mean = run_baseline("train_mean", split, view, queries)["conditions"][0]["mean"]
        self.assertAlmostEqual(mean[0], sum(view.mean(i)[0] for i in train_ids) / len(train_ids))
        self.assertEqual(run_baseline("control", split, view, queries)["conditions"][0]["mean"], list(fixture.CONTROL))


class EvaluationTests(Errors):
    def test_oracle_beats_additive_and_baselines_are_always_present(self):
        data, task, split = setup()
        report = evaluate(data, task, split, [model_doc(split, data, oracle_rows(data, split))])
        by_id = {m["model"]["id"]: m for m in report["models"]}
        self.assertEqual(list(by_id), ["control", "train_mean", "additive", "oracle"])
        self.assertEqual(by_id["additive"]["claim"], "reference")
        self.assertEqual(by_id["oracle"]["claim"], "non_blind")
        self.assertEqual(by_id["oracle"]["metric_status"], "above_threshold")
        self.assertFalse(report["blind"])
        self.assertEqual(by_id["oracle"]["scientific_evidence"]["status"], "insufficient")
        self.assertEqual(by_id["oracle"]["acceptance"]["status"], "not_reviewed")
        self.assertEqual(by_id["oracle"]["skill_vs_reference"]["median"], 1.0)
        self.assertEqual(by_id["oracle"]["residual_pearson"]["median"], 1.0)
        self.assertEqual(by_id["control"]["metric_status"], "below_threshold")
        self.assertEqual(report["split_digest"], split["digest"])
        self.assertEqual(report["digest"], digest({k: v for k, v in report.items() if k != "digest"}))

    def test_missing_predictions_fail_instead_of_disappearing(self):
        data, task, split = setup()
        rows = oracle_rows(data, split)
        rows.pop(sorted(rows)[0])
        oracle = next(m for m in evaluate(data, task, split, [model_doc(split, data, rows)])["models"] if m["model"]["id"] == "oracle")
        self.assertEqual(oracle["denominator"], {"attempted": 6, "evaluated": 5, "failed": 1})
        self.assertEqual(oracle["claim"], "incomplete")

    def test_non_blind_features_cannot_support_a_claim(self):
        data, task, split = setup(**{"features.fitted_on": "all_conditions"})
        report = evaluate(data, task, split, [model_doc(split, data, oracle_rows(data, split))])
        self.assertEqual((report["blind"], report["blind_reasons"]), (False, ["execution_isolation_unverified", "features_fitted_on_all_conditions"]))
        self.assertEqual(report["models"][-1]["claim"], "non_blind")

    def test_misaligned_or_stale_predictions_are_rejected(self):
        data, task, split = setup()
        rows = oracle_rows(data, split)
        swapped = json.loads(json.dumps(model_doc(split, data, rows)))
        swapped["genes"][0], swapped["genes"][1] = swapped["genes"][1], swapped["genes"][0]
        self.assertInvalid("prediction_gene_order_mismatch", evaluate, data, task, split, [sealed(swapped)])
        stale = freeze_split(data, fixture.spec(data, **{"split.seed": 8}))
        self.assertInvalid("prediction_split_stale", evaluate, data, task, split, [model_doc(stale, data, oracle_rows(data, stale))])
        self.assertInvalid("prediction_output_unsupported", evaluate, data, task, split, [model_doc(split, data, rows, output="cell_distribution")])
        self.assertInvalid("evaluation_model_duplicate", evaluate, data, task, split, [model_doc(split, data, rows, "additive")])


class CliTests(unittest.TestCase):
    def test_round_trip_writes_immutable_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = fixture.dataset()
            (root / "dataset.json").write_text(json.dumps(data))
            (root / "spec.json").write_text(json.dumps(fixture.spec(data)))

            def run(*args):
                return subprocess.run([sys.executable, str(CLI), *args, "--dataset", str(root / "dataset.json"),
                                       "--spec", str(root / "spec.json")], capture_output=True, text=True)

            self.assertEqual(run("split", "--out", str(root / "split.json")).returncode, 0)
            again = run("split", "--out", str(root / "split.json"))
            self.assertEqual((again.returncode, json.loads(again.stderr)["error"]), (2, "output_exists"))
            self.assertEqual(run("queries", "--split", str(root / "split.json"), "--out", str(root / "q.json")).returncode, 0)
            queries = json.loads((root / "q.json").read_text())
            self.assertNotIn("mean", json.dumps(queries))
            done = run("evaluate", "--split", str(root / "split.json"), "--out", str(root / "evaluation.json"))
            self.assertEqual(done.returncode, 0, done.stderr)
            report = json.loads((root / "evaluation.json").read_text())
            self.assertEqual([m["model"]["id"] for m in report["models"]], ["control", "train_mean", "additive"])


if __name__ == "__main__":
    unittest.main()
