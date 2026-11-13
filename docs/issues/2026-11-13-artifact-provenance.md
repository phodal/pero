---
kind: issue
status: resolved
date: 2026-11-13
---

# Observable execution provenance for delivered artifacts

## Problem

The existing Host freezes exact artifact versions, hashes and explicitly linked
evidence, and automatically admits version 1 `.pero-run.json` sidecars. The
generic external-run wrapper records logs but only platform, architecture and
the wrapper Node version. It omits the invocation, pre-run code/input snapshots
and the computational interpreter/dependency observation. The Inspector exposes
linked files without a reproducible export or an explicit statement of missing
observations on older deliveries.

## Scope and owners

Extend the existing sidecar contract and artifact store, wrapper and production
Scientific Viewer Inspector. Keep execution, permission and computation with
their current owners. No second provenance database or execution lifecycle.
Receipts describe observed execution; they do not attest scientific acceptance.

Version 2 records actual command/arguments, terminal outcome, workspace-relative
output identity, and original paths for pre-run snapshots. Version 1 and legacy
deliveries remain readable without invented facts. The export pins the selected
output and linked evidence versions. Explicit replay requires an available
recorded interpreter/dependencies and verifies the resulting hash.

## Verification

Completed: receipt compatibility/outcome checks, actual local Python capture and
Host save/restart/version/failure/cancellation, production Inspector in Chromium,
and downloaded ZIP replay matching the selected historical output hash. The
recorder also retains no-output launch failures as deliverable reports. Unknown
and legacy artifacts explicitly retain missing observations.

Commands, observed screenshots, source versions and remaining platform scope:
[verification record](../fitness/artifact-provenance.md). Native, Electron shell,
signed packaging and scientific conclusions are separate acceptance scopes.
