---
kind: issue
status: resolved
date: 2026-11-11
github_issue: 73
github_state: closed
github_url: https://github.com/phodal/pero/issues/73
---

# Harness behavior audit and Skill catalog recovery

The #73 fitness matrix described the 2026-11-01 implementation, although current
plugin Skills already support user-only invocation and bounded post-compaction
body restoration. That stale description obscured the actual remaining gap:
relevance summaries existed only in tool schemas, without durable attributed
catalog publication, withdrawal or surface-aware restoration.

This is the canonical active local tracker for #73 (no prior active #73 tracker
was found). The older resolved extraction, deferred-invocation and duplicate-body
incidents remain separate historical records. GitHub #73 and merged #96 were
rechecked on 2026-11-11; neither old comments nor test passes establish full parity.

Implement `catalogReminder` in harness/go/skills using the existing registration,
PreStep, PostCompact and Session surface. Match the official publication lifecycle
for the approved mount-time catalog. Bound message bytes, retain paging and the
legacy digest read protocol, and withdraw guidance when the exact tool is hidden
or a pending invocation denies it. No new directory roots, resource execution,
default permissions, scheduler, market admission/UI or Host assembly changes.

Migration adds one user-role attributed catalog to older sessions on continuation;
no persistence format migration. This increases context alongside schemas, without
a claim of token savings. Plugin body recovery remains under its existing owner.

Fixed references, capability matrix, same-input script and full contract:
[Harness parity verification](../fitness/harness-behavior-parity.md).

## Verification scope

The bounded implementation is complete at `8bedf1b6235cb96a5f5a47c538882120b5ba9fe4`.
All 38 Harness packages pass race tests with local Python 3.12; the five related
packages also pass race/vet, and Skills Bazel plus Gazelle checks pass. The shared
10-step fixture passes the actual pinned official catalog hook. Baseline tool
mounting fails the new catalog/provider/compaction regressions as expected.
Full commands, environment qualification and log names are in the fitness record.

Scripted providers and the actual pinned official catalog hook with mocked
registration/snapshot/session boundaries require no credentials or real-model
spend. The initial catalog increment alone did not complete the wider audit.

## Seven-item acceptance completed

The follow-up starts from master `7ff7c637732606286940b50bafee4d0d3b47a2f5`
in a new isolated checkout. It checks the original issue's seven deliverables,
not an expanded demand for full runtime equivalence. The fitness record now
contains a numbered acceptance matrix, separate native/MCP/Host-App/auto-review
authority evidence, additional core capability rows and trace dimensions with
explicit historical-artifact/usage limits.

Actual missing deliverables were bounded:

- Connect the pinned actual official hook to the existing full/daily/manual AST
  job and retain its JSON receipts; ordinary Go/Bazel fixtures remain unchanged.
- Make the existing App transport regression invoke an advertised alias before
  any describe request, then separately exercise generic describe/write.
- Correct stale README approval/MCP claims and SOURCE's legacy-versus-plugin
  scope. No runtime authorization or tool registration changed.

All 38 Go packages pass race tests; the official hook passes ten fixed steps;
App transport/lifecycle passes nine tests; CI mode/required-job contracts pass
nine tests with one unrelated existing Darwin archive skip. Local docs/JSON,
diff and file limits pass. Hosted CI for the new commits is not yet observed.

Resolution: the auditable behavior matrix and all seven original deliverables
are complete. The coordinator publishes this record and closes #73 after
integration and independent rechecks of App transport, CI routing and the
pinned official hook. Dynamic official discovery/precedence is an intentional
scope difference; full-runtime/live-provider/platform/scientific comparisons
remain explicitly unverified, not extra closure conditions. No #161 rerun,
paid model request, new scheduler, persistence owner or default permission.
