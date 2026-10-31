"""Real, bounded solver adapters; no numerical fallback for missing engines.

The App owns typed experiment validation. These adapters translate those values
once into solver inputs and return numerical evidence, never a PASS verdict.
"""
from dataclasses import dataclass
from importlib import metadata, util
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time

from .experiments import MAX_EVIDENCE_SAMPLES, sample_reservation


class EngineError(RuntimeError):
    """A run did not produce valid solver evidence."""


class EngineUnavailable(EngineError):
    pass


class EngineCancelled(EngineError):
    pass


@dataclass(frozen=True)
class Grid:
    horizon: float
    samples: int

    @classmethod
    def from_parameters(cls, parameters, default_horizon=12.0):
        horizon = float(parameters.get("horizon", default_horizon))
        samples = int(parameters.get("samples", 1201))
        if not math.isfinite(horizon) or horizon <= 0 or not 21 <= samples <= 10001:
            raise EngineError("The solver grid needs a positive horizon and 21–10001 samples")
        return cls(horizon, samples)


def capabilities():
    result = []
    for name, module in (("python-control", "control"),):
        present = util.find_spec(module) is not None
        try:
            version = metadata.version(module) if present else None
        except metadata.PackageNotFoundError:
            version = "unknown"
        result.append(dict(engine=name, available=present, version=version,
                           error=None if present else "Install the locked control dependencies in the App Python environment"))
    executable = shutil.which("ngspice")
    error = None
    version = None
    if os.name == "nt":
        error = "ngspice runs are disabled on Windows until descendant cleanup is verified"
    elif not executable:
        error = "ngspice is not available on the App process PATH"
    else:
        try:
            probe = subprocess.run([executable, "-v"], capture_output=True, text=True,
                                   timeout=3, check=False)
            version = next((line.strip(" *") for line in probe.stdout.splitlines()
                            if "ngspice-" in line.lower()), "unknown")
            if probe.returncode:
                error = "ngspice version probe failed"
        except (OSError, subprocess.TimeoutExpired) as exc:
            error = f"ngspice cannot start: {exc}"
    result.append(dict(engine="ngspice", available=error is None, version=version, error=error))
    return result


def _series(name, values, output, unit="1", x_unit="s"):
    xs = [float(value) for value in values]
    ys = [float(value) for value in output]
    if len(xs) != len(ys) or not xs or not all(math.isfinite(v) for v in xs + ys):
        raise EngineError(f"Solver returned incomplete or nonfinite {name} evidence")
    if any(a >= b for a, b in zip(xs, xs[1:])):
        raise EngineError(f"Solver returned unordered {name} coordinates")
    return dict(name=name, x=xs, y=ys, unit=unit, xUnit=x_unit)


