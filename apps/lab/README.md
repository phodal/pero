# Lab

Color Mixing is a simulation-only experiment workbench: freeze a goal, propose
bounded liquid-handling operations, validate, dispatch real PyLabRobot Chatterbox
commands, attach observations, independently evaluate, and revise a linked trial.

## Install and open

From the repository root, install the existing Desktop prerequisites, then:

```sh
npm ci
npm ci --prefix apps/lab
npm run build                 # includes Lab and the shared reader/Host
npm start
```

Lab is bundled in Pero. It can also be installed through **Apps → Install from
folder → apps/lab**, enabled and opened. Build first; installing does not build
source. The Host prepares an isolated CPython 3.12 environment and exact manifest
dependencies. First preparation needs network access. Failed preparation remains
visible; retry through the Host, not an alternate fake backend. An explicit
interpreter must be a Python 3.12 isolated venv. No external robot or paid model
is required. Data lives in Host-provided `PERO_APP_DATA`, outside the App package.

## Walkthrough

1. Freeze the default 100 µL / 0.5 red-fraction objective. Inspect A1 (virtual red),
   A2 (diluent), B1 (target), all 96 wells and 96 tips.
2. Save the example protocol, validate, then **Run simulation**. Eight operations
   use two fresh tips to transfer 50 µL from each source to B1.
3. In Results attach the explicitly **synthetic** fixture and evaluate. Its fixed
   +0.1 fraction bias makes this baseline FAIL (observed 0.6, target 0.5).
4. Revise from feedback, retain the parent link and explain the discrepancy.
   Transfer 40 µL red and 60 µL diluent; run, attach the same fixture and evaluate.
   The illustrative fixture now reports 0.5. Compare uses the actual parent;
   unchanged or worse candidates report no improvement, not invented success.
5. Alternatively import your CSV/JSON observation **before** evaluating. Original
   bytes, SHA-256, source and fraction units are retained, with no implicit unit
   conversion. Once observation or verification is attached it is immutable.
6. Record a review decision, export JSON, close and reopen Lab. Saved evidence is
   read, never executed again. A stopped in-flight attempt becomes `unknown`.

CSV: `well,value,unit` header, e.g. `B1,0.5,fraction`. JSON: an array such as
`[{"well":"B1","value":0.5,"unit":"fraction"}]`. Maximum 64 KiB, 96 unique wells.
Missing observations yield INCONCLUSIVE, not a predicted measurement. Export
includes original asset bytes in base64, frozen inputs, events, state snapshots,
engine versions, checks, comparison, decisions and explicit limitations.

**Approve goal and ask Agent** binds the frozen experiment and composes a draft in the existing Host Chat. Submit there to use
Host ACP and the declared bounded App tools. No custom conversation, model,
scheduler, credentials or arbitrary Python execution exists in this App.

## Runtime and evidence boundary

Tested adapter: `pylabrobot==0.2.2`, Python 3.12; dependencies are pinned in
`requirements.txt` and `app.json`. The adapter instantiates only
`LiquidHandlerChatterboxBackend`. It does not scan for or connect hardware.
[Official Chatterbox guide](https://docs.pylabrobot.org/stable/user_guide/machine-agnostic-features/using-the-visualizer.html)
and [release](https://pypi.org/project/PyLabRobot/0.2.2/) describe the upstream API.
PLR volume/tip trackers are compared to each pure-domain post-state before it is
committed. PLR does not calculate dye fractions. That deterministic,
volume-weighted dye model is illustrative, not physical/optical/biological truth.
Returned tips remain physically present in PLR's rack but are consumed by Lab's
single-use policy. Cancellation is between steps; an uncertain in-step result is
not replayed. No automatic retry or resume execution is available.

Execution completed, verification PASS, and UI acceptance are separate. A review
records `actor: user-interface`, `human_identity_verified: false`: a direct UI
interaction is not proof of a human identity. Scripted AppUse DOM clicks cannot
approve, but this is not a machine-wide identity/authentication guarantee.
Simulation PASS never authorizes physical execution.

## Verification

```sh
python3.12 -m venv /tmp/pero-lab-python
/tmp/pero-lab-python/bin/pip install --only-binary=:all: -r apps/lab/requirements.txt
/tmp/pero-lab-python/bin/python -m unittest discover -s apps/lab/test -p 'test_*.py' -v
npm --prefix apps/lab run typecheck
node --test apps/lab/test/*.test.ts
PERO_APP_PYTHON=/tmp/pero-lab-python/bin/python node tests/e2e/lab.mjs
```

The Desktop test uses a scripted ACP fixture, **not a real provider**, and real
Host/PLR execution. GUI tests belong to the existing full/daily CI tier; ordinary
PR CI retains fast Linux domain/adapter/evidence tests. See
[actual verification and gaps](../../docs/fitness/lab.md).
