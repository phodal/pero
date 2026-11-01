# PC-Gym research slice — actual verification receipt

Date: 2026-11-01. Base inspected: `85453242733bef06b34f210bc22aa00b34291280`.
Scope: fixed-case Python/Skill increment reviewed in an isolated full Pero worktree,
based on the supplied `pero-pcgym-research` implementation bundle.

## Executed

```sh
python3.12 -m unittest discover -s apps/paper-agent/test -p test_pcgym_reproduction.py -v
python3.12 -m compileall -q apps/paper-agent/backend/paper_agent/pcgym*.py
/private/tmp/pero-pcgym-tests/bin/python -m unittest discover -s apps/paper-agent/test -p 'test_*.py' -v
```

**28 PC-Gym tests passed** under Python 3.12.11, including additional
subcases for invalid values/identity/state. Tests use explicitly synthetic inputs.
They cover:

- Separate episode/sample denominators, inclusive bounds and all three policies.
- Non-finite/bool values, wrong units, missing data, duplicate policies and wrong attempts.
- Frozen Spec, Python/dependency/implementation identities, no ad hoc tolerance field.
- Explicit formulas/grains/denominators bound to the Spec digest; modified definitions refused.
- Static source evidence/line positions, changed blob and missing source refusal.
- Original byte-digest checks, reload without replay, side-effect-free approval refusal.
- A real separate Python CLI checker process.
- Receipt mismatch returns CLI exit code 2 and refuses export before creating an archive.
- Export into a new directory, no-Agent/no-solver recheck, rejection of changed output
  even under `python -O` (no reliance on optimizable assertions).

The full Paper Python suite reported **76 tests, OK (skipped=1)** in a temporary
Python 3.12.11 environment with the existing PDF dependencies (`pypdfium2==5.0.0`,
`Pillow==12.0.0`) and NumPy 2.5.4 for the manual callback probe. The first attempt
without PDF dependencies failed; after preparing that test environment it passed.
The PC-Gym suite needs only the standard library and is added to the existing
Linux core CI job; a remote CI result is not claimed here.
The skipped case requires Windows process-handle lifecycle behavior.

A real sparse PC-Gym checkout at the pinned commit passed source/blob validation
and the four static audit checks through `prepare --profile smoke --seed 0`.
Preparation returned exit code 2 / `readiness=BLOCKED` because scientific packages
were absent. This checks the real preparation path, not scientific execution.

A separately rerun real-upstream callback probe used exact Git blob
`284967c39bfd7b444378810373cb805f9584c914` / SHA256
`f6e7bd98e52c45fa9420b495c95a63dcf3d63e4f095768f12103e5701eb25bca`.
Reproducible command: `python apps/paper-agent/test/manual/pcgym_callback_probe.py /approved/pc-gym/pc-gym_paper/constraint_showcase/custom_reward.py`.
With self-authored synthetic callback inputs (324 K inside [321,327], zero tracking
and move cost), the original function returned 0 without its constraint flag and
-0.0036 with it. This is a callback check, NOT a PC-Gym environment, DDPG training,
a Table 6 replay, or evidence about the authors' unpublished experiments.

## Not executed / not established

- Full PC-Gym/SB3 training, fresh oracle rollouts, or any comparison with original
  Table 6 raw trajectories/checkpoints. Scientific packages were missing; the
  temporary test environment was not prepared as a scientific execution environment.
- Full cross-App Pero regression, Rust/Go compilation, packaged App/Host integration, real
  provider execution, Desktop UI, screenshots or production installation.
- Safe execution of arbitrary untrusted repositories; same-account evidence is
  not attestation or blind evaluation.
- Exact author environment/seeds/commit, a confirmed Table 6 metric interpretation,
  or scientific replication PASS.

## Required before declaring the full feature complete

Run actual engine smoke and full experiments in an explicitly prepared environment;
record failed runs, complete denominators and adaptations. Wire the existing
Paper/Host ownership and real source anchors, then exercise Desktop cancellation,
restart, evidence navigation and export. Keep #77/#79 open until their own complete
acceptance criteria are satisfied. Do not count the tests above as those gates.
