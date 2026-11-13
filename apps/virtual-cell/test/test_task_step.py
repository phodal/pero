"""Real bounded task steps; Host App Use authorization/budget remain external."""
from http.server import ThreadingHTTPServer
import json
import sys
import tempfile
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import fixture
from contract import canonical, digest
from local_comparisons import ComparisonHistory
from model_endpoint import AdditiveEndpoint
from server import handler
from workbench import Workbench


@unittest.skipUnless(sys.platform in ("linux", "darwin"), "CPU comparison needs Host POSIX supervision")
class TaskStepHttpTests(unittest.TestCase):
    def test_steps_use_frozen_inputs_existing_cpu_runner_and_independent_check(self):
        with tempfile.TemporaryDirectory() as directory:
            workbench = Workbench(directory)
            history, model = ComparisonHistory(workbench), AdditiveEndpoint(workbench)
            self.addCleanup(history.close)
            service = ThreadingHTTPServer(("127.0.0.1", 0), handler(workbench, "task-test", history, model=model))
            serving = threading.Thread(target=service.serve_forever)
            serving.start()
            self.addCleanup(service.server_close)
            self.addCleanup(serving.join)
            self.addCleanup(service.shutdown)
            base = f"http://127.0.0.1:{service.server_port}"

            def request(path, document):
                req = Request(base + path, data=canonical(document), headers={"X-Pero-App-Token": "task-test"})
                try:
                    with urlopen(req, timeout=15) as response:
                        return response.status, json.load(response)
                except HTTPError as error:
                    return error.code, json.load(error)

            def step(**command):
                code, result = request("/api/task-step", command)
                self.assertEqual(code, 200, result)
                return result

            initial = step(action="read")
            self.assertEqual(initial["inputs"]["items"], [])
            self.assertEqual(initial["comparisons"]["items"], [])
            self.assertEqual(initial["taskPackage"]["id"], "virtual-cell.comparison")
            self.assertEqual(initial["model"]["status"], "stopped")
            for command in ({"action": "shell", "command": "echo unsafe"}, {"action": "run"},
                            {"action": "read", "path": "/tmp/arbitrary"}, {"action": "read", "runId": None},
                            {"action": "stop-model", "inputId": "a" * 64}, {"action": "run", "inputId": "not-an-id"}):
                with self.subTest(command=command):
                    code, _ = request("/api/task-step", command)
                    self.assertEqual(code, 400)
            self.assertEqual(step(action="read")["comparisons"]["items"], [])
            data = fixture.dataset()
            spec = fixture.spec(data)
            code, imported = request("/api/inputs", {"documents": [canonical({"dataset": data, "spec": spec}).decode()]})
            self.assertEqual(code, 201)
            input_id = imported["id"]
            self.assertEqual(step(action="start-model", inputId=input_id)["model"]["inputId"], input_id)
            run = step(action="run", inputId=input_id)["run"]
            deadline = time.monotonic() + 15
            while not run["process"]["exitObserved"]:
                self.assertLess(time.monotonic(), deadline, "task-step comparison did not finish")
                threading.Event().wait(0.01)
                run = step(action="read", runId=run["id"])["run"]
            self.assertEqual(run["status"], "succeeded")
            self.assertEqual(run["inputId"], input_id)
            self.assertEqual(run["modelEndpoint"]["inputId"], input_id)
            self.assertEqual(run["taskPackage"]["version"], "1.0.0")
            checked = step(action="check", runId=run["id"])["run"]
            self.assertEqual(checked["check"]["status"], "PASS")
            self.assertEqual(checked["check"]["subject"]["inputId"], input_id)
            self.assertEqual(step(action="cancel", runId=run["id"])["run"]["status"], "succeeded")
            frozen = workbench.read(input_id)["bundle"]
            self.assertEqual(frozen["split"]["dataset_digest"], digest(data))
            self.assertEqual(frozen["spec"], spec)
            self.assertEqual(step(action="stop-model")["model"]["status"], "stopped")
            self.assertEqual(len(step(action="read")["comparisons"]["items"]), 1)


if __name__ == "__main__":
    unittest.main()
