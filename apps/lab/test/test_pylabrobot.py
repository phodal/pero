"""Real pinned library gate. Missing library is a FAILURE in acceptance CI."""
import asyncio
import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from domain import Policy, initial_state, example_steps, protocol, validate
from pylabrobot_adapter import PyLabRobotRun, capability


class PyLabRobotTests(unittest.TestCase):
    def test_real_chatterbox_tracker_roundtrip(self):
        available = capability()
        if not available["available"]:
            if os.environ.get("LAB_REQUIRE_PYLABROBOT") == "1":
                self.fail(str(available))
            self.skipTest(f"Real dependency unavailable (not acceptance): {available}")
        policy = Policy.parse({"objective": "Real library test", "target_fraction": 0.5,
                               "tolerance": 0.03, "trial_budget": 2})
        steps = protocol(example_steps(), policy)
        expected = validate(initial_state(), steps, policy)
        async def run():
            runner = PyLabRobotRun()
            try:
                await runner.setup(initial_state())
                for step, state in zip(steps, expected):
                    actual = await runner.apply(step, state)
                    actual.reconcile(state)
                self.assertFalse(actual.has_tip)
                self.assertAlmostEqual(sum(actual.volumes_ul), 600)
            finally:
                await runner.stop()
        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
