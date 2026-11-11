---
kind: issue
status: in_progress
date: 2026-11-11
github_issue: 73
github_state: open
github_url: https://github.com/phodal/pero/issues/73
---

# Harness Skill catalog visibility and recovery

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

Scripted providers and the actual pinned official catalog
hook with mocked registration/snapshot/session boundaries require no credentials
or real-model spend. Full official runtime A/B, live-provider quality/usage,
Desktop/Native/package acceptance and dynamic discovery/precedence remain open.
This bounded increment does not close #73.
