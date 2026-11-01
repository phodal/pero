"""Durable App-local experiments. One no-hardware run at a time; no Agent runtime."""
import asyncio
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
import threading
from uuid import uuid4

from domain import (LabError, LabState, Policy, digest, initial_state, object_fields,
                    protocol, text, validate)
from evaluation import evaluate, import_observation, synthetic_observation
from pylabrobot_adapter import PyLabRobotRun, capability


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Experiments:
    def __init__(self, root: str | Path, runner_factory=PyLabRobotRun):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.runner_factory = runner_factory
        self.lock = threading.RLock()
        self.cancelled = threading.Event()
        self.worker = None
        self.active = None
        self.closing = False
        # Loading never repeats an effect. A crash leaves an explicit unknown run.
        for path in self.root.glob("*.json"):
            record = self._load(path.stem)
            changed = False
            for trial in record["trials"]:
                if trial["status"] == "running":
                    trial.update(status="unknown", error="Interrupted; not replayed", finished_at=now())
                    changed = True
            if changed:
                self._save(record)

    def _path(self, identity: str) -> Path:
        if not isinstance(identity, str) or not re.fullmatch(r"[a-f0-9]{32}", identity):
            raise LabError("Invalid experiment ID")
        return self.root / f"{identity}.json"

    def _load(self, identity: str) -> dict:
        try:
            record = json.loads(self._path(identity).read_text())
        except FileNotFoundError as exc:
            raise LabError("Experiment not found") from exc
        frozen = {"policy": record["policy"], "initial_state": record["initial_state"]}
        if record.get("schema_version") != 1 or digest(frozen) != record["input_hash"]:
            raise LabError("Experiment inputs are corrupt or use an unsupported version")
        return record

    def _save(self, record: dict):
        path = self._path(record["id"])
        fd, temporary = tempfile.mkstemp(dir=self.root, prefix=".lab-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(record, stream, ensure_ascii=False, allow_nan=False)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def _change(self, identity: str, change):
        with self.lock:
            record = self._load(identity)
            change(record)
            self._save(record)
            return deepcopy(record)

    @staticmethod
    def _trial(record: dict, identity: str) -> dict:
        found = next((trial for trial in record["trials"] if trial["id"] == identity), None)
        if found is None:
            raise LabError("Trial not found")
        return found

    def list(self) -> list[dict]:
        with self.lock:
            records = [self._load(p.stem) for p in self.root.glob("*.json")]
            return [{"id": r["id"], "objective": r["policy"]["objective"],
                     "created_at": r["created_at"], "trial_count": len(r["trials"])}
                    for r in sorted(records, key=lambda r: r["created_at"], reverse=True)]

    def create(self, payload: object) -> dict:
        policy = Policy.parse(payload)
        frozen = {"policy": asdict(policy), "initial_state": initial_state().snapshot()}
        record = {"schema_version": 1, "id": uuid4().hex, "created_at": now(),
                  "mode": "simulation", **frozen, "input_hash": digest(frozen), "trials": []}
        with self.lock:
            self._save(record)
        return record

    def read(self, identity: str) -> dict:
        with self.lock:
            return self._load(identity)

    def propose(self, identity: str, payload: dict) -> dict:
        p = object_fields(payload, {"input_hash", "steps", "reason", "parent_id"})

        def change(record):
            if p["input_hash"] != record["input_hash"]:
                raise LabError("Frozen input mismatch; read the experiment again")
            policy = Policy(**record["policy"])
            steps = protocol(p["steps"], policy)
            reason = text(p["reason"], "reason")
            if p["parent_id"] is not None:
                parent = self._trial(record, p["parent_id"])
                if parent["status"] == "running":
                    raise LabError("Wait for the parent trial to finish")
            candidate = {"steps": [s.wire() for s in steps], "reason": reason,
                         "parent_id": p["parent_id"], "input_hash": p["input_hash"]}
            key = digest(candidate)
            if any(t["candidate_hash"] == key for t in record["trials"]):
                return  # Retried identical proposal consumes no additional budget.
            if len(record["trials"]) >= policy.trial_budget:
                raise LabError("Frozen trial budget exhausted")
            record["trials"].append({"id": uuid4().hex, **candidate, "candidate_hash": key,
                "status": "proposed", "created_at": now(), "events": [],
                "final_state": record["initial_state"], "observation": None,
                "verification": None, "reviews": []})
        return self._change(identity, change)

    def validate(self, identity: str, trial_id: str) -> dict:
        def change(record):
            trial = self._trial(record, trial_id)
            if trial["status"] not in ("proposed", "validated"):
                raise LabError("Only an unexecuted candidate can be validated")
            policy = Policy(**record["policy"])
            try:
                trace = validate(LabState.restore(record["initial_state"]), protocol(trial["steps"], policy), policy)
                trial.update(status="validated", validation={"status": "PASS"},
                             predicted_state=trace[-1].snapshot())
            except LabError as exc:
                trial["validation"] = {"status": "FAIL", "error": str(exc), "step": exc.step}
        return self._change(identity, change)

    def simulate(self, identity: str, trial_id: str) -> dict:
        with self.lock:
            record = self._load(identity)
            trial = self._trial(record, trial_id)
            if trial["status"] in ("running", "completed"):
                return record  # Idempotent start; history is not a rerun command.
            if trial["status"] not in ("proposed", "validated"):
                raise LabError("This attempt cannot be replayed; propose a new trial")
            if self.active is not None or self.closing:
                raise LabError("Another run is active or the App is stopping")
            policy = Policy(**record["policy"])
            steps = protocol(trial["steps"], policy)
            trace = validate(LabState.restore(record["initial_state"]), steps, policy)
            runner = self.runner_factory()  # Missing real dependency fails before running state.
            trial.update(status="running", engine=runner.identity, started_at=now(),
                         validation={"status": "PASS"}, predicted_state=trace[-1].snapshot())
            self._save(record)
            self.cancelled.clear()
            self.active = (identity, trial_id)
            self.worker = threading.Thread(target=self._execute,
                args=(identity, trial_id, runner, steps, trace), daemon=True)
            self.worker.start()
            return deepcopy(record)

    def _execute(self, identity, trial_id, runner, steps, trace):
        async def run():
            status, error = "completed", None
            effect_pending = False
            try:
                record = self.read(identity)
                await runner.setup(LabState.restore(record["initial_state"]))
                for index, (step, expected) in enumerate(zip(steps, trace), 1):
                    if self.cancelled.is_set():
                        status = "cancelled"
                        break
                    before = self.read(identity)
                    previous = self._trial(before, trial_id)["final_state"]
                    def started(record):
                        self._trial(record, trial_id)["events"].append({
                            "step": index, "status": "started", "at": now(),
                            "operation": step.wire(), "before_hash": digest(previous)})
                    self._change(identity, started)  # Journal before issuing the effect.
                    effect_pending = True
                    receipt = await runner.apply(step, expected)
                    def confirmed(record):
                        trial = self._trial(record, trial_id)
                        state = expected.snapshot()
                        trial["events"].append({"step": index, "status": "confirmed", "at": now(),
                            "state": state, "state_hash": digest(state), "observed": asdict(receipt)})
                        trial["final_state"] = state
                    self._change(identity, confirmed)
                    effect_pending = False
            except Exception as exc:
                # The I/O boundary records unexpected backend failures; never retries.
                status, error = ("unknown" if effect_pending else "failed"), str(exc)
            finally:
                try:
                    await runner.stop()
                except Exception as exc:
                    status, error = "unknown", f"Backend cleanup failed: {exc}"
                def finish(record):
                    self._trial(record, trial_id).update(status=status, error=error, finished_at=now())
                self._change(identity, finish)
        try:
            asyncio.run(run())
        finally:
            with self.lock:
                self.active = None

    def cancel(self, identity: str, trial_id: str) -> dict:
        with self.lock:
            record = self._load(identity)
            trial = self._trial(record, trial_id)
            if trial["status"] == "running" and self.active == (identity, trial_id):
                self.cancelled.set()
            return record

    def observe(self, identity: str, trial_id: str, payload: dict | None = None) -> dict:
        def change(record):
            trial = self._trial(record, trial_id)
            if trial["status"] != "completed":
                raise LabError("Attach observations only to a completed trial")
            if payload is None:
                observation = synthetic_observation(LabState.restore(trial["final_state"]), Policy(**record["policy"]))
            else:
                p = object_fields(payload, {"filename", "content_base64"})
                observation = import_observation(p["filename"], p["content_base64"])
            if trial["observation"]:
                if trial["observation"] == observation.wire():
                    return
                raise LabError("Observations are immutable; create another trial for new measurements")
            trial["observation"] = observation.wire()
            trial["verification"] = None
        return self._change(identity, change)

    def evaluate(self, identity: str, trial_id: str) -> dict:
        def change(record):
            trial = self._trial(record, trial_id)
            if trial["status"] == "running":
                raise LabError("Wait for the trial to finish")
            trial["verification"] = evaluate(record, trial)
        return self._change(identity, change)

    def review(self, identity: str, trial_id: str, payload: dict) -> dict:
        p = object_fields(payload, {"decision", "note"})
        if p["decision"] not in ("accepted", "rejected"):
            raise LabError("Choose accepted or rejected")
        note = text(p["note"], "review note")
        def change(record):
            trial = self._trial(record, trial_id)
            if trial["status"] == "running":
                raise LabError("A running trial cannot be reviewed")
            result = evaluate(record, trial)
            if p["decision"] == "accepted" and result["status"] != "PASS":
                raise LabError("Only a verified PASS can be accepted")
            trial["verification"] = result
            trial["reviews"].append({"decision": p["decision"], "note": note, "at": now(),
                                    "source": "explicit-ui-review", "signed_identity": False})
        return self._change(identity, change)

    def close(self):
        with self.lock:
            self.closing = True
            self.cancelled.set()
            worker = self.worker
        if worker:
            worker.join(timeout=12)
