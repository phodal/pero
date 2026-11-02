---
kind: incident
status: resolved
---

# Control Lab goal fixture omitted the installed App

The real Host goal test timed out waiting for `session_ready` after App Agent
Plugin integration made scoped session creation resolve the installed App and
its declared panel. The fixture supplied a simulated Desktop backend and the
`control-lab/main` scope but no installed App. Host correctly emitted
`session_error: App is not installed`; the test reported only stderr and hid it.

The fixture now seeds a minimal isolated App declaring that panel. Its backend
remains simulated; the Host, ACP process, frozen goal activation and MCP writes
remain real. No solver, provider, network service or production App backend is
introduced. Wait failures include Host events and surface session errors
immediately rather than increasing the timeout.

Verification: rebuilt Host from `08f248cc` with the cached pinned GPUI recipe.
Before the fixture change, the test reproduced the missing-App session error
and 10-second timeout. After it, the same test passed in approximately 118 ms.

Related regressions passed: all eight Control Lab goal/App Agent Plugin unit and
real-Host goal cases, the explicit fixture-mode Host launcher test, and
`tests/runtime/app-agent-plugins.mjs` (plugin dependency/skill/MCP assembly,
non-main panels, unsupported HTTP refusal, and disable revocation).

## Same stale setup in the Host protocol contract

Full CI `41438025872`, core job `125252594284`, exposed the same uninstalled
`fixture/main` scope in `tests/contracts/host.mjs`. Its preference expectations
also omitted the default `research_projects: []` field added by local research
projects. This produced three whole-object preference mismatches followed by a
`session_created` timeout; production validation was behaving as designed.

With the rebuilt `08f248cc` Host, the unchanged fixture reproduced all four
failures locally. Seeding a minimal isolated fixture App/main and including the
actual default research-project collection makes the same command pass, observing
40 of 91 declared event kinds. Invalid-preference preservation, restart restore,
exact App scope, context, permission, cancellation and deletion assertions remain
intact. No timeout, production gate or runtime setting behavior was weakened.
