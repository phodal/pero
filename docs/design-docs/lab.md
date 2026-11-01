# Lab: bounded experiments, not robot control

Issue: https://github.com/phodal/pero/issues/69

`apps/lab` follows the existing local App ownership boundary. A React AppProvider
frame supplies the SDK API/shared-Chat bridge to a small DOM workbench. The Python
backend owns frozen experiments, candidates and observations. Rust Host remains
responsible for process lifecycle, environment preparation, tokens, Agent sessions
and approval. No new scheduler, credential store or remote execution service exists.

```text
SDK panel / Host lab-step tool
  → authenticated loopback App API
  → Experiment store (frozen input + bounded candidate lineage)
  → pure Protocol/LabState transition + preflight
  → pinned PyLabRobot Chatterbox operations
  → actual library tracker receipt ↔ predicted transition
  → durable events + immutable observation asset
  → frozen-policy evaluator → explicit review / next candidate
```

The model uses a fixed 96-well plate, one channel and fresh-tip tracking. Volumes
are µL; the virtual dye fraction is dimensionless. A homogeneous ideal-mixture
assumption is explicit. The synthetic sensor's gain of 0.9 is disclosed, not hidden
as a benchmark or presented as empirical data. Hardware movement, collisions,
calibration and biological inference are out of scope.

Preflight checks the entire protocol against an immutable initial state. Only an
actual no-hardware adapter is available in production. Each running trial starts
from that initial state; a revision links to the previous trial's evidence, not its
physical deck. A failed check changes no committed state. After execution starts,
the persisted last-confirmed prefix is retained if cancellation or failure occurs.
Unknown attempts are never blindly replayed. The store serializes local execution
because PyLabRobot tracking flags are process-global.

The observation schema intentionally excludes an Agent-supplied verdict. Target,
tolerance, trial budget and input identity are frozen. The evaluator consumes
saved evidence and reports PASS, FAIL or INCONCLUSIVE; absence of B1 data is not a
pass. An explicit UI review is separately persisted and cannot accept a non-PASS.
The local backend and trusted App code can access both phases; this is methodological
separation, not a blind/security-isolated evaluator. Local reviews carry no signed
user identity. Generic trusted Host permissions are not a laboratory safety system.

Paper/Data/Virtual Cell remain separate Apps. This slice stores Lab evidence locally
and exports JSON; it does not claim Project/Task/Artifact or remote Worker integration.

## Review and acceptance

The deterministic executor fixture exists only in tests and labels itself as such.
The real-library gate imports and exercises PyLabRobot; missing dependencies fail in
acceptance mode. The browser suite uses the actual bundle/backend in a test parent,
not a fake screenshot. Desktop lifecycle and Host ACP App-use need their own execution
records; a browser pass must not be relabeled Desktop or real-model acceptance.
See [verification](../fitness/lab.md) and [App README](../../apps/lab/README.md).
