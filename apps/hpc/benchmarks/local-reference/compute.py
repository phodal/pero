"""Run a fixed CPU numerical method and retain every raw sample."""
import argparse
import csv
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import platform
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from definition import BenchmarkDefinition


def compute_bundle(root: Path) -> dict:
    definition = BenchmarkDefinition.admit(json.loads((root / "benchmark.json").read_text()))
    definition.validate_input(json.loads((root / "input.json").read_text()))
    started_at = datetime.now(timezone.utc).isoformat()
    raw = root / "raw"
    raw.mkdir(exist_ok=True)
    results = []
    for intervals in definition.intervals:
        started = time.perf_counter()
        samples = []
        if definition.method == "poisson-1d":
            # Thomas elimination for the SPD tridiagonal finite-difference system.
            # The unknowns are the interior points; both boundary values are zero.
            h = 1.0 / intervals
            forcing = [math.pi ** 2 * math.sin(math.pi * i * h)
                       for i in range(1, intervals)]
            diagonal = [2.0] * (intervals - 1)
            rhs = [value * h * h for value in forcing]
            for i in range(1, len(rhs)):
                factor = -1.0 / diagonal[i - 1]
                diagonal[i] += factor
                rhs[i] -= factor * rhs[i - 1]
            interior = [0.0] * len(rhs)
            interior[-1] = rhs[-1] / diagonal[-1]
            for i in range(len(rhs) - 2, -1, -1):
                interior[i] = (rhs[i] + interior[i + 1]) / diagonal[i]
            solution = [0.0, *interior, 0.0]
        with (raw / f"samples-{intervals}.csv").open("w", newline="") as stream:
            writer = csv.writer(stream)
            if definition.method == "pi-midpoint":
                writer.writerow(("index", "x", "value"))
                for index in range(intervals):
                    x = (index + 0.5) / intervals
                    value = 4.0 / (1.0 + x * x)
                    samples.append(value)
                    writer.writerow((index, repr(x), repr(value)))
                estimate = math.fsum(samples) / intervals
            else:
                writer.writerow(("index", "x", "value", "forcing"))
                for index, value in enumerate(solution):
                    x = index / intervals
                    forcing_value = math.pi ** 2 * math.sin(math.pi * x)
                    writer.writerow((index, repr(x), repr(value), repr(forcing_value)))
                estimate = max(solution)
        results.append({"intervals": intervals, "estimate": estimate,
                        "elapsedSeconds": time.perf_counter() - started})
        print(f"n={intervals} estimate={estimate:.17g}", flush=True)
    result = {"schemaVersion": 1, "benchmarkId": definition.id,
              "benchmarkVersion": definition.version, "completed": True,
              "executionKind": "local-reference", "method": definition.method, "ranks": 1,
              "pythonVersion": platform.python_version(), "platform": platform.platform(),
              "startedAt": started_at, "finishedAt": datetime.now(timezone.utc).isoformat(),
              "runs": results}
    (root / "result.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    compute_bundle(parser.parse_args().directory.resolve())
