"""Pure, typed color-mixing model. Volumes are µL, dye quantities are virtual.

This model describes bookkeeping, not collision safety, fluid dynamics or optics.
"""
from dataclasses import asdict, dataclass, replace
from hashlib import sha256
import json
import math
from typing import Literal

WELLS = tuple(f"{row}{col}" for row in "ABCDEFGH" for col in range(1, 13))
MODEL = "ideal-mixture-v1"


class LabError(ValueError):
    def __init__(self, message: str, *, step: int | None = None):
        super().__init__(message)
        self.step = step


def digest(value: object) -> str:
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                             ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def object_fields(value: object, required: set[str], optional: set[str] = frozenset()) -> dict:
    if not isinstance(value, dict) or not required <= value.keys() or value.keys() - required - optional:
        raise LabError(f"Expected fields {sorted(required)}; optional {sorted(optional)}")
    return value


def number(value: object, name: str, low: float, high: float) -> float:
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise LabError(f"{name} must be a finite number from {low} to {high}")
    return float(value)


def text(value: object, name: str, limit: int = 500) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise LabError(f"{name} must contain 1–{limit} characters")
    return value.strip()


@dataclass(frozen=True)
class Well:
    volume_ul: float = 0.0
    dye_ul: float = 0.0

    @property
    def fraction(self) -> float:
        return self.dye_ul / self.volume_ul if self.volume_ul else 0.0


@dataclass(frozen=True)
class LabState:
    wells: tuple[Well, ...]
    tip: str | None = None
    pipette: Well = Well()
    used_tips: tuple[str, ...] = ()
    revision: int = 0

    def snapshot(self) -> dict:
        return {"wells": {name: asdict(well) for name, well in zip(WELLS, self.wells)},
                "tip": self.tip, "pipette": asdict(self.pipette),
                "used_tips": list(self.used_tips), "revision": self.revision}

    @classmethod
    def restore(cls, value: dict) -> "LabState":
        return cls(tuple(Well(**value["wells"][name]) for name in WELLS),
                   value["tip"], Well(**value["pipette"]),
                   tuple(value["used_tips"]), value["revision"])


def initial_state() -> LabState:
    wells = [Well() for _ in WELLS]
    wells[0], wells[1] = Well(300.0, 300.0), Well(300.0, 0.0)
    return LabState(tuple(wells))


@dataclass(frozen=True)
class Policy:
    objective: str
    target_fraction: float
    tolerance: float
    trial_budget: int
    target_well: str = "B1"
    max_steps: int = 64
    well_capacity_ul: float = 360.0
    pipette_capacity_ul: float = 300.0
    model: str = MODEL

    @classmethod
    def parse(cls, payload: object) -> "Policy":
        p = object_fields(payload, {"objective", "target_fraction", "tolerance", "trial_budget"})
        budget = p["trial_budget"]
        if type(budget) is not int or not 2 <= budget <= 8:
            raise LabError("trial_budget must be an integer from 2 to 8")
        return cls(text(p["objective"], "objective"),
                   number(p["target_fraction"], "target_fraction", 0, 1),
                   number(p["tolerance"], "tolerance", 0, 0.25), budget)


@dataclass(frozen=True)
class Step:
    action: Literal["pick_up_tip", "aspirate", "dispense", "return_tip"]
    resource: str = ""
    volume_ul: float = 0.0

    @classmethod
    def parse(cls, value: object) -> "Step":
        if not isinstance(value, dict):
            raise LabError("Each step must be an object")
        action = value.get("action")
        if action == "return_tip":
            object_fields(value, {"action"})
            return cls(action)
        if action not in ("pick_up_tip", "aspirate", "dispense"):
            raise LabError("Unsupported operation")
        required = {"action", "resource"}
        if action != "pick_up_tip":
            required.add("volume_ul")
        p = object_fields(value, required)
        if p["resource"] not in WELLS:
            raise LabError("Resource must be a well/tip position from A1 to H12")
        volume = 0.0 if action == "pick_up_tip" else number(p["volume_ul"], "volume_ul", 0, 360)
        if action != "pick_up_tip" and volume == 0:
            raise LabError("volume_ul must be positive")
        return cls(action, p["resource"], volume)

    def wire(self) -> dict:
        if self.action == "return_tip":
            return {"action": self.action}
        result = {"action": self.action, "resource": self.resource}
        if self.action != "pick_up_tip":
            result["volume_ul"] = self.volume_ul
        return result


