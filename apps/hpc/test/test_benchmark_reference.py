import contextlib
import csv
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


BENCHMARK = Path(__file__).resolve().parents[1] / "benchmarks" / "local-reference"
sys.path.insert(0, str(BENCHMARK))
from compute import compute_bundle
from prepare import prepare_bundle
from verify import verify_bundle


class NumericalReferenceTests(unittest.TestCase):
    def test_result_bundle_verification(self):
        # Alter observable numerical evidence, not the checker or its implementation.
        cases = (
            ("healthy", "pass"),
            ("healthy-poisson", "pass"),
            ("poisson-residual", "fail"),
            ("incorrect-estimate", "fail"),
            ("incorrect-sample", "fail"),
            ("non-finite-sample", "incomplete"),
            ("missing-samples", "incomplete"),
            ("truncated-samples", "incomplete"),
            ("altered-threshold", "incomplete"),
            ("unfinished-computation", "incomplete"),
        )
        for scenario, expected in cases:
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / "bundle"
                poisson = scenario in ("healthy-poisson", "poisson-residual")
                prepare_bundle(root, BENCHMARK.parent / "poisson1d" / "benchmark.json"
                               if poisson else None)
                with contextlib.redirect_stdout(io.StringIO()):
                    compute_bundle(root)
                samples = root / "raw" / ("samples-128.csv" if poisson else "samples-2048.csv")
                result_path = root / "result.json"
                if scenario == "poisson-residual":
                    rows = list(csv.reader(io.StringIO(samples.read_text())))
                    rows[65][2] = str(float(rows[65][2]) + 0.00001)
                    with samples.open("w", newline="") as stream:
                        csv.writer(stream).writerows(rows)
                elif scenario == "incorrect-estimate":
                    data = json.loads(result_path.read_text())
                    data["runs"][1]["estimate"] = 3.0
                    result_path.write_text(json.dumps(data))
                elif scenario in ("incorrect-sample", "non-finite-sample"):
                    rows = list(csv.reader(io.StringIO(samples.read_text())))
                    rows[1][2] = "3.0" if scenario == "incorrect-sample" else "nan"
                    with samples.open("w", newline="") as stream:
                        csv.writer(stream).writerows(rows)
                elif scenario == "missing-samples":
                    samples.unlink()
                elif scenario == "truncated-samples":
                    samples.write_text("\n".join(samples.read_text().splitlines()[:-1]) + "\n")
                elif scenario == "altered-threshold":
                    path = root / "benchmark.json"
                    data = json.loads(path.read_text())
                    data["thresholds"]["absoluteErrorMax"] = 100
                    path.write_text(json.dumps(data))
                elif scenario == "unfinished-computation":
                    data = json.loads(result_path.read_text())
                    data["completed"] = False
                    result_path.write_text(json.dumps(data))
                report = verify_bundle(root)
                self.assertEqual(report["status"], expected, report)
                if scenario == "healthy":
                    self.assertLess(report["metrics"]["fineAbsoluteError"], 1e-7)
                    self.assertAlmostEqual(report["metrics"]["convergenceRatio"], 4.0, places=5)
                if scenario == "healthy-poisson":
                    self.assertLess(report["metrics"]["residualMax"], 1e-9)
                if scenario == "poisson-residual":
                    residual_check = next(check for check in report["checks"]
                                          if check["id"] == "residual")
                    self.assertFalse(residual_check["passed"])

    def test_copied_bundle_reverifies_without_reframe_or_saved_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "bundle"
            prepare_bundle(root)
            with contextlib.redirect_stdout(io.StringIO()):
                compute_bundle(root)
            (root / "verification.json").write_text('{"status":"fail"}')
            copied = Path(temporary) / "copied"
            shutil.copytree(root, copied)
            response = subprocess.run(
                [sys.executable, "-I", str(copied / "verify.py"), str(copied)],
                capture_output=True, text=True, timeout=10)
            self.assertEqual(response.returncode, 0, response.stderr)
            self.assertEqual(json.loads(response.stdout)["status"], "pass")
            self.assertEqual(json.loads((copied / "verification.json").read_text())["status"], "fail")

    def test_preparation_preserves_existing_run(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "previous-result").write_text("retained")
            with self.assertRaisesRegex(ValueError, "never overwritten"):
                prepare_bundle(root)
            self.assertEqual((root / "previous-result").read_text(), "retained")


if __name__ == "__main__":
    unittest.main()
