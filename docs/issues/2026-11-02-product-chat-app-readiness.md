---
kind: incident
status: in_progress
date: 2026-11-02
---

# Product Chat prepares a session before its App is ready

Desktop App Use run [41439456959](https://github.com/phodal/pero/actions/runs/41439456959)
failed the retained startup draft identity assertion. Its SHA-256-verified
`desktop-app-use-3b6c05666d6fba465b8e22fb9c28a761f4cb01ec` artifact
(`15b22022a8baa7d772c90d4c7990f83e632064106db6943f5925f24e0113be78`)
shows the original thread closed with an empty session ID and error
“An App environment is being prepared; retry when installation finishes”.
A second thread was idle. This was not an obsolete identity expectation.

Product initialized Chat on Host/Wasm readiness while App listing/resolution
still held the Host App store lock. Automatic session creation needed that same
store for its scoped plugin snapshot and was rejected. A later App context
update opened a replacement draft for the closed conversation.

Product now waits for its selected App's existing `apps_opened` signal before
initializing Chat's Agent/history state. The pre-Host draft still renders and
remains editable; neither its identity nor its App scope is replaced. This does
not block the Host input loop, retry a failed request, or change App ownership.
The Desktop acceptance retains the original identity/session/scope assertions
and additionally requires that no failed startup conversation was left behind.

Actual Desktop validation must run in authorized CI; local GUI execution is not
authorized. The original run also hung in its unbounded `app.close()` teardown after
capturing the failure, until the existing 360-second wrapper terminated it. The
fixture now uses the existing bounded cleanup for the owned Electron process: normal close still
has to succeed; a cleanup deadline remains a failure, and only the verified
private process group can be terminated. The artifact cannot establish which
Electron/Host shutdown component stalled, so no production shutdown change is
claimed.

Non-GUI regression executes the real bundled Product shell against renderer/Host
ports: all six readiness orderings, wrong App/panel completion, already-ready
Host, Chat reload and visible App error/retry. The original shell fails these
checks; the corrected shell passes. The original Desktop identity assertion
remains the end-to-end acceptance gate.

## Selection changes during startup

Review of the initial gate found that its App-ready boolean survived a selector
or App-link navigation. If App A resolved before Chat loaded, selecting App B
and then completing Chat initialization could consume A's readiness while B
was still opening. Readiness now records the resolved App/panel and is cleared
by both selection paths before publishing the new Chat context. A late response
for the previous App/panel cannot initialize the current selection.

The actual-shell non-GUI regression covers App A ready → select B → Chat ready
→ late A response → matching B response for the selector, App links, and a
same-App different-panel link. All three fail on the original boolean gate and
pass with scope-bound readiness. This changes no Host locks, queues or draft
identity rules.

## Nondefault panel navigation

Review found that App links selected their requested panel locally, but the
Product open bridge forwarded only the App name. Main therefore opened the
configured entry or first panel; its completion could not satisfy readiness for
a different selected panel. The bridge now forwards an optional panel through
Product selection. Omission retains existing defaults, included-App validation
remains in Product, and DesktopApps still checks the panel against the manifest.
Retry also retains the selected panel. Non-GUI regression exercises actual shell
and preload requests for default/nondefault panels before completing readiness;
actual Desktop rendering remains a CI acceptance boundary.

## Actual Desktop evidence

Full CI [41454820123](https://github.com/phodal/pero/actions/runs/41454820123)
on PR head `a0e2877667efd51e3467fef4abd11684abe80e98` passed App Use job
`125312339115`. Artifact `13145569909` has SHA-256
`3650b43da88193847641dc6659678151c98b43912dc2360161be0488bbe4c897`.
The original draft identity, one-thread count, App scope and resulting fixture
session assertions passed; the process exited successfully without timeout.
This establishes the startup race fix, not the later nondefault-panel forwarding
change. It is scripted App Use, not scientific execution or real-provider inference.
