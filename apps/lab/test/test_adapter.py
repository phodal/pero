"""Integration tests intentionally require the real pinned PyLabRobot wheel."""
import asyncio
import contextlib
import io
import unittest
from unittest.mock import patch

from domain import Operation, apply_operation, initial_state
from pylabrobot_adapter import AdapterUnavailable, ChatterboxAdapter


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.output = io.StringIO()
        self.capture = contextlib.redirect_stdout(self.output)
        self.capture.__enter__()
        self.adapter = ChatterboxAdapter()

    async def asyncTearDown(self):
        try:
            await self.adapter.stop()
        finally:
            self.capture.__exit__(None, None, None)

    async def test_real_dispatch_and_tracker_evidence(self):
        await self.adapter.setup(initial_state())
        self.assertEqual(len(self.adapter.snapshot()["well_volumes_ul"]), 96)
        self.assertEqual(len(self.adapter.snapshot()["rack_tip_ids"]), 96)
        picked = await self.adapter.execute(Operation("pickup_tip", "T1"))
        self.assertEqual(picked["mounted_tip_id"], "T1")
        self.assertNotIn("T1", picked["rack_tip_ids"])
        aspirated = await self.adapter.execute(Operation("aspirate", "A1", 50))
        self.assertEqual(aspirated["well_volumes_ul"]["A1"], 150)
        self.assertEqual(aspirated["pipette_volume_ul"], 50)
        dispensed = await self.adapter.execute(Operation("dispense", "B1", 50))
        self.assertEqual(dispensed["well_volumes_ul"]["B1"], 50)
        self.assertEqual(dispensed["pipette_volume_ul"], 0)
        returned = await self.adapter.execute(Operation("return_tip", "T1"))
        self.assertIsNone(returned["mounted_tip_id"])
        self.assertIn("T1", returned["rack_tip_ids"])
        self.assertEqual(returned["version"], "0.2.2")
        # This is PLR's actual no-hardware backend output, not a substitute.
        self.assertIn("Aspirating:", self.output.getvalue())
        self.assertIn("Dispensing:", self.output.getvalue())
        await self.adapter.stop()
        with self.assertRaises(RuntimeError):
            self.adapter.snapshot()
        with self.assertRaises(RuntimeError):
            await self.adapter.setup(initial_state())

    async def test_domain_and_real_trackers_agree_after_every_step(self):
        state = initial_state()
        await self.adapter.setup(state)
        steps = (
            Operation("pickup_tip", "T1"), Operation("aspirate", "A1", 40),
            Operation("dispense", "B1", 40), Operation("return_tip", "T1"),
            Operation("pickup_tip", "T2"), Operation("aspirate", "A2", 60),
            Operation("dispense", "B1", 60), Operation("return_tip", "T2"),
        )
        for step in steps:
            predicted = apply_operation(state, step)
            receipt = await self.adapter.execute(step)
            self.assertEqual(receipt["well_volumes_ul"], {w.id: w.volume_ul for w in predicted.wells})
            self.assertEqual(receipt["pipette_volume_ul"], predicted.pipette.volume_ul)
            self.assertEqual(receipt["mounted_tip_id"], predicted.pipette.tip_id)
            state = predicted
        self.assertEqual(state.well("B1").red_fraction, 0.4)
        self.assertNotIn("T1", state.available_tips)
        self.assertIn("T1", receipt["rack_tip_ids"])  # Present does not mean reusable.

    async def test_tracker_failure_invalidates_engine_without_receipt(self):
        await self.adapter.setup(initial_state())
        await self.adapter.execute(Operation("pickup_tip", "T1"))
        before = self.adapter.snapshot()
        with self.assertRaises(Exception):
            await self.adapter.execute(Operation("aspirate", "A1", 250))
        self.assertEqual(before["well_volumes_ul"]["A1"], 200)
        with self.assertRaises(RuntimeError):
            await self.adapter.execute(Operation("aspirate", "A1", 10))
        with self.assertRaises(RuntimeError):
            self.adapter.snapshot()

    async def test_mid_command_cancellation_is_not_success_or_retryable(self):
        await self.adapter.setup(initial_state())
        await self.adapter.execute(Operation("pickup_tip", "T1"))

        async def interrupted(*args, **kwargs):
            raise asyncio.CancelledError()

        # Inject a backend boundary failure into the real PLR frontend.
        with patch.object(self.adapter.lh.backend, "aspirate", interrupted):
            with self.assertRaises(asyncio.CancelledError):
                await self.adapter.execute(Operation("aspirate", "A1", 10))
        with self.assertRaises(RuntimeError):
            self.adapter.snapshot()
        with self.assertRaises(RuntimeError):
            await self.adapter.execute(Operation("aspirate", "A1", 10))

    async def test_wrong_or_missing_engine_has_no_fake_fallback(self):
        with patch("pylabrobot_adapter.version", return_value="0.0.0"):
            with self.assertRaises(AdapterUnavailable):
                await self.adapter.setup(initial_state())
        from importlib.metadata import PackageNotFoundError
        with patch("pylabrobot_adapter.version", side_effect=PackageNotFoundError):
            with self.assertRaises(AdapterUnavailable):
                await self.adapter.setup(initial_state())
        with self.assertRaises(RuntimeError):
            self.adapter.snapshot()


if __name__ == "__main__":
    unittest.main()
