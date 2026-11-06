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

## 2026-11-02: strict shutdown failure after completed acceptance

Full run [41460888869](https://github.com/phodal/pero/actions/runs/41460888869),
App Use job `125333787421`, failed the existing 30-second normal Electron close
deadline. Artifact `13150206084` was SHA-256 verified as
`c46ce175485e381ec83ebc914cf68d56e5c1b50c84788fa1433c26d4a558db4f`.
It contains the completed result with all eleven checks, zero browser errors,
an idle original conversation with no pending permission, and capture receipts.
Thus this occurrence is a teardown failure, not an earlier assertion masked by
cleanup. The previous current-head App Use run had passed.

The successful test path deleted its runtime log before entering cleanup, so
the artifact cannot distinguish a blocked Product quit callback, Electron exit,
or Playwright waiting for process pipes to close. No production shutdown fix is
yet supported by this evidence.

The acceptance fixture now passively records Product/window quit events, Node
resource types and uncaught-exception details, plus test-owned process exit vs
close events and pipe status. It saves runtime/shutdown evidence before normal
close and after cleanup. The existing deadline, private-process-group safety
check, forced-cleanup failure and disposable-profile cleanup remain unchanged.
An acceptance failure plus a normal-close failure is surfaced together rather
than discarding the original failure. Diagnostic write failures cannot bypass
normal close or disposable-profile removal, and remain visible alongside other
failures. Existing owned-close behavioral tests and acceptance-script syntax
checks pass; no GUI or model/scientific execution was performed for this diagnosis. A new CI run can localize the shutdown phase; it
must not be described as a blind rerun or proof that shutdown is repaired.


### Diagnostic run: SDK selection contract and disposed process handle

Run `41467927447`, App Use job `125359837407`, reached normal Electron quit
without the earlier close deadline: before-quit at `15:17:48.337Z`, window-closed
and will-quit at `.346Z`, then node-exit and quit with code 0 at `.347Z`.
Artifact `13153963472` was verified against SHA-256
`6fbdf746fd90e38c112dd1f0d626085831e56e3f0b91dc83ffa381b1a0100823`.
This does not establish the cause of the earlier intermittent shutdown failure.

This run failed first because the SDK Select now exposes a named button with
`data-value`, while the narrow covered-App check still queried a native combobox.
The retained screenshot shows the correct Perturbation analysis selection. The
fixture now reads both exact named controls through the current SDK contract,
retaining the exact mode/input ID and before/after equality assertions.

A second diagnostic error was retained alongside that functional timeout:
Playwright disposes its Electron object on close, so calling `app.process()`
afterward threw before the final shutdown receipt could be saved. The fixture
now retains its owned child-process handle immediately after launch and uses it
for both event listeners and final status. Normal close and cleanup remain strict;
no timeout or production behavior changed. Existing owned-close behavioral tests,
script syntax and diff checks pass; local GUI/provider execution was not used.

## 2026-11-06 Native recurrence

The Native follow-up profile reproduces the same App-store preparation rejection
in an untouched new-chat view while a Paper conversation dock is restored. The
scoped draft starts before App catalog/environment preparation completes; the
result becomes a red session error even though no prompt has been submitted.
Host now reports this transient rejection as session_preparing rather than
session_error. ChatPanel retains the original draft and queued prompt in
AwaitingApp, with a neutral preparation notice. App catalog/open completion
(including a failed App operation releasing the store) resumes only these
waiting drafts through the existing preparation path; Host still validates the
App and its grants. Already running, failed and authentication states are not
reset by readiness signals. Genuine execution errors remain visible.

Validation: Native state tests cover preparation-only resume and preservation
of running/authentication/closed states. Native UI/Host builds, 44 Host tests,
27 chat-ui tests and Wasm checks passed. An isolated Native event fixture
confirmed neutral waiting, unchanged thread/title and retained unsent input
after App completion; no model prompt was sent. Original preview startup using
the rebuilt real Host no longer showed this banner. This does not establish
all App API operations as completion signals or resolve the separate historical
Electron shutdown investigation above.

## PR #139: shared recovery for standalone Chat

Review found that App completion resumed waiting sessions only in Workbench.
Standalone Chat forwards Host events directly to ChatPanel, so the same transient
preparation event left its original draft in AwaitingApp with no recovery path.
The completion handling now belongs to ChatPanel::receive, shared by both shells;
Workbench no longer owns a separate resume hook. The existing preparation path
retains the draft, queued prompt and Host access checks.

The standalone Product regression intercepts a new scoped conversation preparation at
the real shell bridge, then verifies that a completion signal recovers the same
conversation and preserves unsent input without submitting a model request.
Validation results are recorded in packages/pero-design/VERIFICATION.md.
