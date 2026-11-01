"""Deterministic domain/API tests; fixture receipts are never real PLR evidence."""
import asyncio
import base64
from dataclasses import asdict
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from domain import (LabError, Policy, WELLS, advance, digest, example_steps,
                    initial_state, protocol, validate)
from evaluation import import_observation
from experiments import Experiments
from pylabrobot_adapter import Receipt
from server import agent_step, handler
from http.server import ThreadingHTTPServer

SPEC = {"objective": "Match a virtual dye target", "target_fraction": 0.5,
        "tolerance": 0.03, "trial_budget": 8}


class FixtureRun:
    """The single test-only executor seam. NOT a PyLabRobot integration test."""
    identity = {"engine": "test-fixture", "mode": "simulation"}
    calls = 0

    async def setup(self, _state):
        pass

    async def apply(self, _step, expected):
        self.calls += 1
        return Receipt(tuple(w.volume_ul for w in expected.wells),
                       expected.pipette.volume_ul, expected.tip is not None)

    async def stop(self):
        pass


class DomainTests(unittest.TestCase):
    def setUp(self):
        self.policy = Policy.parse(SPEC)

    def test_golden_mass_balance_and_fraction(self):
        trace = validate(initial_state(), protocol(example_steps(), self.policy), self.policy)
        result = trace[-1]
        self.assertAlmostEqual(result.wells[WELLS.index("B1")].fraction, 0.45)
        self.assertEqual(sum(w.volume_ul for w in result.wells), 600)
        self.assertEqual(sum(w.dye_ul for w in result.wells), 300)
        self.assertIsNone(result.tip)
        self.assertEqual(result.used_tips, ("A1", "A2"))
        again = validate(initial_state(), protocol(example_steps(), self.policy), self.policy)[-1]
        self.assertEqual(digest(result.snapshot()), digest(again.snapshot()))

    def test_invalid_protocols_are_localized_without_mutating_input(self):
        cases = {
            "negative": [{"action": "aspirate", "resource": "A1", "volume_ul": -1}],
            "zero": [{"action": "dispense", "resource": "B1", "volume_ul": 0}],
            "nonfinite": [{"action": "aspirate", "resource": "A1", "volume_ul": float("nan")}],
            "invalid well": [{"action": "pick_up_tip", "resource": "Z99"}],
            "no tip": [{"action": "aspirate", "resource": "A1", "volume_ul": 10}],
            "depletion": [{"action": "pick_up_tip", "resource": "A1"},
                           {"action": "aspirate", "resource": "B1", "volume_ul": 10}],
            "capacity": [{"action": "pick_up_tip", "resource": "A1"},
                         {"action": "aspirate", "resource": "A1", "volume_ul": 301}],
            "well capacity": [{"action": "pick_up_tip", "resource": "A1"},
                              {"action": "aspirate", "resource": "A2", "volume_ul": 100},
                              {"action": "dispense", "resource": "A1", "volume_ul": 100}],
            "reuse": example_steps() + [{"action": "pick_up_tip", "resource": "A1"}],
            "occupied": [{"action": "pick_up_tip", "resource": "A1"},
                         {"action": "pick_up_tip", "resource": "A2"}],
            "spill": [{"action": "pick_up_tip", "resource": "A1"},
                      {"action": "aspirate", "resource": "A1", "volume_ul": 10},
                      {"action": "return_tip"}],
            "unreturned": example_steps()[:-1],
            "unknown action": [{"action": "execute_python", "code": "pass"}],
            "extra fields": [{"action": "return_tip", "backend": "hardware"}],
            "bool amount": [{"action": "aspirate", "resource": "A1", "volume_ul": True}],
        }
        for label, steps in cases.items():
            with self.subTest(label=label):
                initial = initial_state()
                before = digest(initial.snapshot())
                with self.assertRaises(LabError) as error:
                    validate(initial, protocol(steps, self.policy), self.policy)
                self.assertIsNotNone(error.exception.step)
                self.assertEqual(before, digest(initial.snapshot()))

    def test_frozen_policy_rejects_hidden_fields(self):
        for extra in ({"mode": "hardware"}, {"trial_budget": True}, {"target_fraction": float("inf")}):
            with self.subTest(extra=extra), self.assertRaises(LabError):
                Policy.parse({**SPEC, **extra})

    def test_invalid_observation_files(self):
        samples = [
            ("bad.csv", "well,value,unit\nB1,nan,fraction\n"),
            ("bad.csv", "well,value,unit\nB1,.5,absorbance\n"),
            ("bad.csv", "well,value,unit\nB1,.5,fraction\nB1,.6,fraction\n"),
            ("bad.json", '[{"well":"B1","value":true,"unit":"fraction"}]'),
            ("bad.json", '[{"well":"B1","value":0.5,"unit":"fraction","origin":"device"}]'),
            ("bad.json", '[{"well":"A0","value":0.5,"unit":"fraction"}]'),
        ]
        for filename, content in samples:
            with self.subTest(content=content), self.assertRaises(LabError):
                import_observation(filename, base64.b64encode(content.encode()).decode())
        raw = b"well,value,unit\r\nB1,0.5,fraction\r\n"
        observation = import_observation("measurement.csv", base64.b64encode(raw).decode())
        self.assertEqual(base64.b64decode(observation.original_base64), raw)
        self.assertEqual(observation.origin, "imported")


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.runs = []
        def runner():
            instance = FixtureRun()
            self.runs.append(instance)
            return instance
        self.store = Experiments(self.home.name, runner_factory=runner)
        self.experiment = self.store.create(SPEC)
        self.eid = self.experiment["id"]

    def tearDown(self):
        self.store.close()
        self.home.cleanup()

    def proposal(self, dye=90.0, parent=None):
        return self.store.propose(self.eid, {"input_hash": self.experiment["input_hash"],
            "steps": example_steps(dye), "reason": f"Test dye allocation {dye}", "parent_id": parent})

    def complete(self, dye=90.0, parent=None):
        record = self.proposal(dye, parent)
        trial_id = record["trials"][-1]["id"]
        self.store.simulate(self.eid, trial_id)
        self.store.worker.join(timeout=5)
        self.assertFalse(self.store.worker.is_alive())
        self.assertEqual(self.store.read(self.eid)["trials"][-1]["status"], "completed")
        return trial_id

    def test_two_trial_loop_and_restart(self):
        first = self.complete()
        self.store.observe(self.eid, first)
        record = self.store.evaluate(self.eid, first)
        self.assertEqual(record["trials"][0]["verification"]["status"], "FAIL")
        second = self.complete(100 / 0.9, first)
        self.store.observe(self.eid, second)
        record = self.store.evaluate(self.eid, second)
        self.assertEqual(record["trials"][1]["verification"]["status"], "PASS")
        self.assertLess(record["trials"][1]["verification"]["absolute_error"],
                        record["trials"][0]["verification"]["absolute_error"])
        self.store.review(self.eid, second, {"decision": "accepted", "note": "Fixture review only"})
        saved = self.store.read(self.eid)
        self.assertEqual(saved, Experiments(self.home.name).read(self.eid))
        self.assertEqual(saved["trials"][1]["engine"]["engine"], "test-fixture")

    def test_repeat_start_and_proposal_do_not_repeat_effects(self):
        record = self.proposal()
        self.assertEqual(record, self.proposal())
        tid = self.complete()
        before = self.store.read(self.eid)
        after = self.store.simulate(self.eid, tid)
        self.assertEqual(before, after)
        self.assertEqual(sum(r.calls for r in self.runs), 8)

    def test_budget_and_frozen_hash(self):
        for dye in range(80, 88):
            self.proposal(dye)
        with self.assertRaisesRegex(LabError, "budget"):
            self.proposal(88)
        with self.assertRaisesRegex(LabError, "mismatch"):
            self.store.propose(self.eid, {"input_hash": "stale", "steps": example_steps(),
                                         "reason": "stale proposal", "parent_id": None})

    def test_missing_measurement_is_inconclusive_and_not_accepted(self):
        tid = self.complete()
        result = self.store.evaluate(self.eid, tid)["trials"][0]["verification"]
        self.assertEqual(result["status"], "INCONCLUSIVE")
        with self.assertRaises(LabError):
            self.store.review(self.eid, tid, {"decision": "accepted", "note": "not enough evidence"})

    def test_import_is_immutable_and_not_synthetic(self):
        tid = self.complete()
        payload = {"filename": "reading.csv", "content_base64": base64.b64encode(
            b"well,value,unit\nB1,0.5,fraction\n").decode()}
        self.store.observe(self.eid, tid, payload)
        record = self.store.evaluate(self.eid, tid)
        self.assertEqual(record["trials"][0]["verification"]["origin"], "imported")
        with self.assertRaises(LabError):
            self.store.observe(self.eid, tid)

    def test_corrupt_frozen_input_is_not_executed(self):
        record = self.store.read(self.eid)
        record["policy"]["tolerance"] = 1
        self.store._save(record)
        with self.assertRaisesRegex(LabError, "corrupt"):
            self.store.read(self.eid)

    def test_interrupted_attempt_is_unknown_and_not_replayed(self):
        record = self.proposal()
        record["trials"][0]["status"] = "running"
        self.store._save(record)
        recovered = Experiments(self.home.name)
        self.assertEqual(recovered.read(self.eid)["trials"][0]["status"], "unknown")
        with self.assertRaisesRegex(LabError, "replayed"):
            recovered.simulate(self.eid, record["trials"][0]["id"])

    def test_no_effect_when_persistence_fails(self):
        record = self.proposal()
        with patch.object(self.store, "_save", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.store.simulate(self.eid, record["trials"][0]["id"])
        self.assertEqual(sum(r.calls for r in self.runs), 0)
        self.assertEqual(self.store.read(self.eid)["trials"][0]["status"], "proposed")

    def test_cancel_retains_confirmed_prefix(self):
        entered, release = threading.Event(), threading.Event()
        class PausedRun(FixtureRun):
            async def apply(self, step, expected):
                entered.set()
                await asyncio.to_thread(release.wait)
                return await super().apply(step, expected)
        self.store.runner_factory = PausedRun
        trial = self.proposal()["trials"][0]
        self.store.simulate(self.eid, trial["id"])
        try:
            self.assertTrue(entered.wait(timeout=3))
            self.store.cancel(self.eid, trial["id"])
        finally:
            release.set()
        self.store.worker.join(timeout=5)
        final = self.store.read(self.eid)["trials"][0]
        self.assertEqual(final["status"], "cancelled")
        self.assertEqual(len([e for e in final["events"] if e["status"] == "confirmed"]), 1)

    def test_agent_actions_reject_verdict_and_hardware_injection(self):
        for payload in ({"action": "execute_hardware"}, {"action": "review"},
                        {"action": "read", "experiment_id": self.eid, "status": "PASS"}):
            with self.subTest(payload=payload), self.assertRaises(LabError):
                agent_step(self.store, payload)


class HTTPTests(unittest.TestCase):
    def test_authenticated_protocol_roundtrip(self):
        with tempfile.TemporaryDirectory() as root:
            store = Experiments(root, runner_factory=FixtureRun)
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler(store, "test-token"))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            def request(method, path, payload=None, token="test-token"):
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                connection.request(method, path, None if payload is None else json.dumps(payload),
                                   {"X-Pero-App-Token": token, "Content-Type": "application/json"})
                response = connection.getresponse()
                result = response.status, json.loads(response.read())
                connection.close()
                return result
            try:
                self.assertEqual(request("GET", "/api/experiments", token="wrong")[0], 401)
                status, record = request("POST", "/api/experiments", SPEC)
                self.assertEqual(status, 200)
                action = {"action": "propose", "experiment_id": record["id"],
                          "input_hash": record["input_hash"], "steps": example_steps(),
                          "parent_id": None, "reason": "API fixture"}
                status, record = request("POST", "/api/agent-step", action)
                self.assertEqual(status, 200)
                trial_id = record["trials"][0]["id"]
                def step(action):
                    return request("POST", "/api/agent-step", {"action": action,
                        "experiment_id": record["id"], "trial_id": trial_id})
                self.assertEqual(step("simulate")[0], 200)
                store.worker.join(timeout=5)
                self.assertEqual(step("synthetic")[0], 200)
                self.assertEqual(step("evaluate")[1]["trials"][0]["verification"]["status"], "FAIL")
                self.assertEqual(request("GET", f"/api/export/{record['id']}")[0], 200)
                self.assertEqual(request("POST", "/api/agent-step", {"action": "execute_hardware"})[0], 400)
                self.assertEqual(request("GET", "/api/experiments/../../etc/passwd")[0], 400)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)
                store.close()


if __name__ == "__main__":
    unittest.main()
