"""Observation parsing and deterministic evaluation, independent of Agent verdicts."""
import base64
import csv
from dataclasses import asdict, dataclass
from hashlib import sha256
import io
import json
from domain import LabError, LabState, Policy, WELLS, digest, number, object_fields

MAX_IMPORT_BYTES = 256 * 1024


@dataclass(frozen=True)
class Measurement:
    well: str
    value: float
    unit: str = "fraction"


@dataclass(frozen=True)
class Observation:
    origin: str
    filename: str
    sha256: str
    original_base64: str
    measurements: tuple[Measurement, ...]
    model: str | None = None

    def wire(self) -> dict:
        return {**asdict(self), "measurements": [asdict(m) for m in self.measurements]}


def import_observation(filename: str, encoded: str) -> Observation:
    if not isinstance(filename, str) or not filename.lower().endswith((".csv", ".json")) or len(filename) > 200:
        raise LabError("Choose a CSV or JSON measurement file")
    if not isinstance(encoded, str) or len(encoded) > (MAX_IMPORT_BYTES + 2) // 3 * 4:
        raise LabError("Measurement file exceeds 256 KiB")
    try:
        raw = base64.b64decode(encoded, validate=True)
        source = raw.decode("utf-8-sig")
        if len(raw) > MAX_IMPORT_BYTES:
            raise ValueError("Measurement file exceeds 256 KiB")
        is_csv = filename.lower().endswith(".csv")
        if is_csv:
            reader = csv.DictReader(io.StringIO(source))
            if reader.fieldnames != ["well", "value", "unit"]:
                raise ValueError("CSV header must be well,value,unit")
            rows = list(reader)
        else:
            rows = json.loads(source)
        if not isinstance(rows, list) or len(rows) > 96:
            raise ValueError("Expected at most 96 measurement rows")
        samples, seen = [], set()
        for row in rows:
            p = object_fields(row, {"well", "value", "unit"})
            if p["well"] not in WELLS or p["well"] in seen or p["unit"] != "fraction":
                raise ValueError("Use unique A1–H12 wells and unit 'fraction'")
            seen.add(p["well"])
            value = float(p["value"]) if is_csv else p["value"]
            samples.append(Measurement(p["well"], number(value, "measurement", 0, 1)))
    except (ValueError, UnicodeError, csv.Error, TypeError) as exc:
        raise LabError(f"Invalid measurement file: {exc}") from exc
    return Observation("imported", filename, sha256(raw).hexdigest(), encoded, tuple(samples))


def synthetic_observation(final: LabState, policy: Policy) -> Observation:
    # A deliberately disclosed sensor gain. This is NOT a robot/optical measurement.
    value = 0.9 * final.wells[WELLS.index(policy.target_well)].fraction
    raw = json.dumps([{"well": policy.target_well, "value": value, "unit": "fraction"}],
                     sort_keys=True).encode()
    imported = import_observation("synthetic-gain-0.9.json", base64.b64encode(raw).decode())
    return Observation("synthetic", imported.filename, imported.sha256, imported.original_base64,
                       imported.measurements, "illustrative-sensor-gain-0.9-v1")


def evaluate(experiment: dict, trial: dict) -> dict:
    policy = Policy(**experiment["policy"])
    checks = []

    def check(name: str, status: str, detail: str):
        checks.append({"name": name, "status": status, "detail": detail})

    complete = trial["status"] == "completed"
    check("Execution", "PASS" if complete else "INCONCLUSIVE", trial["status"])
    bound = trial["input_hash"] == experiment["input_hash"]
    check("Frozen inputs", "PASS" if bound else "FAIL", trial["input_hash"])
    confirmed = [event for event in trial["events"] if event["status"] == "confirmed"]
    chain = (len(confirmed) == len(trial["steps"]) and
             all(event["state_hash"] == digest(event["state"]) for event in confirmed))
    check("Recorded steps", "PASS" if chain and complete else "INCONCLUSIVE",
          f"{len(confirmed)}/{len(trial['steps'])} steps confirmed")
    final = LabState.restore(trial["final_state"])
    initial = LabState.restore(experiment["initial_state"])
    initial_volume = sum(w.volume_ul for w in initial.wells)
    final_volume = sum(w.volume_ul for w in final.wells) + final.pipette.volume_ul
    conserved = abs(initial_volume - final_volume) <= 1e-6
    check("Volume balance", "PASS" if conserved else "FAIL",
          f"{initial_volume:g} → {final_volume:g} µL (symbolic, not measured)")
    observation = trial.get("observation")
    measurements = observation["measurements"] if observation else []
    target = next((m for m in measurements if m["well"] == policy.target_well), None)
    prediction = final.wells[WELLS.index(policy.target_well)].fraction
    error = abs(target["value"] - policy.target_fraction) if target is not None else None
    status = "INCONCLUSIVE" if error is None else "PASS" if error <= policy.tolerance + 1e-12 else "FAIL"
    check("Target fraction", status, "No B1 observation" if error is None else
          f"Absolute error {error:.6g}; limit {policy.tolerance:g} fraction")
    verdict = "FAIL" if any(c["status"] == "FAIL" for c in checks) else (
        "INCONCLUSIVE" if any(c["status"] == "INCONCLUSIVE" for c in checks) else "PASS")
    return {"status": verdict, "checks": checks, "predicted_fraction": prediction,
            "observed_fraction": target["value"] if target else None, "absolute_error": error,
            "origin": observation["origin"] if observation else None,
            "evaluator": "frozen-target-v1", "acceptance": "Not a scientific or hardware safety approval"}
