"""App-local comparison history and its fixed CPU child process.

Host still supervises the App process group. Children inherit that group;
there are no commands supplied by clients, queues, workers or auto-replays.
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import re
import signal
import subprocess
import sys
import threading
from uuid import uuid4

from baselines import BASELINE_VERSION
from comparison import ACTIVE, ComparisonRun
from contract import BASELINES, Invalid, canonical
from evaluation import METHOD, compare
from workbench import Workbench

RUN_ID = re.compile(r"^[a-f0-9]{32}$")
LOG_BYTES = 64 * 1024
EXPORT_SCHEMA = "pero.virtual-cell.local-comparison-export.v1"


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def environment():
    return {"python": platform.python_version(), "system": platform.system(), "machine": platform.machine()}


class ComparisonHistory:
    def __init__(self, workbench):
        self.workbench = workbench
        self.root = workbench.root / "comparisons"
        self.root.mkdir(exist_ok=True)
        self.lock = threading.RLock()
        self.runs = {}
        self.provenance = {}
        self.processes = {}
        self.observers = {}
        self.closed = False
        # Host owns descendants through a POSIX process group. Its Windows
        # child-only kill cannot safely supervise this new CPU subprocess.
        self.available = sys.platform in ("linux", "darwin")
        for path in self.root.glob("*/run.json"):
            doc = json.loads(path.read_bytes())
            run = ComparisonRun.restore(doc)
            self.provenance[run.id] = {key: doc[key] for key in (
                "methods", "evaluator", "sourceHashes", "environment", "scope", "isolation", "acceptance")}
            # A previous PID is not proof of ownership or successful exit.
            # Do not signal it, trust a leftover result, or replay the request.
            self._save(run.interrupted(now()))

    def _save(self, run):
        directory = self.root / run.id
        directory.mkdir(exist_ok=True)
        temporary = directory / "run.tmp"
        temporary.write_bytes(canonical({**run.document(), **self.provenance[run.id]}))
        os.replace(temporary, directory / "run.json")
        self.runs[run.id] = run

    def _find(self, identity):
        if not isinstance(identity, str) or not RUN_ID.fullmatch(identity):
            raise Invalid("comparison_id_invalid")
        if identity not in self.runs:
            raise Invalid("comparison_missing")
        return self.runs[identity]

    def catalog(self):
        with self.lock:
            return {"availability": {"available": self.available,
                                     "reason": None if self.available else "comparison_platform_unsupported"},
                    "items": [self._summary(run) for run in sorted(
                self.runs.values(), key=lambda r: (r.created_at, r.id), reverse=True)]}

    def _summary(self, run):
        p = self.provenance[run.id]
        return {**run.document(), **{key: p[key] for key in (
            "methods", "evaluator", "scope", "isolation", "acceptance")}}

    def read(self, identity):
        with self.lock:
            run = self._find(identity)
            path = self.root / identity / "process.log"
            logs, truncated = "", False
            if path.exists():
                with path.open("rb") as handle:
                    size = handle.seek(0, os.SEEK_END)
                    truncated = size > LOG_BYTES
                    handle.seek(max(0, size - LOG_BYTES))
                    logs = handle.read(LOG_BYTES).decode("utf-8", errors="replace")
            return {**run.document(), **self.provenance[identity],
                    "logs": logs, "logsTruncated": truncated}

    def start(self, input_id):
        with self.lock:
            if not self.available:
                raise Invalid("comparison_platform_unsupported")
            if self.closed:
                raise Invalid("comparison_backend_stopping")
            if any(run.status in ACTIVE for run in self.runs.values()):
                raise Invalid("comparison_already_running")
            self.workbench.comparison_inputs(input_id)
            run = ComparisonRun(uuid4().hex, input_id, now())
            self.provenance[run.id] = {
                "methods": [{"id": name, "version": BASELINE_VERSION} for name in BASELINES],
                "evaluator": METHOD, "sourceHashes": self.workbench.source,
                "environment": environment(), "scope": "app_local",
                "isolation": "unverified", "acceptance": "not_reviewed"}
            self._save(run)
            directory = self.root / run.id
            with (directory / "process.log").open("ab") as log:
                try:
                    process = subprocess.Popen(
                        [sys.executable, "-E", "-s", "-u", str(Path(__file__).resolve()),
                         str(self.workbench.root.resolve()), input_id, str(directory.resolve())],
                        stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
                except OSError:
                    self._save(run.launch_failed(now()))
                    raise
            self.processes[run.id] = process
            self._save(run.started(process.pid, now()))
            observer = threading.Thread(target=self._observe, args=(run.id,), daemon=True)
            self.observers[run.id] = observer
            observer.start()
            return self.read(run.id)

    def _observe(self, identity):
        process = self.processes[identity]
        code = process.wait()
        output_id, error = None, None
        try:
            receipt = json.loads((self.root / identity / "receipt.json").read_bytes())
            if code == 0:
                output_id = receipt["outputId"]
                # Integrity belongs to the existing content-addressed owner.
                self.workbench.read(output_id)
            else:
                error = receipt.get("error")
        except (OSError, ValueError, KeyError):
            error = "comparison_output_missing_or_invalid" if code == 0 else "comparison_process_failed"
            output_id = None
        with self.lock:
            run = self.runs[identity]
            terminated = code in (-signal.SIGTERM, -signal.SIGKILL)
            self._save(run.exited(code, now(), output_id, error, terminated))
            del self.processes[identity]

    def cancel(self, identity):
        with self.lock:
            run = self._find(identity)
            process = self.processes.get(identity)
            if process is not None and process.poll() is None:
                run = run.request_cancel()
                self._save(run)
                process.terminate()
                self._save(run.termination_sent("terminate"))
        if process is not None:
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                with self.lock:
                    if process.poll() is None:
                        process.kill()
                        self._save(self.runs[identity].termination_sent("kill"))
                process.wait()
            self.observers[identity].join()
        return self.read(identity)

    def close(self):
        with self.lock:
            self.closed = True
            identities = list(self.processes)
        for identity in identities:
            self.cancel(identity)

    def export(self, identity):
        run = self.read(identity)
        bundle = self.workbench.read(run["inputId"])["bundle"]
        output = self.workbench.read(run["outputId"]) if run["outputId"] else None
        return {"content": canonical({"schema": EXPORT_SCHEMA, "run": run,
                "bundle": bundle, "output": output,
                "recompute": {"command": "python backend/cli.py compare --bundle export.json --out recomputed.json",
                              "comparison": "Compare evaluation and prediction digests; sourceHashes identify the method implementation.",
                              "acceptance": "not_reviewed"}}).decode()}


def run_cpu(root, input_id, directory):
    """The only child entry point: use admitted input, emit real output/logs."""
    workbench = Workbench(root)
    print("Starting CPU comparison: control, train_mean, additive; evaluation=" + METHOD, flush=True)
    try:
        result = compare(workbench.comparison_inputs(input_id))
        for prediction in result.predictions:
            print(f"Computed {prediction['model']['id']}: {len(prediction['conditions'])} conditions; {prediction['digest']}", flush=True)
        output = {"kind": "output", "inputId": input_id, "operation": "compare",
                  "result": result.evaluation, "predictions": list(result.predictions),
                  "sourceHashes": workbench.source, "environment": environment(),
                  "scope": "app_local", "isolation": "unverified", "acceptance": "not_reviewed"}
        output_id = workbench.put(output)
        receipt = {"outputId": output_id}
        print("Evaluation saved: " + output_id + "; isolation=unverified; acceptance=not_reviewed", flush=True)
        code = 0
    except Invalid as error:
        receipt = {"error": error.code, "detail": error.detail}
        print(canonical(receipt).decode(), flush=True)
        code = 2
    (Path(directory) / "receipt.json").write_bytes(canonical(receipt))
    return code


if __name__ == "__main__":
    sys.exit(run_cpu(*sys.argv[1:]))
