"""One explicit local comparison, not a scheduler or a scientific decision."""
from dataclasses import dataclass, replace

from contract import Invalid

ACTIVE = frozenset(("starting", "running", "cancelling"))


@dataclass(frozen=True)
class ComparisonRun:
    id: str
    input_id: str
    created_at: str
    status: str = "starting"
    started_at: str | None = None
    finished_at: str | None = None
    output_id: str | None = None
    error: str | None = None
    pid: int | None = None
    exit_code: int | None = None
    exit_observed: bool = False
    termination_requested: str | None = None

    def started(self, pid, now):
        if self.status != "starting":
            raise Invalid("comparison_transition_invalid")
        return replace(self, status="running", pid=pid, started_at=now)

    def request_cancel(self):
        if self.status not in ACTIVE:
            return self
        return replace(self, status="cancelling")

    def termination_sent(self, kind):
        if self.status != "cancelling" or kind not in ("terminate", "kill"):
            raise Invalid("comparison_transition_invalid")
        return replace(self, termination_requested=kind)

    def exited(self, code, now, output_id=None, error=None, terminated=False):
        if self.status not in ACTIVE:
            raise Invalid("comparison_transition_invalid")
        # A cancel request cannot relabel a completed calculation. Success
        # requires both a reaped exit 0 and its complete output artifact.
        if code == 0 and output_id is not None:
            status, error = "succeeded", None
        elif terminated and self.termination_requested is not None:
            status, error, output_id = "cancelled", None, None
        else:
            status, error, output_id = "failed", error or "comparison_process_failed", None
        return replace(self, status=status, finished_at=now, output_id=output_id,
                       error=error, exit_code=code, exit_observed=True)

    def launch_failed(self, now):
        if self.status != "starting":
            raise Invalid("comparison_transition_invalid")
        return replace(self, status="failed", finished_at=now, error="comparison_launch_failed")

    def interrupted(self, now):
        if self.status not in ACTIVE:
            return self
        return replace(self, status="interrupted", finished_at=now,
                       error="backend_restarted_exit_unknown", output_id=None)

    def document(self):
        return {"id": self.id, "inputId": self.input_id, "status": self.status,
                "createdAt": self.created_at, "startedAt": self.started_at,
                "finishedAt": self.finished_at, "outputId": self.output_id, "error": self.error,
                "process": {"pid": self.pid, "exitCode": self.exit_code,
                            "exitObserved": self.exit_observed,
                            "terminationRequested": self.termination_requested}}

    @classmethod
    def restore(cls, doc):
        process = doc["process"]
        return cls(doc["id"], doc["inputId"], doc["createdAt"], doc["status"],
                   doc["startedAt"], doc["finishedAt"], doc["outputId"], doc["error"],
                   process["pid"], process["exitCode"], process["exitObserved"],
                   process["terminationRequested"])
