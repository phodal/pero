---
kind: verification_report
date: 2026-11-13
---

# Observed artifact provenance and fixed-version reproduction

Source: `ad9047c8b` (capture/contract) and `76a40d514` (Inspector/export),
with the acceptance scripts in this record's commit. Checkout:
`/Users/phodal/workspaces/pero-science-work/p0-artifact-provenance`.
Platform: macOS arm64. No model requests, external deployment or paid compute.

## Owners and behavior

Version 2 of the existing `.pero-run.json` receipt adds invocation, terminal
process observations, workspace output identity and original code/input paths.
Host's existing artifact store freezes the receipt and evidence and verifies
their hashes. Version 1 receipts and older artifacts remain readable. The
delivery tool describes the recorder and automatic evidence admission; it does
not infer an unrecorded command from file content or claim to intercept every
computation.

The recorder retains direct script code and explicitly declared inputs before
execution. Python metadata comes from the selected command interpreter; installed
distributions are an observation, not a used-package claim or environment lock.
It copies no environment variables or package index credentials. Other
interpreters and implicit/transitive inputs require explicit observation or
remain unobserved. The current artifact format and size limits still apply.

The production Inspector now shows recorded outcome, invocation, observed Python
and installed package count, and missing observations. Its Code, Execution log,
Environment and Review tabs retain the existing exact-version navigation. The
export action uses the shared `export` icon and Button; the summary uses purpose
tokens and preserves text status independently of color. Long executable paths
wrap at 320px. No token or shared component API changed.

Exports contain only selected-version and linked-version retained bytes, hashes,
the original receipt, `reproduction.json` and a readable explanation. Complete v2
generated outputs can include an explicitly invoked `replay.mjs`; it restores
retained code/inputs in a fresh directory, runs the observed command and compares
the output SHA-256. It installs nothing. Absolute argument paths, system services
and unobserved files must remain available separately. Cancelled runs have no
automatic replay because cancellation timing was not captured. Wrapper reports
have no replay because child execution cannot recreate report timestamps.

## Commands and observations

All commands below ran from this checkout:

| Check | Observed result |
| --- | --- |
| `cargo test -p pero-contracts session_artifact --offline` | 3 passed; v1 compatibility and honest terminal observations |
| `cargo test -p pero-runtime session_artifacts --offline` | 3 passed; snapshots, version retention and workspace admission |
| `node --test scripts/record-external-run.test.mjs desktop/src/main/artifact-delivery.test.ts` | 7 passed; real processes and delivery transport |
| `npm --prefix apps/scientific-viewer test` | 35 passed, including 4 provenance/export tests and an actual exported Node replay |
| `npm --prefix apps/scientific-viewer run typecheck` | Passed |
| `node scripts/build/scientific-viewer.mjs` | Production bundle built |
| `node tests/runtime/session-artifacts.mjs` | Actual Host/MCP regression passed with ACP fixture |
| `node tests/runtime/artifact-provenance.mjs` | 13 checks passed against a freshly built Host and actual local Python |
| `node apps/scientific-viewer/test/artifact-provenance-browser.mjs` | 6 behavior groups passed in Chromium 156.0.8078.4 |

The Host run computes `sum=10`, then delivers `sum=40` under the same artifact ID.
Version 1 and its code, inputs, interpreter/package observation and logs remain
readable after all workspace sources are deleted and Host restarts. Partial
failure exits 7. A child catches SIGINT and exits 0, while its receipt stays
cancelled. SIGTERM is covered by the recorder subprocess test. ENOENT with no
output remains deliverable as a failed wrapper report with retained stderr.
Tampered evidence is rejected without publishing another artifact version.

The browser serves the actual frozen Host bytes through a substituted read-only
shell HTTP/context transport. It inspects the production Viewer, keyboard tabs,
old/new versions, export download, failure/cancellation/unknown states and light,
dark and 320px layouts. The downloaded version 1 ZIP executes the retained Python
code in a fresh directory and matches SHA-256:
`9caec7927aa872533072505f8298c823dcdf8ebcf932c2d793b4b6193677d61e`.
An altered retained code file is rejected before execution. The available
interpreter was Xcode Python 3.9.6; its observation listed 17 installed
distributions. The calculation uses only Python's standard library.

Current evidence is under ignored `test-results/artifact-provenance/`:
`result.json`, `catalog.json`, `snapshots.json`, `host-snapshots/`, and
`browser/{result.json,replay.log,tampered.log,retained-v1-reproduction.zip}`.
The result records the Host binary digest
`46a74b6de5d550ffc797515b5788eb9ac32d0aad8534e7b3e1d838ae460a5fd7`.
Screenshots were opened and inspected: retained version in light/dark, observed
environment, fixed narrow layout, failed stderr, cancelled stdout, no-output
failure and unknown provenance. These generated binary files are not committed.

## Remaining verification scope

`npm run check` stops at an absent generated
`web/src/reader-wasm/pero_reader_web` type binding in the clean checkout. The
affected Viewer typecheck passes. Theme, design, SDK token, locale and generated
contract checks pass separately; shared icons pass with
`PERO_GPUI_KIT_PATH=/Users/phodal/test/gpui-kit`. Cargo's incidental registry
resolution changes to `Cargo.lock` were discarded; no dependency change is part
of this work.

This establishes actual local capture, immutable retention, browser presentation
and fixed-version export replay. It does not establish Electron/Native shell
integration, a signed package, arbitrary dependency reconstruction, remote
execution, a real model choosing delivery, or scientific conclusion acceptance.
