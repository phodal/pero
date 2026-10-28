/* OpenPero interactive research example — synthetic data, no external services.
 * Model: x'' + 2 ζ ω₀ x' + ω₀² x = 0; x(0) = 1, x'(0) = 0.
 * All displayed metrics should be taken from run(), not hard-coded in the UI.
 */
(function (root) {
  "use strict";

  const METHOD_VERSION = "rk4-oscillator/1.0.0";
  const DATA_VERSION = "synthetic-initial-state/1.0.0";
  const NATURAL_FREQUENCY_HZ = 0.4;
  const OMEGA_0 = 2 * Math.PI * NATURAL_FREQUENCY_HZ;
  const INITIAL_POSITION = 1;
  const INITIAL_VELOCITY = 0;
  const BASELINE = Object.freeze({ damping: 0.08, dt: 0.1, duration: 10 });
  const VARIANT = Object.freeze({ damping: 0.22, dt: 0.1, duration: 10 });

  function checkedNumber(value, fallback, minimum, maximum, name) {
    const result = value === undefined ? fallback : value;
    if (typeof result !== "number" || !Number.isFinite(result)) {
      throw new TypeError(name + " must be a finite number.");
    }
    if (result < minimum || result > maximum) {
      throw new RangeError(name + " must be between " + minimum + " and " + maximum + ".");
    }
    return result;
  }

  function derivative(x, v, damping) {
    return [v, -2 * damping * OMEGA_0 * v - OMEGA_0 * OMEGA_0 * x];
  }

  function advance(x, v, h, damping) {
    const k1 = derivative(x, v, damping);
    const k2 = derivative(x + h * k1[0] / 2, v + h * k1[1] / 2, damping);
    const k3 = derivative(x + h * k2[0] / 2, v + h * k2[1] / 2, damping);
    const k4 = derivative(x + h * k3[0], v + h * k3[1], damping);
    return [
      x + h * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6,
      v + h * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6
    ];
  }

  function analytical(t, damping) {
    const alpha = damping * OMEGA_0;
    const omegaD = OMEGA_0 * Math.sqrt(1 - damping * damping);
    const b = (INITIAL_VELOCITY + alpha * INITIAL_POSITION) / omegaD;
    const cos = Math.cos(omegaD * t);
    const sin = Math.sin(omegaD * t);
    const envelope = Math.exp(-alpha * t);
    const carrier = INITIAL_POSITION * cos + b * sin;
    return [
      envelope * carrier,
      envelope * (-alpha * carrier - INITIAL_POSITION * omegaD * sin + b * omegaD * cos)
    ];
  }

  function run(options) {
    const input = options === undefined ? {} : options;
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("run() expects an options object.");
    }
    const damping = checkedNumber(input.damping, BASELINE.damping, 0, 0.95, "damping");
    const requestedDt = checkedNumber(input.dt, BASELINE.dt, 0.001, 0.25, "dt");
    const duration = checkedNumber(input.duration, BASELINE.duration, 1, 60, "duration");
    const stepCount = Math.ceil(duration / requestedDt);
    if (stepCount > 50000) {
      throw new RangeError("This browser example supports at most 50,000 integration steps.");
    }
    // Use a uniform grid ending exactly at duration; dt never exceeds requestedDt.
    const dt = duration / stepCount;
    const time = [];
    const reference = [];
    const solution = [];
    const velocity = [];
    const referenceVelocity = [];
    const absoluteError = [];
    const energy = [];
    let x = INITIAL_POSITION;
    let v = INITIAL_VELOCITY;
    let sumSquaredError = 0;
    let maxError = 0;

    for (let i = 0; i <= stepCount; i += 1) {
      const t = i === stepCount ? duration : i * dt;
      const exact = analytical(t, damping);
      const error = Math.abs(x - exact[0]);
      time.push(t);
      reference.push(exact[0]);
      referenceVelocity.push(exact[1]);
      solution.push(x);
      velocity.push(v);
      absoluteError.push(error);
      energy.push(0.5 * (v * v + OMEGA_0 * OMEGA_0 * x * x));
      sumSquaredError += error * error;
      maxError = Math.max(maxError, error);
      if (i < stepCount) {
        const next = advance(x, v, dt, damping);
        x = next[0];
        v = next[1];
      }
    }

    const parameters = {
      damping: damping,
      dampingRatio: damping,
      dt: dt,
      requestedDt: requestedDt,
      duration: duration,
      naturalFrequencyHz: NATURAL_FREQUENCY_HZ,
      naturalAngularFrequency: OMEGA_0,
      initialPosition: INITIAL_POSITION,
      initialVelocity: INITIAL_VELOCITY
    };
    return {
      time: time,
      reference: reference,
      solution: solution,
      velocity: velocity,
      referenceVelocity: referenceVelocity,
      absoluteError: absoluteError,
      energy: energy,
      rmse: Math.sqrt(sumSquaredError / time.length),
      maxError: maxError,
      finalEnergyRatio: energy[energy.length - 1] / energy[0],
      sampleCount: time.length,
      parameters: parameters,
      methodVersion: METHOD_VERSION,
      dataVersion: DATA_VERSION,
      metadata: {
        kind: "synthetic-demonstration",
        title: "Underdamped oscillator: RK4 versus analytical reference",
        equation: "x'' + 2*zeta*omega0*x' + omega0^2*x = 0",
        method: "Classical fourth-order Runge–Kutta; uniform time grid",
        referenceMethod: "Closed-form underdamped solution using identical parameters and initial conditions",
        parameterMeaning: "damping is the dimensionless damping ratio zeta, not a dimensional damping coefficient",
        units: { time: "s", position: "normalized amplitude", velocity: "normalized amplitude/s", damping: "dimensionless", angularFrequency: "rad/s", energy: "normalized energy for unit mass" },
        provenance: "Generated in this browser from the stated differential equation; no measured or published research dataset is used.",
        reproducibility: "Deterministic input, no random sampling; unchanged parameters reproduce the same numerical arrays.",
        scientificScope: "Numerical agreement with an analytical model is checked; this does not validate a real-world physical system.",
        methodVersion: METHOD_VERSION,
        dataVersion: DATA_VERSION
      }
    };
  }

  root.OpenPeroExperiment = Object.freeze({
    run: run,
    presets: Object.freeze({ baseline: BASELINE, variant: VARIANT }),
    methodVersion: METHOD_VERSION,
    dataVersion: DATA_VERSION
  });
})(typeof window !== "undefined" ? window : globalThis);
