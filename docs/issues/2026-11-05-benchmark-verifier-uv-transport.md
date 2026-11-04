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
