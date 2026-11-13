"""Bounded App Use commands; existing owners retain execution and authorization."""
from dataclasses import dataclass

from contract import Invalid
from task_package import PACKAGE


@dataclass(frozen=True)
class TaskStep:
    action: str
    input_id: str | None = None
    run_id: str | None = None

    @classmethod
    def parse(cls, document):
        if not isinstance(document, dict):
            raise Invalid("task_step_fields")
        action = document.get("action")
        fields = {"read": {"action"}, "start-model": {"action", "inputId"},
                  "stop-model": {"action"}, "run": {"action", "inputId"},
                  "check": {"action", "runId"}, "cancel": {"action", "runId"}}
        if not isinstance(action, str) or action not in fields:
            raise Invalid("task_step_action")
        expected = fields[action] | ({"runId"} if action == "read" and "runId" in document else set())
        if set(document) != expected or any(not isinstance(document[key], str) for key in expected - {"action"}):
            raise Invalid("task_step_fields")
        # Identity syntax and existence belong to Workbench/ComparisonHistory.
        return cls(action, document.get("inputId"), document.get("runId"))


def execute_step(command: TaskStep, workbench, comparisons, model):
    if command.action == "read":
        result = {"action": command.action, "taskPackage": PACKAGE.document(workbench.source),
                  "model": model.read(), "inputs": workbench.catalog(), "comparisons": comparisons.catalog()}
        if command.run_id is not None:
            result["run"] = comparisons.read(command.run_id)
        return result
    if command.action == "start-model":
        return {"action": command.action, "model": model.start(command.input_id)}
    if command.action == "stop-model":
        return {"action": command.action, "model": model.stop()}
    if command.action == "run":
        run = comparisons.start(command.input_id)
    elif command.action == "check":
        run = comparisons.check(command.run_id)
    else:
        run = comparisons.cancel(command.run_id)
    return {"action": command.action, "run": run}
