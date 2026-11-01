"""Actual PyLabRobot 0.2.2 dispatch, strictly without a hardware backend.

The domain owns canonical transitions and illustrative color. This adapter owns
only the disposable PLR resource graph and reports its tracked volumes. The
coordinator compares successful receipts before committing the domain result.
Never reuse an adapter after a failed command or reconstruct it to resume a run.
"""
from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from domain import LabState, Operation

PINNED_VERSION = "0.2.2"


class AdapterUnavailable(RuntimeError):
    """The real, pinned simulation engine is not available."""


class ChatterboxAdapter:
    """One single-channel software run. Call setup and stop asynchronously.

    PLR tracking switches are process-global: the coordinator must serialize
    runs. Cancellation is observed between commands, not by canceling PLR's
    coroutine, whose pending trackers are not a durable execution receipt.
    """

    def __init__(self):
        self.lh = None
        self.wells = {}
        self.tip_spots = {}
        self._mounted_tip_id = None
        self._failed = False
        self._started = False
        self._closed = False

    async def setup(self, state: LabState) -> None:
        if self._started or self._closed:
            raise RuntimeError("Create a new adapter for each simulation attempt")
        try:
            installed = version("pylabrobot")
            if installed != PINNED_VERSION:
                raise AdapterUnavailable(
                    f"PyLabRobot {PINNED_VERSION} required; found {installed}"
                )
            from pylabrobot.liquid_handling import LiquidHandler
            from pylabrobot.liquid_handling.backends import LiquidHandlerChatterboxBackend
            from pylabrobot.resources import (
                Coordinate, Deck, Plate, Tip, TipRack, TipSpot, Well,
                set_tip_tracking, set_volume_tracking,
            )
        except (ImportError, PackageNotFoundError) as error:
            raise AdapterUnavailable(
                f"PyLabRobot {PINNED_VERSION} unavailable; install apps/lab/requirements.txt"
            ) from error
        set_tip_tracking(True)
        set_volume_tracking(True)
        deck = Deck(size_x=400, size_y=300, size_z=150)
        for value in state.wells:
            well = Well(value.id, 8, 8, 12, max_volume=value.capacity_ul)
            well.location = Coordinate((int(value.id[1:]) - 1) * 9, (ord(value.id[0]) - 65) * 9, 0)
            well.tracker.set_volume(value.volume_ul)
            self.wells[value.id] = well
        plate = Plate("plate", 128, 86, 15, ordered_items=self.wells)
        deck.assign_child_resource(plate, location=Coordinate(0, 0, 0))

        def make_tip(name):
            return Tip(False, 50, state.pipette.capacity_ul, 8, name=name)

        ordered_spots = {}
        for index in range(96):
            tip_id = f"T{index + 1}"
            spot = TipSpot(tip_id, 8, 8, make_tip=make_tip)
            spot.location = Coordinate((index % 12) * 9, (index // 12) * 9, 0)
            self.tip_spots[tip_id] = spot
            ordered_spots[f"{chr(65 + index // 12)}{index % 12 + 1}"] = spot
        rack = TipRack("tips", 128, 86, 50, ordered_items=ordered_spots, with_tips=False)
        deck.assign_child_resource(rack, location=Coordinate(150, 0, 0))
        for tip_id in state.available_tips:
            spot = self.tip_spots[tip_id]
            spot.tracker.add_tip(spot.make_tip(), origin=spot)
        self.lh = LiquidHandler(backend=LiquidHandlerChatterboxBackend(num_channels=1), deck=deck)
        self._started = True
        try:
            await self.lh.setup()
            if state.pipette.tip_id is not None:
                spot = self.tip_spots[state.pipette.tip_id]
                tip = spot.make_tip()
                tip.tracker.set_volume(state.pipette.volume_ul)
                self.lh.head[0].add_tip(tip, origin=spot)
                self._mounted_tip_id = state.pipette.tip_id
        except BaseException:
            self._failed = True
            raise

    def snapshot(self) -> dict:
        if self.lh is None or not self._started or self._closed or self._failed:
            raise RuntimeError("No trustworthy active PyLabRobot state")
        head = self.lh.head[0]
        return {
            "backend": "LiquidHandlerChatterboxBackend",
            "version": PINNED_VERSION,
            "mode": "simulation",
            "well_volumes_ul": {key: well.tracker.get_used_volume() for key, well in self.wells.items()},
            "pipette_volume_ul": head.get_tip().tracker.get_used_volume() if head.has_tip else 0.0,
            "mounted_tip_id": self._mounted_tip_id if head.has_tip else None,
            "rack_tip_ids": [key for key, spot in self.tip_spots.items() if spot.has_tip()],
        }

    async def execute(self, operation: Operation) -> dict:
        self.snapshot()  # A failed, closed or uninitialized engine cannot execute.
        try:
            if operation.op == "pickup_tip":
                await self.lh.pick_up_tips([self.tip_spots[operation.resource]], use_channels=[0])
                self._mounted_tip_id = operation.resource
            elif operation.op == "return_tip":
                await self.lh.return_tips(use_channels=[0])
                self._mounted_tip_id = None
            elif operation.op == "aspirate":
                await self.lh.aspirate([self.wells[operation.resource]], vols=[operation.volume_ul], use_channels=[0])
            elif operation.op == "dispense":
                await self.lh.dispense([self.wells[operation.resource]], vols=[operation.volume_ul], use_channels=[0])
            else:
                raise ValueError(f"Unsupported PLR operation: {operation.op}")
            return self.snapshot()
        except BaseException:
            # Even pre-dispatch failures can leave PLR pending trackers changed.
            # The coordinator retains its last committed snapshot and records
            # error/unknown; never reinterpret this resource graph as success.
            self._failed = True
            raise

    async def stop(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self.lh is not None and self._started:
            if self.lh.setup_finished:
                await self.lh.stop()
            else:
                await self.lh.backend.stop()
