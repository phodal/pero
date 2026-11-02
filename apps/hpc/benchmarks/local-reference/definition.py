"""The fixed numerical reference and its preregistered acceptance rules."""
from dataclasses import dataclass
import math


@dataclass(frozen=True)
class BenchmarkDefinition:
    id: str
    version: str
    method: str
    intervals: tuple[int, int]
    absolute_error_max: float
    convergence_ratio_min: float
    convergence_ratio_max: float
    sample_consistency_max: float
    estimate_consistency_max: float
    residual_max: float | None

    @classmethod
    def admit(cls, data: dict) -> "BenchmarkDefinition":
        spec, limits = data["spec"], data["thresholds"]
        intervals = tuple(spec["intervals"])
        method = spec["method"]
        methods = {"pi-midpoint-v1": "pi-midpoint", "poisson-1d-v1": "poisson-1d"}
        if (data["schemaVersion"] != 1 or data["executionKind"] != "local-reference"
                or methods.get(data["id"]) != method or len(intervals) != 2
                or any(type(n) is not int or n < 2 for n in intervals)
                or intervals[1] != 2 * intervals[0]
                or spec["lowerBound"] != 0 or spec["upperBound"] != 1):
            raise ValueError("Unsupported numerical reference definition")
        if method == "pi-midpoint" and (spec["integrand"] != "4 / (1 + x*x)"
                                        or spec["reference"] != "math.pi"):
            raise ValueError("Unsupported quadrature")
        if method == "poisson-1d" and (spec["equation"] != "-u'' = pi^2 * sin(pi*x)"
                                      or spec["boundaryValues"] != [0, 0]
                                      or spec["reference"] != "sin(pi*x)"):
            raise ValueError("Unsupported Poisson problem")
        values = tuple(limits[key] for key in (
            "absoluteErrorMax", "convergenceRatioMin", "convergenceRatioMax",
            "sampleConsistencyMax", "estimateConsistencyMax"))
        if any(type(value) not in (int, float) or not math.isfinite(value)
               or value <= 0 for value in values) or values[1] > values[2]:
            raise ValueError("Acceptance limits must be finite, positive and ordered")
        residual = limits.get("residualMax")
        if method == "poisson-1d" and (type(residual) not in (int, float)
                                       or not math.isfinite(residual) or residual <= 0):
            raise ValueError("Poisson residual limit must be finite and positive")
        return cls(data["id"], data["version"], method, intervals, *values, residual)

    def input(self) -> dict:
        return {"schemaVersion": 1, "benchmarkId": self.id, "method": self.method,
                "benchmarkVersion": self.version, "intervals": list(self.intervals)}

    def validate_input(self, value: dict) -> None:
        if value != self.input():
            raise ValueError("Input does not match the fixed benchmark definition")

    def thresholds(self) -> dict:
        result = {"absoluteErrorMax": self.absolute_error_max,
                "convergenceRatioMin": self.convergence_ratio_min,
                "convergenceRatioMax": self.convergence_ratio_max,
                "sampleConsistencyMax": self.sample_consistency_max,
                "estimateConsistencyMax": self.estimate_consistency_max}
        if self.residual_max is not None:
            result["residualMax"] = self.residual_max
        return result
