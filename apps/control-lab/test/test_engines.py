"""Numerical solver oracles are independent formulas, never fixture waveforms."""
import importlib.util
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from control_lab.engines import (EngineCancelled, EngineError, EngineUnavailable,
                                _read_table, _run_ngspice, capabilities, execute)


CONTROL = importlib.util.find_spec("control") is not None
NGSPICE = shutil.which("ngspice") is not None and os.name != "nt"
REQUIRED = os.environ.get("CONTROL_LAB_REQUIRE_SOLVERS") == "1"


class EngineAvailabilityTests(unittest.TestCase):
    def test_required_engines_are_real(self):
        if not REQUIRED:
            self.skipTest("Set CONTROL_LAB_REQUIRE_SOLVERS=1 for the no-skip solver acceptance gate")
        self.assertTrue(CONTROL, "python-control must be installed for solver acceptance")
        self.assertTrue(NGSPICE, "ngspice CLI must be installed for solver acceptance")

    def test_unavailable_solver_never_returns_an_oracle_as_evidence(self):
        with tempfile.TemporaryDirectory() as directory, patch("control_lab.engines.shutil.which", return_value=None):
            with self.assertRaises(EngineUnavailable):
                execute("ngspice", "rc", {}, {}, Path(directory), threading.Event())

    def test_unknown_solver_is_unavailable(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(EngineUnavailable):
                execute("analytic", "rc", {}, {}, Path(directory), threading.Event())


@unittest.skipUnless(CONTROL, "real python-control is unavailable")
class PythonControlOracles(unittest.TestCase):
    def run_solver(self, model, parameters=None, scenario=None):
        with tempfile.TemporaryDirectory() as directory:
            result = execute("python-control", model, parameters or {}, scenario or {},
                             Path(directory), threading.Event())
            self.assertTrue((Path(directory) / "waveforms.json").is_file())
            return result

    def test_golden_reference_responses(self):
        cases = (("p-golden", lambda t: .5 * (1-math.exp(-2*t))),
                 ("pi-golden", lambda t: 1-math.exp(-t)))
        for model, oracle in cases:
            with self.subTest(model=model):
                result = self.run_solver(model, {"horizon": 10, "samples": 1001})
                curve = result["series"][0]
                error = max(abs(y-oracle(t)) for t, y in zip(curve["x"], curve["y"]))
                self.assertLess(error, 1e-11)
                self.assertTrue(result["internalStable"])

    def test_pi_preserves_unreduced_internal_characteristic(self):
        result = self.run_solver("pi-golden")
        # The I/O response reduces to 1/(s+1), but the interconnected plant and
        # integrator contain two states. Their full denominator is retained.
        self.assertEqual(result["metrics"]["characteristicDenominator"], [1., 2., 1.])
        self.assertEqual(len(result["metrics"]["internalPoles"]), 2)

    def test_robust_pid_and_disturbance_use_declared_scenario(self):
        parameters = dict(kp=2, ki=1, kd=.2, n=12, horizon=15, samples=1501)
        nominal = self.run_solver("robust-pid", parameters)
        changed = self.run_solver("robust-pid", parameters, dict(gain=.8, damping=1.2))
        self.assertEqual([s["name"] for s in nominal["series"]],
                         ["reference", "disturbance", "controlEffort", "disturbanceControlEffort"])
        # A filtered derivative has a finite direct feedthrough at the unit step.
        self.assertAlmostEqual(nominal["series"][2]["y"][0], parameters["kp"]+parameters["kd"]*parameters["n"])
        self.assertNotEqual(nominal["series"][0]["y"], changed["series"][0]["y"])
        self.assertEqual(len(nominal["metrics"]["characteristicDenominator"]), 5)

    def test_unstable_internal_dynamics_are_not_called_stable(self):
        for kp in (0, 1):
            with self.subTest(kp=kp):
                result = self.run_solver("robust-pid", dict(kp=kp, ki=0, kd=0, horizon=1), dict(damping=-1))
                self.assertFalse(result["internalStable"])
                self.assertEqual(len(result["metrics"]["characteristicDenominator"]), 3)
                if kp == 0:
                    # Zero reference transfer hides the unstable plant from an
                    # I/O-only pole check, but not from internal stability.
                    self.assertTrue(all(y == 0 for y in result["series"][0]["y"]))

    def test_rc_reference_and_frequency_oracles(self):
        result = self.run_solver("rc", dict(r=1000, c=1e-6, horizon=.01, samples=1001))
        curve, gains, phases = result["series"]
        self.assertLess(max(abs(y-(1-math.exp(-t/.001))) for t, y in zip(curve["x"], curve["y"])), 1e-11)
        for f, actual in zip(gains["x"], gains["y"]):
            self.assertAlmostEqual(actual, -10*math.log10(1+(2*math.pi*f*.001)**2), places=10)
        for f, actual in zip(phases["x"], phases["y"]):
            self.assertAlmostEqual(actual, -math.degrees(math.atan(2*math.pi*f*.001)), places=10)

    def test_cancellation_prevents_numerical_result(self):
        cancel = threading.Event()
        cancel.set()
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(EngineCancelled):
                execute("python-control", "p-golden", {}, {}, Path(directory), cancel)


@unittest.skipUnless(NGSPICE, "real ngspice is unavailable")
class NgspiceOracles(unittest.TestCase):
    def test_active_filter_frequency_window_tracks_component_time_constant(self):
        with tempfile.TemporaryDirectory() as directory:
            result = execute("ngspice", "active-filter",
                             dict(r=10000, c=1e-6, gain=2, horizon=.2, samples=1001),
                             {}, Path(directory), threading.Event())
            gain = result["series"][1]
            f0 = 1 / (2 * math.pi * .01)
            self.assertLessEqual(gain["x"][0], f0 / 999)
            self.assertGreaterEqual(gain["x"][-1], f0 * 999)
            # Fixed 10 Hz once mistook resonant gain for DC gain here. The
            # scaled low-frequency observation must approach the actual K=2.
            self.assertAlmostEqual(10 ** (gain["y"][0]/20), 2, places=5)

    def test_actual_rc_and_sallen_key_transfer(self):
        for model, r, c, gain in (("rc", 1000, 1e-6, 1), ("active-filter", 1000, 1e-7, 1.586)):
            with self.subTest(model=model), tempfile.TemporaryDirectory() as directory:
                result = execute("ngspice", model, dict(r=r, c=c, gain=gain, horizon=.01, samples=2001),
                                 {}, Path(directory), threading.Event())
                self.assertTrue(result["internalStable"])
                self.assertTrue((Path(directory) / "circuit.cir").is_file())
                response, gains, phases = result["series"]
                tau = r*c
                for f, actual in zip(gains["x"], gains["y"]):
                    z = 2j*math.pi*f*tau
                    expected = 1/(1+z) if model == "rc" else gain/(z*z+(3-gain)*z+1)
                    self.assertAlmostEqual(actual, 20*math.log10(abs(expected)), places=5)
                for f, actual in zip(phases["x"], phases["y"]):
                    z = 2j*math.pi*f*tau
                    expected = 1/(1+z) if model == "rc" else gain/(z*z+(3-gain)*z+1)
                    self.assertAlmostEqual(actual, math.degrees(math.atan2(expected.imag, expected.real)), places=5)
                if model == "rc":
                    error = max(abs(y-(1-math.exp(-t/tau))) for t, y in zip(response["x"], response["y"]))
                    self.assertLess(error, 2e-4)
                else:
                    self.assertLess(abs(response["y"][-1]-gain), 1e-4)
                    zeta = (3-gain)/2
                    wd = math.sqrt(1-zeta*zeta)/tau
                    def oracle(t):
                        return gain*(1-math.exp(-zeta*t/tau)*(math.cos(wd*t)+zeta/math.sqrt(1-zeta*zeta)*math.sin(wd*t)))
                    error = max(abs(y-oracle(t)) for t, y in zip(response["x"], response["y"]))
                    self.assertLess(error, 2e-4)

    @unittest.skipUnless(CONTROL, "real python-control is unavailable")
    def test_rc_cross_solver_evidence_uses_same_physical_parameters(self):
        import numpy as np
        parameters = dict(r=1000, c=1e-6, horizon=.01, samples=2001)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            control = execute("python-control", "rc", parameters, {}, root / "control", threading.Event())
            spice = execute("ngspice", "rc", parameters, {}, root / "spice", threading.Event())
            a, b = control["series"][0], spice["series"][0]
            # Compare only the shared observed interval; never extrapolate an
            # absent initial sample or discard the separate analytic oracles.
            samples = [(x, y) for x, y in zip(a["x"], a["y"]) if b["x"][0] <= x <= b["x"][-1]]
            error = max(abs(y-float(np.interp(x, b["x"], b["y"]))) for x, y in samples)
            self.assertLess(error, 2e-4)


class NgspiceProcessEvidenceTests(unittest.TestCase):
    def test_malformed_tables_are_failed_not_empty_successes(self):
        cases = ("time v(out)\n", "time v(out)\n0 nan\n1 1\n", "time v(out)\n0 0 5\n1 1\n")
        for value in cases:
            with self.subTest(table=value), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "transient.tsv"
                path.write_text(value)
                with self.assertRaises(EngineError):
                    _read_table(path, 2)

    @unittest.skipIf(os.name == "nt", "Unix executable fixture")
    def test_cancel_and_timeout_reap_the_owned_process(self):
        for action, error in (("cancel", EngineCancelled), ("timeout", EngineError)):
            with self.subTest(action=action), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                executable = root / "solver"
                # An observable readiness file avoids timing assumptions about
                # child startup. One fake lives at the external process seam.
                executable.write_text(f"#!{sys.executable}\nimport os,time\nopen('ready','w').write(str(os.getpid()))\nwhile True: time.sleep(.1)\n")
                executable.chmod(0o755)
                cancel = threading.Event()
                failures = []
                def run():
                    try:
                        _run_ngspice(str(executable), root, cancel, timeout=1.5)
                    except Exception as exc:
                        failures.append(exc)
                worker = threading.Thread(target=run)
                worker.start()
                import time
                deadline = time.monotonic()+1
                while not (root / "ready").exists() and time.monotonic() < deadline:
                    cancel.wait(.01)
                self.assertTrue((root / "ready").exists(), "solver never reported readiness")
                pid = int((root / "ready").read_text())
                if action == "cancel":
                    cancel.set()
                worker.join(timeout=3)
                self.assertFalse(worker.is_alive())
                self.assertEqual(len(failures), 1)
                self.assertIs(type(failures[0]), error)
                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)


if __name__ == "__main__":
    unittest.main()
