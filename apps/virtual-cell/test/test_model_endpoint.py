"""Real CPU and loopback endpoint use, separate from biological acceptance."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import Request, urlopen

import fixture
from contract import Invalid, canonical
from local_comparisons import ComparisonHistory
from model_endpoint import AdditiveEndpoint, ModelState
from server import handler
from workbench import Workbench


class ModelEndpointTests(unittest.TestCase):
    def test_model_state_requires_ready_frozen_input_and_observed_use_completion(self):
        initial = ModelState()
        starting = initial.begin("input")
        ready = starting.ready()
        using = ready.use("input")
        self.assertEqual((starting.status, ready.status, using.status, using.uses), ("starting", "ready", "in_use", 1))
        self.assertEqual(using.ready().uses, 1)
        self.assertEqual(ready.stop().status, "stopping")
        for state, action in [(initial, lambda s: s.use("input")),
                              (ready, lambda s: s.use("other")),
                              (using, lambda s: s.stop()),
                              (starting, lambda s: s.begin("input"))]:
            with self.subTest(status=state.status), self.assertRaises(Invalid):
                action(state)

    def service(self, remote_url=None):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        workbench = Workbench(temporary.name)
        history = ComparisonHistory(workbench)
        self.addCleanup(history.close)
        model = AdditiveEndpoint(workbench, remote_url, "test-token")
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler(workbench, "test-token", history, model=model))
        serving = threading.Thread(target=server.serve_forever)
        serving.start()
        self.addCleanup(server.server_close)
        self.addCleanup(serving.join)
        self.addCleanup(server.shutdown)
        base = f"http://127.0.0.1:{server.server_port}"

        def request(path, body=None):
            with urlopen(Request(base + path, data=canonical(body) if body is not None else None,
                                 headers={"X-Pero-App-Token": "test-token"}), timeout=20) as response:
                return json.load(response)
        return base, workbench, history, model, request

    @unittest.skipUnless(sys.platform in ("darwin", "linux"), "Host descendant supervision")
    def test_cpu_endpoint_reuse_comparison_check_export_and_offline_rerun(self):
        _base, workbench, history, model, request = self.service()
        data = fixture.dataset()
        imported = workbench.import_bundle({"dataset": data, "spec": fixture.spec(data)})
        identity = imported["id"]
        self.assertEqual(request("/api/model")["status"], "stopped")
        self.assertEqual(request("/api/task-package")["model"]["weights"], "none")
        self.assertEqual(request("/api/model/start", {"inputId": identity})["status"], "ready")
        for uses in (1, 2):
            run = request("/api/comparisons", {"inputId": identity})
            history.observers[run["id"]].join(timeout=15)
            self.assertFalse(history.observers[run["id"]].is_alive())
            result = request("/api/comparisons/" + run["id"])
            self.assertEqual(result["status"], "succeeded")
            self.assertEqual(request("/api/model")["uses"], uses)
            self.assertEqual(result["modelEndpoint"]["inputId"], identity)
            output = workbench.read(result["outputId"])
            self.assertEqual(output["result"]["models"][-1]["model"]["id"], "additive-endpoint")
            checked = request("/api/comparisons/" + run["id"] + "/check", {})
            self.assertEqual(checked["check"]["status"], "PASS", checked["check"])
        exported = json.loads(request("/api/comparisons/" + run["id"] + "/export")["content"])
        source = workbench.root / "export.json"
        source.write_bytes(canonical(exported))
        destination = workbench.root / "rerun.json"
        process = subprocess.run([sys.executable, str(Path(__file__).parents[1] / "backend/cli.py"),
                                  "compare", "--bundle", str(source), "--out", str(destination)], capture_output=True, text=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(json.loads(destination.read_bytes())["evaluation"], output["result"])
        self.assertEqual(request("/api/model/stop", {})["status"], "stopped")
        with self.assertRaisesRegex(Invalid, "model_endpoint_input_not_ready"):
            model.predict(identity)
        restarted = ComparisonHistory(workbench)
        self.addCleanup(restarted.close)
        self.assertEqual(restarted.read(run["id"])["check"], checked["check"])
        self.assertEqual(AdditiveEndpoint(workbench).read()["status"], "stopped")
        # A selected endpoint cannot silently disappear from a new comparison.
        model.start(identity)
        other_data = fixture.dataset()
        other_data["source"]["revision"] = "another-revision"
        other = workbench.import_bundle({"dataset": other_data, "spec": fixture.spec(other_data)})
        with self.assertRaisesRegex(Invalid, "model_endpoint_input_not_ready"):
            history.start(other["id"])
        self.assertEqual(len(history.runs), 2)

    def test_remote_connection_uses_exact_ready_model_and_never_restarts_remote(self):
        remote_url, remote_workbench, _history, remote_model, _request = self.service()
        _base, local_workbench, _history, local_model, request = self.service(remote_url)
        data = fixture.dataset()
        bundle = {"dataset": data, "spec": fixture.spec(data)}
        identity = local_workbench.import_bundle(bundle)["id"]
        remote_workbench.import_bundle(bundle)
        with self.assertRaisesRegex(Invalid, "remote_model_not_ready"):
            local_model.start(identity)
        self.assertEqual(remote_model.read()["status"], "stopped")
        remote_model.start(identity)
        self.assertEqual(request("/api/model/start", {"inputId": identity})["source"], "remote")
        prediction = request("/api/model/predict", {"inputId": identity})
        self.assertEqual(prediction["split_digest"], local_workbench.comparison_inputs(identity).split["digest"])
        self.assertEqual(remote_model.read()["uses"], 1)
        self.assertEqual(request("/api/model/stop", {})["status"], "stopped")
        self.assertEqual(remote_model.read()["status"], "ready")

    def test_malformed_remote_readiness_reports_failure_and_can_be_unloaded(self):
        class BrokenEndpoint(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"[]")

        server = ThreadingHTTPServer(("127.0.0.1", 0), BrokenEndpoint)
        serving = threading.Thread(target=server.serve_forever)
        serving.start()
        self.addCleanup(server.server_close)
        self.addCleanup(serving.join)
        self.addCleanup(server.shutdown)
        _base, workbench, _history, model, _request = self.service(f"http://127.0.0.1:{server.server_port}")
        data = fixture.dataset()
        identity = workbench.import_bundle({"dataset": data, "spec": fixture.spec(data)})["id"]
        with self.assertRaisesRegex(Invalid, "model_endpoint_response_invalid"):
            model.start(identity)
        self.assertEqual(model.read()["status"], "failed")
        self.assertEqual(model.stop()["status"], "stopped")
