"""Local comparison lifecycle; fixtures are synthetic, not Norman acceptance."""
from http.server import ThreadingHTTPServer
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen

import fixture
from baselines import run_baseline
from comparison import ComparisonRun
from contract import Invalid, canonical, sealed
from dataset import training_view
from evaluation import test_queries
from local_comparisons import ComparisonHistory, LOG_BYTES
from server import handler
from split import freeze_split
from workbench import Workbench

CLI = Path(__file__).resolve().parents[1] / "backend/cli.py"


def wait_until(observe, timeout=15):
    deadline = time.monotonic() + timeout
    while True:
        value = observe()
        if value:
            return value
        if time.monotonic() >= deadline:
            raise AssertionError("observable comparison condition timed out")
        threading.Event().wait(0.01)


class ComparisonStateTests(unittest.TestCase):
    def test_only_observed_exit_and_complete_output_can_finish_a_run(self):
        initial = ComparisonRun("a" * 32, "b" * 64, "2026-01-01T00:00:00Z")
        running = initial.started(42, "2026-01-01T00:00:01Z")
        cancelling = running.request_cancel().termination_sent("terminate")
        cases = [
            (running, 0, "output", False, "succeeded"),
            (running, 0, None, False, "failed"),
            (running, 2, None, False, "failed"),
            (cancelling, 0, "output", False, "succeeded"),
            (cancelling, 2, None, False, "failed"),
            (cancelling, -15, None, True, "cancelled"),
            (running, -15, None, True, "failed"),
        ]
        for before, code, output, terminated, status in cases:
            with self.subTest(before=before.status, code=code, status=status):
                after = before.exited(code, "2026-01-01T00:00:02Z", output, terminated=terminated)
                self.assertEqual(after.status, status)
                self.assertTrue(after.exit_observed)
                self.assertEqual(after.exit_code, code)
                self.assertEqual(after.request_cancel(), after)
        for before in (initial, running, cancelling):
            interrupted = before.interrupted("2026-01-01T00:00:03Z")
            self.assertEqual(interrupted.status, "interrupted")
            self.assertFalse(interrupted.exit_observed)
            self.assertIsNone(interrupted.output_id)


