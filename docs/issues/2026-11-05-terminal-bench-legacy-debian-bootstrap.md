---
kind: issue
status: active
date: 2026-11-05
---

# Harbor ACP bootstrap upgrades obsolete Debian image dependencies

Both QEMU tasks fail before agent execution and make zero provider requests.
Their official images use Debian 11. Harbor's generic ACP dependency command
unconditionally installs/upgrades Python, curl and CA packages; cached package
URLs now return 404. These are setup failures, not coding failures or official
zero rewards. Preserve their raw results separately from the registry incident.

The local-binary ACP runner can bootstrap with the image's existing wget, tar
and CA bundle, then provision its supported Python through the same uv installer.
Use that path only for Debian 11 with those prerequisites present. Keep normal
bootstrap elsewhere. Verify TLS normally and leave official image tags, task
sources, tests and pinned agent binaries unchanged. Record and freeze this
adapter-only setup correction for recovery and any affected strict follow-up.

Evidence belongs under `debian-bootstrap-failure-20261104T1847/` in the full-04
artifact root, with a separate bootstrap control. Completion still requires an
actual official verdict after agent execution for both tasks.

## Bootstrap control

The adapter-only path succeeds in a fresh copy of the unchanged official
`qemu-alpine-ssh:20251031` image. The installed ACP runner imports successfully
under Python 3.12, with normal TLS validation and zero provider requests. The
wrapper, actual bootstrap command/log, recovery configuration and image
identities are hash-bound in `debian-bootstrap-control/freeze.json`. An initial
analysis-only final print probe has a quoting error; its successful dependency
installation and failed check are retained separately before the corrected
fresh control passes. The original Harbor source remains unchanged.

The two zero-request results are archived under their own incident. Recovery
uses the original agent binary and limits, changing only the dependency adapter;
strict timeout follow-ups use the same setup correction. Both controllers are
reloaded while idle. The two actual task verdicts remain pending.
