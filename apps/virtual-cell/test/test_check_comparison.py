"""Independent arithmetic receipts over real CPU comparison exports."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest

import fixture
from check_comparison import CHECKER, canonical, check_export, digest
from contract import sealed
from local_comparisons import ComparisonHistory
from workbench import Workbench

CHECK_CLI = Path(__file__).resolve().parents[1] / "backend/check_comparison.py"


@unittest.skipUnless(sys.platform in ("linux", "darwin"), "Comparison child requires Host POSIX supervision")
class ComparisonCheckTests(unittest.TestCase):
    def export(self, data=None, predictions=(), endpoint=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        workbench = Workbench(temporary.name)
        history = ComparisonHistory(workbench)
        self.addCleanup(history.close)
        data = data or fixture.dataset()
        imported = workbench.import_bundle({"dataset": data, "spec": fixture.spec(data), "predictions": list(predictions)})
        if endpoint:
            from model_endpoint import AdditiveEndpoint
            history.model = AdditiveEndpoint(workbench)
            history.model.start(imported["id"])
        run = history.start(imported["id"])
        deadline = time.monotonic() + 15
        while not history.read(run["id"])["process"]["exitObserved"]:
            self.assertLess(time.monotonic(), deadline, "comparison child did not finish")
            threading.Event().wait(0.01)
        self.assertEqual(history.read(run["id"])["status"], "succeeded")
        return json.loads(history.export(run["id"])["content"])

    def rebind_output(self, document):
        document["output"]["result"] = sealed(document["output"]["result"])
        document["run"]["outputId"] = hashlib.sha256(canonical(document["output"])).hexdigest()

    def test_cpu_export_and_standalone_check_retain_a_sealed_bounded_claim(self):
        document = self.export()
        receipt = check_export(document)
        self.assertEqual(receipt["status"], "PASS", receipt)
        self.assertEqual(receipt["checker"], CHECKER)
        self.assertEqual(receipt["checkedMetrics"], ["delta_mse"])
        self.assertEqual(receipt["scope"], "numerical_consistency")
        self.assertTrue(receipt["limitations"])
        self.assertEqual(receipt["subject"]["outputId"], document["run"]["outputId"])
        self.assertEqual(receipt["digest"], digest({key: value for key, value in receipt.items() if key != "digest"}))
        self.assertEqual(check_export(document), receipt)
        document["run"]["check"] = {"artifactId": "saved-check", "receipt": receipt}
        self.assertEqual(check_export(document), receipt)
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory) / "export.json", Path(directory) / "check.json"
            source.write_bytes(canonical(document))
            completed = subprocess.run([sys.executable, str(CHECK_CLI), "--export", str(source), "--out", str(target)],
                                       capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(json.loads(target.read_bytes()), receipt)

    def test_resealed_metrics_predictions_and_denominators_cannot_hide_arithmetic_changes(self):
        original = self.export()
        cases = []
        changed_metric = copy.deepcopy(original)
        changed_metric["output"]["result"]["models"][0]["conditions"][0]["delta_mse"] += 1
        self.rebind_output(changed_metric)
        cases.append(("metric", changed_metric, "delta_mse"))
        changed_prediction = copy.deepcopy(original)
        prediction = changed_prediction["output"]["predictions"][0]
        prediction["conditions"][0]["mean"][0] += 1
        prediction = sealed(prediction)
        changed_prediction["output"]["predictions"][0] = prediction
        changed_prediction["output"]["result"]["models"][0]["predictions_digest"] = prediction["digest"]
        self.rebind_output(changed_prediction)
        cases.append(("prediction", changed_prediction, "delta_mse"))
        changed_summary = copy.deepcopy(original)
        changed_summary["output"]["result"]["models"][0]["delta_mse"]["median"] += 1
        self.rebind_output(changed_summary)
        cases.append(("summary", changed_summary, "delta_mse_summary"))
        changed_denominator = copy.deepcopy(original)
        changed_denominator["output"]["result"]["models"][0]["denominator"]["attempted"] -= 1
        self.rebind_output(changed_denominator)
        cases.append(("denominator", changed_denominator, "denominators"))
        unbound_output = copy.deepcopy(original)
        unbound_output["output"]["result"]["models"][0]["conditions"][0]["delta_mse"] += 1
        cases.append(("unbound", unbound_output, "artifact_bindings"))
        for label, document, reason in cases:
            with self.subTest(label=label):
                receipt = check_export(document)
                self.assertEqual(receipt["status"], "FAIL", receipt)
                self.assertEqual(receipt["checks"][-1]["id"], reason)

    def test_equal_batch_estimand_is_preserved_with_unequal_cell_counts(self):
        data = fixture.dataset()
        for condition in data["conditions"]:
            cells = condition["cells"]
            low, high = [value - 0.2 for value in condition["mean"]], [value + 0.2 for value in condition["mean"]]
            first, second = cells // 5, cells - cells // 5
            condition["strata"] = [
                {"batch": "first", "cells": first, "mean": low, "guide_counts": {"synthetic": first}},
                {"batch": "second", "cells": second, "mean": high, "guide_counts": {"synthetic": second}},
            ]
            condition["pooled_mean"] = [(a * first + b * second) / cells for a, b in zip(low, high)]
        document = self.export(data)
        self.assertNotEqual(data["conditions"][0]["mean"], data["conditions"][0]["pooled_mean"])
        self.assertEqual(check_export(document)["status"], "PASS")

    def test_submitted_predictions_retain_failed_conditions_in_the_denominator(self):
        original = self.export()
        submitted = copy.deepcopy(original["output"]["predictions"][0])
        submitted["model"] = {"id": "external", "kind": "submission", "version": "test-v1"}
        submitted["conditions"] = []
        document = self.export(predictions=[sealed(submitted)])
        model = next(item for item in document["output"]["result"]["models"] if item["model"]["id"] == "external")
        self.assertGreater(model["denominator"]["failed"], 0)
        self.assertEqual(model["delta_mse"], {"n": 0, "median": None, "mean": None})
        self.assertEqual(check_export(document)["status"], "PASS")
        model["denominator"]["failed"] = 0
        self.rebind_output(document)
        self.assertEqual(check_export(document)["checks"][-1]["id"], "denominators")

    def test_endpoint_provenance_binds_its_input_model_and_prediction(self):
        original = self.export(endpoint=True)
        self.assertEqual(check_export(original)["status"], "PASS")
        for field, value in (("inputId", "different-input"), ("predictionDigest", "sha256:" + "0" * 64),
                             ("model", {"id": "additive-endpoint", "version": "different-version"})):
            with self.subTest(field=field):
                document = copy.deepcopy(original)
                document["run"]["modelEndpoint"][field] = value
                receipt = check_export(document)
                self.assertEqual(receipt["status"], "FAIL")
                self.assertEqual(receipt["checks"][-1]["id"], "model_endpoint_binding")

    def test_unsupported_or_incomplete_exports_produce_failure_receipts(self):
        for document in (None, {}, {"schema": "unknown"}, {"schema": "pero.virtual-cell.local-comparison-export.v1"}):
            with self.subTest(document=document):
                self.assertEqual(check_export(document)["status"], "FAIL")
        document = self.export()
        document["run"]["process"]["exitObserved"] = False
        self.assertEqual(check_export(document)["checks"][-1]["id"], "execution_evidence")


if __name__ == "__main__":
    unittest.main()
