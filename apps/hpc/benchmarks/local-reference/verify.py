"""Independently recheck a retained result bundle without ReFrame or an Agent."""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from definition import BenchmarkDefinition


def verify_bundle(root: Path) -> dict:
    report = {"schemaVersion": 1, "benchmarkId": "pi-midpoint-v1",
              "status": "incomplete", "metrics": {}, "thresholds": {},
              "checks": [], "errors": []}
    try:
        definition = BenchmarkDefinition.admit(json.loads((root / "benchmark.json").read_text()))
        report["benchmarkId"] = definition.id
        report["thresholds"] = definition.thresholds()
        definition.validate_input(json.loads((root / "input.json").read_text()))
        manifest = json.loads((root / "manifest.json").read_text())
        for name, expected in manifest["files"].items():
            actual = hashlib.sha256((root / name).read_bytes()).hexdigest()
            if actual != expected:
                raise ValueError(f"Frozen input/program hash differs: {name}")
        result = json.loads((root / "result.json").read_text())
        if (result.get("schemaVersion") != 1 or result.get("benchmarkId") != definition.id
                or result.get("benchmarkVersion") != definition.version
                or result.get("method") != definition.method
                or result.get("completed") is not True
                or result.get("executionKind") != "local-reference" or result.get("ranks") != 1):
            raise ValueError("Completed local-reference execution metadata is missing or inconsistent")
        runs = result["runs"]
        if len(runs) != 2 or [run["intervals"] for run in runs] != list(definition.intervals):
            raise ValueError("Both fixed resolutions are required in order")
        estimates, errors = [], []
        residual = 0.0
        sample_difference = estimate_difference = 0.0
        for run, intervals in zip(runs, definition.intervals):
            with (root / "raw" / f"samples-{intervals}.csv").open(newline="") as stream:
                reader = csv.DictReader(stream)
                columns = ["index", "x", "value"]
                if definition.method == "poisson-1d":
                    columns.append("forcing")
                if reader.fieldnames != columns:
                    raise ValueError("Unexpected raw sample columns")
                values, forcings = [], []
                for index, row in enumerate(reader):
                    x, value = float(row["x"]), float(row["value"])
                    expected_x = ((index + 0.5) / intervals if definition.method == "pi-midpoint"
                                  else index / intervals)
                    if int(row["index"]) != index or not math.isfinite(x) or not math.isfinite(value):
                        raise ValueError("Unordered or non-finite raw samples")
                    sample_difference = max(sample_difference, abs(x - expected_x))
                    if definition.method == "pi-midpoint":
                        expected_value = 4.0 / (1.0 + expected_x ** 2)
                        sample_difference = max(sample_difference, abs(value - expected_value))
                    else:
                        forcing = float(row["forcing"])
                        if not math.isfinite(forcing):
                            raise ValueError("Non-finite forcing sample")
                        forcings.append(forcing)
                        expected_forcing = math.pi ** 2 * math.sin(math.pi * expected_x)
                        sample_difference = max(sample_difference, abs(forcing - expected_forcing))
                    values.append(value)
            expected_count = intervals if definition.method == "pi-midpoint" else intervals + 1
            if len(values) != expected_count:
                raise ValueError(f"Expected {expected_count} raw samples, received {len(values)}")
            if definition.method == "pi-midpoint":
                estimate = math.fsum(values) / intervals
                error = abs(estimate - math.pi)
            else:
                estimate = max(values)
                error = max(abs(value - math.sin(math.pi * index / intervals))
                            for index, value in enumerate(values))
                # Compute A*u-f directly, without reusing the solver's elimination.
                residual = max(residual, abs(values[0]), abs(values[-1]),
                               max(abs((2 * values[i] - values[i - 1] - values[i + 1])
                                       * intervals ** 2 - forcings[i])
                                   for i in range(1, intervals)))
            claimed = run["estimate"]
            if not isinstance(claimed, (int, float)) or not math.isfinite(claimed):
                raise ValueError("Non-finite computed estimate")
            estimate_difference = max(estimate_difference, abs(estimate - claimed))
            estimates.append(estimate)
            errors.append(error)
        ratio = errors[0] / errors[1] if errors[1] else 0.0
        report["metrics"] = {"coarseEstimate": estimates[0], "fineEstimate": estimates[1],
                             "reference": math.pi if definition.method == "pi-midpoint" else 1.0,
                             "coarseAbsoluteError": errors[0],
                             "fineAbsoluteError": errors[1], "convergenceRatio": ratio,
                             "sampleConsistency": sample_difference,
                             "estimateConsistency": estimate_difference}
        report["checks"] = [
            {"id": "accuracy", "label": "Fine-grid absolute error", "value": errors[1],
             "threshold": definition.absolute_error_max,
             "passed": errors[1] <= definition.absolute_error_max},
            {"id": "convergence", "label": "Second-order convergence ratio", "value": ratio,
             "threshold": [definition.convergence_ratio_min, definition.convergence_ratio_max],
             "passed": definition.convergence_ratio_min <= ratio <= definition.convergence_ratio_max},
            {"id": "raw-samples", "label": "Raw sample consistency", "value": sample_difference,
             "threshold": definition.sample_consistency_max,
             "passed": sample_difference <= definition.sample_consistency_max},
            {"id": "estimate", "label": "Reported estimate matches raw samples",
             "value": estimate_difference, "threshold": definition.estimate_consistency_max,
             "passed": estimate_difference <= definition.estimate_consistency_max}]
        if definition.residual_max is not None:
            report["metrics"]["residualMax"] = residual
            report["checks"].append({"id": "residual", "label": "Discrete equation residual",
                                     "value": residual, "threshold": definition.residual_max,
                                     "passed": residual <= definition.residual_max})
        report["status"] = "pass" if all(check["passed"] for check in report["checks"]) else "fail"
        report["errors"] = [check["label"] for check in report["checks"] if not check["passed"]]
    except (OSError, ValueError, KeyError, TypeError, OverflowError, csv.Error) as error:
        report["errors"].append(str(error))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--write", action="store_true", help="Also write verification.json")
    args = parser.parse_args()
    report = verify_bundle(args.directory.resolve())
    encoded = json.dumps(report, indent=2, allow_nan=False) + "\n"
    if args.write:
        (args.directory / "verification.json").write_text(encoded)
    print(encoded, end="")
    raise SystemExit(0 if report["status"] == "pass" else 1)
