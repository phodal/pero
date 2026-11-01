"""The ONLY execution backend: pinned PyLabRobot Chatterbox; never hardware.

Expected mixture state comes from domain.advance. Actual PLR volume/tip trackers
are checked after every command; a mismatch produces an unknown outcome, never PASS.
"""
import asyncio
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from domain import LabError, LabState, Step, WELLS

PIN = "0.2.1"


def capability() -> dict:
    try:
        observed = version("pylabrobot")
        if observed != PIN:
            raise RuntimeError(f"Expected pylabrobot=={PIN}; found {observed}")
        from pylabrobot.liquid_handling import LiquidHandler  # noqa: F401
        from pylabrobot.liquid_handling.backends.chatterbox import LiquidHandlerChatterboxBackend  # noqa: F401
        from pylabrobot.resources import Cor_96_wellplate_360ul_Fb, hamilton_96_tiprack_300uL_filter  # noqa: F401
        return {"available": True, "engine": "PyLabRobot", "version": observed,
                "backend": "LiquidHandlerChatterboxBackend", "mode": "simulation"}
    except (PackageNotFoundError, ImportError, RuntimeError) as exc:
        return {"available": False, "engine": "PyLabRobot", "required": PIN,
                "mode": "simulation", "error": str(exc)}


@dataclass(frozen=True)
class Receipt:
    volumes_ul: tuple[float, ...]
    pipette_ul: float
    has_tip: bool

    def reconcile(self, expected: LabState):
        if self.has_tip != (expected.tip is not None) or abs(self.pipette_ul - expected.pipette.volume_ul) > 1e-6:
            raise LabError("PyLabRobot pipette state differs from the predicted state")
        if any(abs(actual - well.volume_ul) > 1e-6 for actual, well in zip(self.volumes_ul, expected.wells)):
            raise LabError("PyLabRobot well state differs from the predicted state")


class PyLabRobotRun:
    def __init__(self):
        state = capability()
        if not state["available"]:
            raise LabError(f"PyLabRobot unavailable: {state['error']}")
        self.identity = state
        self.lh = None

    async def setup(self, state: LabState):
        from pylabrobot.liquid_handling import LiquidHandler
        from pylabrobot.liquid_handling.backends.chatterbox import LiquidHandlerChatterboxBackend
        from pylabrobot.resources import (Coordinate, Deck, Cor_96_wellplate_360ul_Fb,
                                         hamilton_96_tiprack_300uL_filter,
                                         set_tip_tracking, set_volume_tracking)
        set_tip_tracking(True)
        set_volume_tracking(True)
        deck = Deck(name="lab", size_x=400, size_y=300, size_z=200)
        self.plate = Cor_96_wellplate_360ul_Fb("plate")
        self.tips = hamilton_96_tiprack_300uL_filter("tips")
        deck.assign_child_resource(self.plate, location=Coordinate(0, 0, 0))
        deck.assign_child_resource(self.tips, location=Coordinate(150, 0, 0))
        for name, well in zip(WELLS, state.wells):
            self.plate[name][0].tracker.set_liquids([(None, well.volume_ul)] if well.volume_ul else [])
        self.lh = LiquidHandler(backend=LiquidHandlerChatterboxBackend(num_channels=1), deck=deck)
        await asyncio.wait_for(self.lh.setup(), timeout=5)
        self.receipt().reconcile(state)

    def receipt(self) -> Receipt:
        assert self.lh is not None
        head = self.lh.head[0]
        has_tip = head.has_tip
        volume = head.get_tip().tracker.get_used_volume() if has_tip else 0.0
        return Receipt(tuple(self.plate[name][0].tracker.get_used_volume() for name in WELLS),
                       volume, has_tip)

    async def apply(self, step: Step, expected: LabState) -> Receipt:
        assert self.lh is not None
        if step.action == "pick_up_tip":
            command = self.lh.pick_up_tips(self.tips[step.resource], use_channels=[0])
        elif step.action == "return_tip":
            command = self.lh.return_tips()
        elif step.action == "aspirate":
            command = self.lh.aspirate(self.plate[step.resource], vols=[step.volume_ul], use_channels=[0])
        else:
            command = self.lh.dispense(self.plate[step.resource], vols=[step.volume_ul], use_channels=[0])
        await asyncio.wait_for(command, timeout=5)
        receipt = self.receipt()
        receipt.reconcile(expected)
        return receipt

    async def stop(self):
        if self.lh is not None:
            await asyncio.wait_for(self.lh.stop(), timeout=5)
