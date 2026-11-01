# Lab

A simulation-only Pero App for liquid-handling experiments: freeze a specification,
propose a typed protocol, run PyLabRobot Chatterbox, attach observations, evaluate,
and compare a linked revision. No physical robot is discovered or connected.

## Open in Pero

From a prepared Pero checkout:

```sh
npm ci --prefix apps/lab
node scripts/build/apps.mjs --app lab
```

The workbench product includes `lab`. Alternatively install the built `apps/lab`
folder using **Apps → Install from folder**, enable it, and open **Lab**.
The existing Host provisions the manifest's `pylabrobot==0.2.1` in its managed
App Python environment. A missing or incompatible engine is visible; no fake
fallback is used. Preparing packages needs network access. Python 3.12 is the
acceptance target; current executed test scope is in `docs/fitness/lab.md`.

## Two-trial walkthrough

Create an experiment with target fraction `0.5`, tolerance `0.03`, and budget `4`.
Its fixed deck has 300 µL virtual dye in A1 and 300 µL water in A2; B1 is the target.
Save the initial protocol with a rationale, validate, and run it. It moves 90 µL
dye and 110 µL water into B1, predicts `0.45`, and returns both tips.

In Results, choose **Use synthetic fixture**, then **Evaluate**. The disclosed
illustrative sensor multiplies the prediction by `0.9`: the observation is `0.405`,
and the absolute target error `0.095` fails the frozen tolerance. Revise this
trial to transfer `111.11111111111111` µL dye and `88.88888888888889` µL water,
keeping the same target and total volume. With this same synthetic fixture the
observed fraction is `0.5` within floating-point precision. The results view
reports lower, equal or higher error honestly. These numbers are a demonstration
of feedback, **not measured optical performance or a scientific discovery**.

Instead of a synthetic fixture, import UTF-8 CSV (`well,value,unit`) or a JSON
array of those fields. Units must be `fraction`, wells unique, values finite in
[0,1], and input <=256 KiB. The original bytes, SHA-256, provenance and normalized
measurements persist together. Imported data is user-supplied, not device-attested.
Each trial gets one immutable observation asset; a different asset needs a new
trial. Exports include all state events, measurements, checks and review notes.

**Ask Agent** fills the existing shared Host Composer with the experiment identity
and constraints. It does not send the prompt or start a second Agent. The manifest's
`lab-step` tool exposes read/propose/validate/simulate/synthetic/observe/evaluate/
compare/cancel actions. A proposal must carry the frozen input hash, typed steps,
parent trial ID (or null), and rationale. The backend enforces budgets and policy.
`synthetic` always labels the data synthetic. Review/import are not declared Agent
tools. Shared UI approval policies still apply; this is not a security-isolated or
blind scientific evaluator. Review notes are not cryptographically signed identities.

## Evidence and recovery

The Host owns `PERO_APP_DATA`, the backend process and API credentials. The App
stores atomic JSON experiment records. Every operation has a durable started event
before dispatch and a confirmed event after tracker reconciliation. An exception
with an outstanding effect is unknown, not success. Cancellation retains confirmed
progress. Restart marks interrupted runs unknown and never replays them. Reading or
exporting history has no execution effect; retrying a completed start is idempotent.

Pure `domain.advance` owns virtual mixture transitions. PyLabRobot owns its resource
trackers; the adapter checks their observed volumes and tip state against the expected
transition. It never overwrites a discrepant tracker state to make a check pass.
The two evaluations are bookkeeping/model checks, not independent physical sensors.

The PyLabRobot version is deliberately pinned, not claimed to be the latest. The
adapter targets the `v0.2.1` source APIs. See the real-library acceptance gate before
claiming that version works in a new runtime. Upstream: https://github.com/PyLabRobot/pylabrobot

## Development and verification

```sh
python -m pip install --only-binary=:all: -r apps/lab/requirements.txt
LAB_REQUIRE_PYLABROBOT=1 python -m unittest discover -s apps/lab/test -p 'test_*.py' -v
npm --prefix apps/lab run test:ui
npm --prefix apps/lab run typecheck
python -m pip install playwright==1.56.0
python -m playwright install chromium
python apps/lab/test/browser_smoke.py --bundle
```

The browser script requires the built `dist/` entry. It uses a test parent and
loopback proxy with real App code/backend; **it is not Electron/Host acceptance**.
`--fixture` substitutes an explicitly labeled test-only executor; it cannot prove
PyLabRobot integration. The default uses the actual pinned library and fails if
missing. `LAB_REQUIRE_PYLABROBOT=1` also makes missing dependencies fail unit CI.
Screenshot/receipt artifacts are under `test-results/lab` and uploaded by the
`Lab App acceptance` workflow. A configured workflow is not a passed run.

No device backend, arbitrary Python executor, 3D collision model, optical calibration,
biological protocol, Project artifact registration or remote Worker integration is
included. Simulation completion, verification PASS and an explicit UI review remain
three distinct facts. See Issue #69 for the full acceptance scope and remaining
Desktop/real-provider gates.
