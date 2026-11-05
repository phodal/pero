---
kind: issue
status: active
date: 2026-11-05
---

# Pinned uv downloads can prevent official benchmark assertions

The QEMU Alpine v2 correction and the later original
`large-scale-text-editing` trial both receive raw zero without executing their
official assertions. Their unchanged test scripts fail downloading the pinned
uv 0.9.5 release, then cannot source its environment or run uvx. The latter
records an interrupted HTTP/2 stream; the former records an empty reply. These
are verifier dependency failures, separate from candidate correctness and the
Alpine image's already repaired legacy APT setup.

Eighty-two of the 89 official task scripts use that same uv version. Later
zero-model paired transport controls download the identical asset successfully
with both HTTP/2 and HTTP/1.1; they do not prove a permanent protocol defect.

Preserve the running original cohort, all existing freezes and both observed
raw verdicts. Before changing a future correction adapter, verify in a fresh
official image that preinstalling the exact upstream uv 0.9.5 binaries lets the
unchanged test script execute real assertions. Keep TLS enabled, record the
upstream asset digest and actual installed version, and keep dependency
provisioning outside the official agent deadline. Do not modify tests, invent
rewards or count the control as candidate acceptance.

Evidence starts with `uv-asset-protocol-pair-control/` and the two retained
verifier stdout files under the full-04 artifact root. Any setup correction
must use new sources/freezes and separately labeled follow-up attempts.

## Cached dependency controls and activation

The separately versioned v3 adapter stages upstream uv 0.9.5 and CPython
3.13.9 archives through Harbor's file upload before dependency installation.
Both archives match GitHub's published SHA-256 digests. It installs uv/uvx
under the verifier's normal user path and warms the exact pytest 8.4.1 and
pytest-json-ctrf 0.3.5 environment with Harbor's bootstrap cache variables
unset. Setup remains outside the official agent deadline.

Fresh Debian 12 and Debian 11 controls deliberately disconnect GitHub after
setup. The unchanged official scripts execute all five text-editing assertions
and the one Alpine assertion respectively. They fail as expected on bare
images without candidate outputs; these controls establish runner readiness,
not candidate correctness. A real Harbor trial additionally verifies the v3
upload/install ordering, the staged digests and actual uv/uvx versions. It also
executes all five unchanged assertions with GitHub disconnected. All controls
make zero provider requests. An earlier control's unresolved credential
environment placeholder is retained as a rejection before execution.

`verifier-uv-v3-control/freeze.json` binds the assets, source and successful
controls. `pipeline-v10-freeze.json` binds the downstream controllers at their
first activation; the earlier prepared-but-unarmed manifest is preserved,
including its two subsequent reporting/audit edits. Only idle downstream
waiters are replaced. The original running queue, old adapters, official inputs
and earlier results stay intact. Subsequent corrections and the independent
service diagnostic use v3 after all 89 baseline verdicts exist; the four
already completed early corrections retain their original adapters. No new
paid QEMU attempt is scheduled. Functional outcomes remain pending.

At the 69-verdict checkpoint, five original verifiers have a missing runner
command and no reported functional assertions. The newly completed Ubuntu
`merge-diff-arc-agi-task` trial records 20 responses and 179,968 tokens, ends
normally and passes its three provided examples, but its official uv download
cannot connect to GitHub; uvx is absent. This is not evidence that hidden
tests pass. `analysis-merge-diff-verifier-bootstrap.json` binds the raw result,
native calls and verifier sources. Dynamic correction selection includes this
case without changing the original outcome.