def _python_control(model, parameters, scenario, directory, cancelled):
    try:
        import control as ct
        import numpy as np
    except ImportError as exc:
        raise EngineUnavailable("python-control and its locked dependencies are required; no fallback was run") from exc
    if cancelled.is_set():
        raise EngineCancelled("Cancelled before computation")
    grid = Grid.from_parameters(parameters, .01 if model == "rc" else 12.0)
    t = np.linspace(0, grid.horizon, grid.samples)
    if model == "rc":
        tau = parameters.get("r", 1000.0) * parameters.get("c", 1e-6)
        tau *= scenario.get("componentScale", 1.0) ** 2
        system = ct.tf([1], [tau, 1])
        response = ct.step_response(system, timepts=t, squeeze=True)
        f = np.logspace(1, 5, 201)
        frequency = ct.frequency_response(system, 2 * np.pi * f, squeeze=True)
        series = [_series("reference", response.time, response.outputs),
                  _series("frequencyGain", f, 20 * np.log10(frequency.magnitude), "dB", "Hz"),
                  _series("frequencyPhase", f, np.rad2deg(frequency.phase), "deg", "Hz")]
        denominator = [tau, 1]
    else:
        kp, ki, kd = (float(parameters.get(key, default)) for key, default in
                      (("kp", 1), ("ki", 1), ("kd", .1)))
        n = float(parameters.get("n", 12))
        plant_den = [1.0, 2.0 * scenario.get("damping", 1.0), 1.0]
        plant_num = [float(scenario.get("gain", 1.0))]
        if model == "p-golden":
            plant_den, plant_num, kp, ki, kd = [1, 1], [1], 1, 0, 0
        elif model == "pi-golden":
            plant_den, plant_num, kp, ki, kd = [1, 1], [1], 1, 1, 0
        elif model != "robust-pid":
            raise EngineError(f"Unsupported python-control model: {model}")
        # Build only the controller states actually enabled. Never minreal the
        # resulting interconnection: canceled unstable plant/controller modes
        # remain in the characteristic polynomial used for internal stability.
        controller = ct.tf([kp], [1])
        if ki:
            controller += ct.tf([ki], [1, 0])
        if kd:
            controller += ct.tf([kd * n, 0], [1, n])
        plant = ct.tf(plant_num, plant_den)
        denominator = np.polyadd(np.polymul(plant.den[0][0], controller.den[0][0]),
                                 np.polymul(plant.num[0][0], controller.num[0][0]))
        closed = ct.feedback(plant * controller, 1)
        disturbance = ct.feedback(plant, controller)
        effort = ct.feedback(controller, plant)
        response = ct.step_response(closed, timepts=t, squeeze=True)
        disturbed = ct.step_response(disturbance, timepts=t, squeeze=True)
        controlled = ct.step_response(effort, timepts=t, squeeze=True)
        series = [_series("reference", response.time, response.outputs),
                  _series("disturbance", disturbed.time, disturbed.outputs),
                  _series("controlEffort", controlled.time, controlled.outputs),
                  _series("disturbanceControlEffort", response.time, -response.outputs)]
    poles = np.roots(denominator)
    stable = bool(np.all(np.real(poles) < -1e-10))
    if cancelled.is_set():
        raise EngineCancelled("Cancelled during computation; result not accepted")
    output = dict(series=series, metrics={"internalPoles": [dict(real=float(p.real), imag=float(p.imag)) for p in poles],
                                        "characteristicDenominator": [float(v) for v in denominator],
                                        "dependencyVersions": {name: metadata.version(name) for name in ("numpy", "scipy", "control")}},
                  diagnostics=["Continuous-time SISO; unit reference and unit plant-input disturbance start at t=0"],
                  artifacts=["solver-input.json", "waveforms.json"], engineVersion=ct.__version__, internalStable=stable)
    (directory / "solver-input.json").write_text(json.dumps(dict(engine="python-control", model=model,
        parameters=parameters, scenario=scenario), sort_keys=True), encoding="utf-8")
    (directory / "waveforms.json").write_text(json.dumps(output, allow_nan=False), encoding="utf-8")
    return output


def _run_ngspice(executable, directory, cancelled, timeout=20.0):
    """Own exactly one CLI child. Reap it on every exit, including cancellation."""
    with (directory / "stdout.log").open("wb") as stdout, (directory / "stderr.log").open("wb") as stderr:
        process = subprocess.Popen([executable, "-n", "-b", "circuit.cir"], cwd=directory,
                                   stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr)
        started = time.monotonic()
        try:
            while process.poll() is None:
                if cancelled.wait(.025):
                    raise EngineCancelled("ngspice computation cancelled")
                if time.monotonic() - started >= timeout:
                    raise EngineError(f"ngspice exceeded its {timeout:g}-second computation deadline")
            if process.returncode:
                raise EngineError(f"ngspice exited with status {process.returncode}; inspect retained logs")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


def _read_table(path, columns, max_rows=MAX_EVIDENCE_SAMPLES):
    if not path.is_file():
        raise EngineError(f"ngspice did not produce {path.name}; inspect retained logs")
    # wrdata has a single header and whitespace-separated finite numeric rows.
    rows = []
    with path.open(encoding="utf-8") as table:
        for index, line in enumerate(table):
            if not line.strip():
                continue
            parts = line.split()
            try:
                values = [float(value) for value in parts]
            except ValueError:
                if index == 0:
                    continue
                raise EngineError(f"Malformed ngspice table {path.name}") from None
            if len(values) != columns or not all(math.isfinite(v) for v in values):
                raise EngineError(f"Incomplete ngspice table {path.name}")
            if len(rows) >= max_rows:
                raise EngineError(f"ngspice table {path.name} exceeds the {max_rows}-point evidence limit; raw output is retained")
            rows.append(values)
    if len(rows) < 2:
        raise EngineError(f"Empty ngspice table {path.name}")
    return list(zip(*rows))