def protocol(value: object, policy: Policy) -> tuple[Step, ...]:
    if not isinstance(value, list) or not 1 <= len(value) <= policy.max_steps:
        raise LabError(f"Protocol must contain 1–{policy.max_steps} steps")
    steps = []
    for index, item in enumerate(value):
        try:
            steps.append(Step.parse(item))
        except LabError as exc:
            raise LabError(str(exc), step=index + 1) from exc
    return tuple(steps)


def advance(state: LabState, step: Step, policy: Policy) -> LabState:
    """Only owner of virtual mixture transitions. No side effects on rejection."""
    if step.action == "pick_up_tip":
        if state.tip is not None or step.resource in state.used_tips:
            raise LabError("Channel is occupied or this tip has already been used")
        return replace(state, tip=step.resource, used_tips=(*state.used_tips, step.resource),
                       revision=state.revision + 1)
    if state.tip is None:
        raise LabError("Pick up a fresh tip first")
    if step.action == "return_tip":
        if state.pipette.volume_ul > 1e-8:
            raise LabError("Dispense the remaining liquid before returning the tip")
        return replace(state, tip=None, revision=state.revision + 1)
    index = WELLS.index(step.resource)
    well, pipette, amount = state.wells[index], state.pipette, step.volume_ul
    if step.action == "aspirate":
        if pipette.volume_ul > 1e-8:
            raise LabError("Empty the pipette before the next aspiration")
        if amount > well.volume_ul + 1e-8:
            raise LabError(f"{step.resource} has insufficient liquid")
        if amount > policy.pipette_capacity_ul:
            raise LabError("Pipette capacity exceeded")
        dye = amount * well.fraction
        well = Well(max(0.0, well.volume_ul - amount), max(0.0, well.dye_ul - dye))
        pipette = Well(amount, dye)
    else:
        if amount > pipette.volume_ul + 1e-8:
            raise LabError("Pipette has insufficient liquid")
        if well.volume_ul + amount > policy.well_capacity_ul:
            raise LabError(f"{step.resource} capacity exceeded")
        dye = amount * pipette.fraction
        well = Well(well.volume_ul + amount, well.dye_ul + dye)
        pipette = Well(max(0.0, pipette.volume_ul - amount), max(0.0, pipette.dye_ul - dye))
    wells = list(state.wells)
    wells[index] = well
    return replace(state, wells=tuple(wells), pipette=pipette, revision=state.revision + 1)


def validate(initial: LabState, steps: tuple[Step, ...], policy: Policy) -> tuple[LabState, ...]:
    state, trace = initial, []
    for index, step in enumerate(steps):
        try:
            state = advance(state, step, policy)
        except LabError as exc:
            raise LabError(str(exc), step=index + 1) from exc
        trace.append(state)
    if state.tip is not None:
        raise LabError("Protocol must finish with the tip returned", step=len(steps))
    if state.wells[WELLS.index(policy.target_well)].volume_ul == 0:
        raise LabError("Protocol must produce a sample in B1", step=len(steps))
    return tuple(trace)


def example_steps(dye_ul: float = 90.0) -> list[dict]:
    """A transparent starting template, not an Agent-generated result."""
    result = []
    for tip, source, amount in (("A1", "A1", dye_ul), ("A2", "A2", 200.0 - dye_ul)):
        result.extend([{"action": "pick_up_tip", "resource": tip},
                       {"action": "aspirate", "resource": source, "volume_ul": amount},
                       {"action": "dispense", "resource": "B1", "volume_ul": amount},
                       {"action": "return_tip"}])
    return result
