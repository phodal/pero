"""Versioned CPU method declaration; execution and artifacts retain their owners."""
from dataclasses import dataclass

from baselines import BASELINE_VERSION
from contract import BASELINES, sealed
from evaluation import METHOD as EVALUATOR

METHOD = "virtual-cell.comparison"
MIN_PYTHON = (3, 10)


@dataclass(frozen=True)
class TaskPackage:
    id: str = METHOD
    version: str = "1.0.0"

    def document(self, source_hashes):
        return sealed({
            "schema": "pero.virtual-cell.task-package.v1", "id": self.id,
            "version": self.version, "name": "Frozen perturbation comparison",
            "methods": [{"id": name, "version": BASELINE_VERSION} for name in BASELINES],
            "model": {"id": "additive-endpoint", "version": BASELINE_VERSION, "weights": "none"},
            "environment": {"python": f">={MIN_PYTHON[0]}.{MIN_PYTHON[1]}", "dependencies": [], "execution": "cpu",
                            "inspectionMethod": METHOD, "owner": "Host / Environments"},
            "inputs": {"dataset": "point.virtual-cell.condition-means.v1",
                       "parameters": "point.virtual-cell.task-spec.v1",
                       "split": "point.virtual-cell.split.v1",
                       "binding": "Immutable Workbench input ID; dataset/spec/split digests"},
            "outputs": ["condition-mean predictions", EVALUATOR, "process log", "numerical check receipt"],
            "checks": ["Artifact and input digest binding", "Independent equal-batch delta MSE and denominator recomputation"],
            "skill": {"id": "virtual-cell-comparison", "version": "1.0.0", "entry": "backend/comparison-method.md"},
            "implementation": source_hashes,
            "acceptance": "not_reviewed", "isolation": "unverified",
        })


PACKAGE = TaskPackage()