def _ngspice(model, parameters, scenario, directory, cancelled):
    if os.name == "nt":
        raise EngineUnavailable("ngspice is gated on Windows until descendant cleanup is verified")
    executable = shutil.which("ngspice")
    if not executable:
        raise EngineUnavailable("ngspice executable is missing from PATH; no fallback was run")
    if cancelled.is_set():
        raise EngineCancelled("Cancelled before computation")
    grid = Grid.from_parameters(parameters, .005)
    scale = float(scenario.get("componentScale", 1))
    r = float(parameters.get("r", 1000)) * scale
    c = float(parameters.get("c", 1e-7 if model == "active-filter" else 1e-6)) * scale
    k = float(parameters.get("gain", 1.586)) if model == "active-filter" else 1.0
    dt = grid.horizon / (grid.samples - 1)
    if model == "active-filter":
        components = f"R1 in n1 {r:.17g}\nR2 n1 n2 {r:.17g}\nC1 n1 out {c:.17g} IC=0\nC2 n2 0 {c:.17g} IC=0\nEamp out 0 n2 0 {k:.17g}"
        denominator = [(r*c)**2, (3-k)*r*c, 1.0]
        center_frequency = 1 / (2 * math.pi * r * c)
        frequency_start, frequency_stop = center_frequency / 1000, center_frequency * 1000
        diagnostics = ["Equal-component Sallen–Key lowpass with ideal algebraic VCVS gain K; no rail, bandwidth, slew-rate or real-device guarantee",
                       "Zero capacitor initial conditions; unit input applied at t=0; adaptive transient sample times retained"]
    elif model == "rc":
        components = f"R1 in out {r:.17g}\nC1 out 0 {c:.17g} IC=0"
        denominator = [r*c, 1.0]
        frequency_start, frequency_stop = 10.0, 100000.0
        diagnostics = ["Passive RC lowpass; zero capacitor initial condition and unit input applied at t=0"]
    else:
        raise EngineError(f"Unsupported ngspice model: {model}")
    netlist = f"""Control Lab generated {model}; numeric parameters only
Vinput in 0 DC 1 AC 1
{components}
.options reltol=1e-7 abstol=1e-12 vntol=1e-9
.control
set wr_singlescale
set wr_vecnames
set numdgt=17
tran {dt:.17g} {grid.horizon:.17g} 0 {dt:.17g} uic
wrdata transient.tsv v(out)
ac dec 50 {frequency_start:.17g} {frequency_stop:.17g}
wrdata frequency.tsv db(v(out)) ph(v(out))
quit
.endc
.end
"""
    (directory / "circuit.cir").write_text(netlist, encoding="ascii")
    _run_ngspice(executable, directory, cancelled)
    if cancelled.is_set():
        raise EngineCancelled("Cancelled before accepting ngspice evidence")
    limit = sample_reservation('ngspice', grid.samples)
    t, y = _read_table(directory / "transient.tsv", 2, limit)
    f, gain, phase = _read_table(directory / "frequency.tsv", 3, limit)
    if t[-1] < grid.horizon * .999 or f[-1] < frequency_stop * .999 or f[0] > frequency_start * 1.001:
        raise EngineError("ngspice returned a truncated analysis window")
    import numpy as np
    poles = np.roots(denominator)
    version_probe = subprocess.run([executable, "-v"], capture_output=True, text=True, timeout=3, check=False)
    version = next((line.strip(" *") for line in version_probe.stdout.splitlines() if "ngspice-" in line.lower()), "unknown")
    return dict(series=[_series("reference", t, y, "V"),
                        _series("frequencyGain", f, gain, "dB", "Hz"),
                        _series("frequencyPhase", f, [v*180/math.pi for v in phase], "deg", "Hz")],
                metrics={"internalPoles": [dict(real=float(p.real), imag=float(p.imag)) for p in poles],
                         "characteristicDenominator": denominator, "idealDcGain": k},
                diagnostics=diagnostics, artifacts=["circuit.cir", "stdout.log", "stderr.log", "transient.tsv", "frequency.tsv"],
                engineVersion=version, internalStable=bool(np.all(np.real(poles) < -1e-10)))


def execute(engine: str, model: str, parameters: dict[str, float], scenario: dict[str, float],
            directory: Path, cancelled: threading.Event) -> dict:
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    if engine == "python-control":
        return _python_control(model, parameters, scenario, directory, cancelled)
    if engine == "ngspice":
        return _ngspice(model, parameters, scenario, directory, cancelled)
    raise EngineUnavailable(f"Unknown solver engine: {engine}")
