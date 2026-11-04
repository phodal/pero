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
reloaded while idle. Both recovered agents subsequently execute and receive raw zero. Their
official verifiers hit the same obsolete APT dependencies and never execute
pytest; a raw verdict is therefore distinct from functional verification.

## Recovery job identity

The first recovery launch is rejected before creating a trial because Harbor
requires the original job configuration. Changing only the setup adapter also
changes each trial's configuration identity; rewriting job metadata would not
make completed trials match and could rerun the 56 judged tasks. Preserve the
rejected launch and original job metadata. Run missing task slots in separate
recovery jobs, join results by manifest task, reject duplicates, and retain
each original result hash. This affects setup admission and reporting only;
the selected agent binary and official task inputs remain frozen.

## Official verifier dependency control

A disposable copy of the unchanged QEMU image uses the signed Debian archive
for bullseye and bullseye-security, with the freshness exception scoped to those
archived source entries. Normal TLS and repository signature checks stay enabled.
The unchanged official test script can then install curl and sshpass, but its
pinned uv 0.9.5 GitHub asset download ends with an empty reply. No pytest or CTRF
is produced. The outer script's exit zero is not a passed verification.
`debian-archive-control/` retains the command, copied official-test hashes and
full control log. No archived source, baseline container, frozen adapter or
selected result is changed; an archive-enabled rerun has not been launched.

A later read-only pinned-address control reaches the exact official uv 0.9.5
asset from both host and guest with ordinary TLS (HTTP 200). A new disposable
archive control uses that GitHub-only address mapping inside its container;
benchmark VMs, original trials and frozen setup adapters remain unchanged.
Its functional runner outcome is recorded separately before any actual rerun.

The GitHub-address archive control executes the unchanged official verifier and
produces CTRF: one failed test in 0.12 seconds on the intentionally unsolved bare
image. This proves runner startup, not candidate correctness. There are zero
provider requests. Freeze a separate v2 adapter combining the archive setup and
container-only GitHub mapping; verify its exact generated ACP dependency command
and the unchanged official verifier together before any real follow-up. Retain
the original v1 adapter and both raw-zero candidate results unchanged.

The exact v2-generated dependency command now passes in another fresh official
image: the ACP runner imports under Python 3.12, then the unchanged official
verifier installs its pinned Python/pytest environment and executes its one
functional test. The unsolved control image fails that test in 0.11 seconds as
expected. `debian-bootstrap-v2-control/freeze.json` binds nine supporting files;
all nine original v1 freeze entries remain unchanged. TLS and APT signatures
remain enabled. Actual QEMU candidate reruns are still pending after baseline
completion; they are explicitly included in the queued correction selection.
