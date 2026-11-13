---
kind: issue
status: in_progress
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

Pending: pure receipt outcome compatibility checks; actual local Python runs and
Host save/restart/version/failure/cancellation; production Inspector in browser;
export replay and exact output comparison. Native and signed packaging are
separate acceptance scopes.