@unittest.skipUnless(sys.platform in ("linux", "darwin"), "CPU comparisons require Host POSIX descendant supervision")
class ComparisonProcessTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.workbench = Workbench(temporary.name)
        self.history = ComparisonHistory(self.workbench)
        self.addCleanup(self.history.close)
        data = fixture.dataset()
        spec = fixture.spec(data)
        self.bundle = {"dataset": data, "spec": spec, "split": freeze_split(data, spec)}

    def completed(self, identity):
        return wait_until(lambda: (run if (run := self.history.read(identity))["process"]["exitObserved"] else None))

    def test_real_http_repeated_runs_export_and_independent_recompute(self):
        service = ThreadingHTTPServer(("127.0.0.1", 0), handler(self.workbench, "local-test", self.history))
        serving = threading.Thread(target=service.serve_forever)
        serving.start()
        self.addCleanup(service.server_close)
        self.addCleanup(serving.join)
        self.addCleanup(service.shutdown)
        base = f"http://127.0.0.1:{service.server_port}"

        def request(path, body=None):
            with urlopen(Request(base + path, data=canonical(body) if body is not None else None,
                                 headers={"X-Pero-App-Token": "local-test"})) as response:
                return json.load(response)

        imported = request("/api/inputs", {"documents": [canonical(self.bundle).decode()]})
        runs = []
        for _ in range(2):
            run = request("/api/comparisons", {"inputId": imported["id"]})
            self.completed(run["id"])
            runs.append(request("/api/comparisons/" + run["id"]))
        first, second = runs
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(first["outputId"], second["outputId"])
        for run in runs:
            self.assertEqual(run["status"], "succeeded")
            self.assertEqual(run["process"]["exitCode"], 0)
            self.assertIn("Computed additive:", run["logs"])
        items = request("/api/comparisons")["items"]
        self.assertEqual(len(items), 2)
        self.assertTrue(all("logs" not in item for item in items))
        output = request("/api/artifacts/" + first["outputId"])
        self.assertEqual([p["model"]["id"] for p in output["predictions"]], ["control", "train_mean", "additive"])
        for prediction, model in zip(output["predictions"], output["result"]["models"]):
            self.assertEqual(prediction["digest"], model["predictions_digest"])
        self.assertFalse(output["result"]["blind"])
        self.assertEqual(output["result"]["isolation"], "unverified")
        self.assertEqual(output["acceptance"], "not_reviewed")
        self.assertEqual(request("/api/comparisons/" + first["id"] + "/cancel", {})["status"], "succeeded")
        export = request("/api/comparisons/" + first["id"] + "/export")
        source = self.workbench.root / "export.json"
        source.write_text(export["content"])
        destination = self.workbench.root / "recomputed.json"
        process = subprocess.run([sys.executable, str(CLI), "compare", "--bundle", str(source), "--out", str(destination)], capture_output=True, text=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        recomputed = json.loads(destination.read_bytes())
        self.assertEqual(recomputed["evaluation"], output["result"])
        self.assertEqual(recomputed["predictions"], output["predictions"])
        reopened = ComparisonHistory(Workbench(self.workbench.root))
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.read(first["id"]), first)
        self.assertEqual(reopened.processes, {})

    def test_method_rejection_retains_actual_nonzero_exit_and_logs(self):
        b = self.bundle
        prediction = run_baseline("additive", b["split"], training_view(b["dataset"], b["split"]), test_queries(b["dataset"], b["split"]))
        prediction["model"]["id"] = "external"
        prediction["genes"].reverse()
        b["predictions"] = [sealed(prediction)]
        imported = self.workbench.import_bundle(b)
        run = self.history.start(imported["id"])
        result = self.completed(run["id"])
        self.assertEqual((result["status"], result["process"]["exitCode"]), ("failed", 2))
        self.assertEqual(result["error"], "prediction_gene_order_mismatch")
        self.assertIn("prediction_gene_order_mismatch", result["logs"])
        self.assertIsNone(result["outputId"])
        exported = json.loads(self.history.export(run["id"])["content"])
        self.assertIsNone(exported["output"])
        self.assertEqual(exported["bundle"]["predictions"], b["predictions"])

    def test_content_hash_does_not_admit_scientifically_invalid_disk_inputs(self):
        reordered = copy.deepcopy(self.bundle)
        reordered["dataset"]["genes"].reverse()
        unsupported_scale = copy.deepcopy(self.bundle)
        unsupported_scale["dataset"]["scale"] = "unsupported"
        false_blind = copy.deepcopy(self.bundle)
        false_blind["split"] = sealed({**false_blind["split"], "blind": True})
        for bundle, code in [(reordered, "split_dataset_stale"),
                             (unsupported_scale, "dataset_scale"),
                             (false_blind, "split_blind_mismatch")]:
            with self.subTest(code=code):
                identity = self.workbench.put({"kind": "inputs", "bundle": bundle})
                with self.assertRaisesRegex(Invalid, code):
                    self.workbench.execute(identity, "evaluate")
                with self.assertRaisesRegex(Invalid, code):
                    self.history.start(identity)
        self.assertEqual(self.history.catalog()["items"], [])

    def test_unsupported_host_platform_refuses_to_spawn_but_retains_history_access(self):
        imported = self.workbench.import_bundle(self.bundle)
        with patch("local_comparisons.sys.platform", "win32"):
            unsupported = ComparisonHistory(self.workbench)
        self.addCleanup(unsupported.close)
        self.assertEqual(unsupported.catalog(), {"items": [], "availability": {
            "available": False, "reason": "comparison_platform_unsupported"}})
        with self.assertRaisesRegex(Invalid, "comparison_platform_unsupported"):
            unsupported.start(imported["id"])
        self.assertEqual(unsupported.processes, {})

    def test_cancel_reaps_a_real_computation_before_publishing_cancelled(self):
        data = self.bundle["dataset"]
        width = 9000
        data["genes"] += [f"extra-{i}" for i in range(width - len(data["genes"]))]
        for condition in data["conditions"]:
            for row, key in [(condition, "mean"), (condition, "pooled_mean"), (condition["strata"][0], "mean")]:
                row[key] = (row[key] * (width // len(row[key]) + 1))[:width]
        imported = self.workbench.import_bundle({"dataset": data, "spec": fixture.spec(data)})
        run = self.history.start(imported["id"])
        process = self.history.processes[run["id"]]
        wait_until(lambda: "Starting CPU comparison" in self.history.read(run["id"])["logs"])
        with self.assertRaisesRegex(Invalid, "comparison_already_running"):
            self.history.start(imported["id"])
        stopped = self.history.cancel(run["id"])
        self.assertEqual(stopped["status"], "cancelled")
        self.assertTrue(stopped["process"]["exitObserved"])
        self.assertIsNotNone(process.returncode)
        self.assertNotEqual(process.returncode, 0)
        self.assertIsNone(stopped["outputId"])
        self.assertEqual(self.history.processes, {})

    def test_restart_never_trusts_unconfirmed_output_or_replays_and_logs_are_bounded(self):
        imported = self.workbench.import_bundle(self.bundle)
        finished = self.completed(self.history.start(imported["id"])["id"])
        path = self.history.root / finished["id"] / "run.json"
        unconfirmed = {**finished, "status": "running", "finishedAt": None,
                       "process": {**finished["process"], "exitObserved": False, "exitCode": None}}
        path.write_bytes(canonical(unconfirmed))
        (path.parent / "process.log").write_text("x" * (LOG_BYTES + 10))
        reopened = ComparisonHistory(Workbench(self.workbench.root))
        self.addCleanup(reopened.close)
        result = reopened.read(finished["id"])
        self.assertEqual(result["status"], "interrupted")
        self.assertFalse(result["process"]["exitObserved"])
        self.assertIsNone(result["outputId"])
        self.assertTrue(result["logsTruncated"])
        self.assertEqual(len(result["logs"]), LOG_BYTES)
        self.assertEqual(reopened.processes, {})
