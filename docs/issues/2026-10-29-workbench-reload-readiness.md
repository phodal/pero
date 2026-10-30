---
kind: issue
status: verifying
date: 2026-10-29
---

# Workbench replay acceptance starts before renderer readiness

## Observation

Standard CI [40912932662](https://github.com/phodal/pero/actions/runs/40912932662),
Linux desktop job `123585444660`, tested merge `85474b1624b15181242725e1b5bff60b71a34f7c`
for head `73dfa11eeebf0e79050fadfa75f97aa1e84710e9`. The workbench fixture passed
streaming, cancellation, permission and 1,000-chunk checks, then its reload replay
hook remained undefined during the default five-second poll. The renderer
reported no page errors and had received the Agent catalog but no history.

Artifact `12914443796` contains seven screenshots, not a startup/event timeline.
Its ZIP SHA-256 is
`d84797955298abf80964b4820ab5efa29c7cfcbb205926bf099f9e4fcc4cfd5c`.
The relevant test, bootstrap, main/preload, App Use, Host and roadmap sources are
byte-identical to incoming master `dc75f949`; the new delayed-replay test came
from master commit `739ffc6`. This is not evidence of a sandbox runtime change.

## Sequencing correction and limits

`web/src/bootstrap.ts` requests `list_agents` only after asynchronous Wasm and
GPUI initialization; the GPUI readiness loop itself permits 30 seconds. The test
started its five-second replay poll immediately after `page.reload()`, before
its existing renderer-ready/loading-removed wait. Move that unchanged wait
before the unchanged replay poll. The interception remains installed before
reload, and the real replay must still be held while the user opens a new draft.
All restored-history, draft-identity and route assertions remain strict.

Readiness does not require releasing replay: the main IPC command writes to Host
without awaiting a replay acknowledgement, the interception returns normally,
and bootstrap removes loading after `apps_list`, not after history delivery.
No product path, timeout value, retry or UI behavior changes.

A bounded test-only receipt records counts/first relative arrival times for
`agents`, `workspace`, `local_roadmap` and `replay` at the main-process forwarding
boundary, renderer readiness and replay release. It also counts only the known
`Invalid Host event` error category. No event payload, environment, credential,
URL or arbitrary error text is added to that receipt. Absence at this boundary
cannot by itself distinguish missing Host output from an earlier main handler.

## Verification

An actual merged Host and the exact ACP fixture completed all five prompt
scenarios, then replayed 1,037 events (189,517 JSON characters) three times through
actual `DesktopAppUse.accept`: 35.6–41.2 ms from request to replay, with no throw.
The empty-history path took 21.4–23.6 ms. These local measurements do not explain
the CI timing. The failed snapshot's workspace string may come from the Agent
catalog itself; it does not establish receipt of the separate workspace event.

JavaScript syntax and bounded receipt/hold behavior checks pass. Executing the
actual old/new wait regions against a deterministic virtual startup schedule
(ready at 6,000 ms, within the existing 30-second readiness budget) reproduces
the old five-second failure and passes with the reordered wait. This checks the
sequencing contract, not the historical CI timing. Local Electron acceptance
was not run: this environment has neither an installed Electron
binary nor Xvfb. The specific CI failure cause remains unproven; a new actual CI
receipt is required before declaring this incident resolved.

## Actual CI acceptance and finite startup follow-up

At head `1c6d8821d846aa0c4dabc36bb70fed737fba1c98`, tested merge
`4328572c2ef9606ff0ca62ae8fff33867762fa0d`, standard run
[40917103770](https://github.com/phodal/pero/actions/runs/40917103770), Linux
job `123600156542`, completed every workbench assertion with `errors: []`.
The retained draft/history screenshot and final result contain both conversations.
Relative to the installed pre-reload hook, the main-process trace recorded one
of each event: Agent catalog at 5,525.7 ms,
workspace at 5,526.9 ms, roadmap at 5,584.3 ms and replay at 5,650.1 ms;
renderer readiness was observed at 6,820.7 ms and the held replay released at
9,175.5 ms. No `Invalid Host event` occurred. Thus startup-to-arrival beyond five seconds is now actually observed, not only
a synthetic schedule. The trace does not record the old poll's exact start and
does not manufacture a missing timeline for the earlier failed run.

Artifact `12917691030` (12 files) has ZIP SHA-256
`889da406d15058a64cc659054abc1bc294699c1d1564cbd911af0fc8f95bd7cd`.
The next tool-call suite failed its initial five-second catalog assertion before
its existing loading-removed wait. Its failure snapshot already contains both
required Agent IDs, `codex` and `fixture`, and no page errors.

The finite `.github/workflows/ci.yml` desktop command chain contains four suites:

| Suite | Startup gate audit |
| --- | --- |
| `workbench.mjs` | Initial 15-second Agent poll preceded its existing loading-removed wait; move that wait before the unchanged poll. Reload path is accepted above. |
| `toolcalls.mjs` | Initial five-second Agent poll preceded its existing loading-removed wait; move that wait before the unchanged poll. |
| `app-use.mjs` | The Agent poll follows connected chat readiness; `initializeChat` is gated by `chatReady`. No identical later-loading wait exists; unchanged. |
| `app-use-workbench.mjs` | Already waits for diagnostics plus loading removal before polling the App catalog; unchanged. |

Only the two existing wait lines move. No Agent/tool/context/permission/keyboard
assertions, timeouts, product code or workflow change. Deterministic execution of
both old/new startup wait regions against permitted virtual readiness schedules
shows the original five-/15-second polls expire before startup and the reordered
versions pass, keeping those budgets unchanged. These are sequencing checks, not
new actual Electron runs. Full desktop CI acceptance remains pending; the two
App Use suites were not reached by this failed job.

## Final CI acceptance (2026-10-30)

Standard CI [40962596409](https://github.com/phodal/pero/actions/runs/40962596409)
passed all 16 jobs for head `26c371fad79ff6bb60ff32d7e3a383c9ba3e182f`,
testing merge `7beb3d9eeaf842eb2a899c1506ebf8bc37e2f15a`. The Linux Desktop
job completed all four actual Electron suites: Workbench, tool calls, Product
App Use and Workbench App Use, each with `errors: []`. This closes the pending
full-suite acceptance above without changing the historical failure evidence.

The retained screenshots and results are in
[Desktop artifact 12936827324](https://github.com/phodal/pero/actions/runs/40962596409/artifacts/12936827324),
ZIP SHA-256 `0b6e3ec3c12e86d0f442da92dd2d3b6d8daf22f8bedd3081325e6d920c99ac80`.
Desktop E2E remains Linux-only in this workflow; the macOS and Windows E2E
steps were skipped by their existing conditions, not accepted as executed.

## Compact sidebar history selection (2026-10-30)

After integrating the compact workbench from master, standard CI
[40988610503](https://github.com/phodal/pero/actions/runs/40988610503) at head
`edb2e56a5f5f37ba50d3820007352229b19e069d` passed replay arrival and
retained-draft identity, then failed selecting the restored history session.
The unchanged test clicked `(100,166)`. Both the pre-click screenshot and the
failure screenshot show the original session centered at y=130 and the new
draft at y=154; y=166 is below the session buttons. This is a stale test target,
not evidence that replay or history selection failed in the product.

Use the compact sidebar's first-session center `(100,130)`, consistent with
the existing workspace suite. Keep the real pointer click, original thread ID,
active-content and active-chat assertions, and their five-second bounds. No
production code, timeout, retry or selection predicate changes. A finite audit
of the four executed Desktop suites found no other fixed history-row target;
their top-row new-chat actions are separate and unchanged.

The screenshot archive is
[12947804677](https://github.com/phodal/pero/actions/runs/40988610503/artifacts/12947804677),
SHA-256 `c02ee4fdeaecb06785f9e0d58c7536ce020b94cd0beeffe2b63c60986ddd068b`.
JavaScript syntax and diff checks pass. Actual Electron verification on the
corrected head is still required; screenshot inspection is not a new UI pass.


## Compact composer Agent selection (2026-10-30)

Standard CI [40989854364](https://github.com/phodal/pero/actions/runs/40989854364)
at head `b4ee1b7` passed the complete Workbench suite, including the corrected
history selection. Linux job `123849340961` then failed the tool-call suite's
Agent identity assertion: the new conversation remained on `codex` instead of
`fixture`.

The actual failure screenshot is 1488×1059. Its compact composer shows the
Codex picker centered around `(1333,1036)`, while the unchanged test clicked
`(1280,1039)` (`innerWidth-208`, `innerHeight-20`), in the empty space to its
left. The authentication-required card belongs to the untouched default Codex
conversation. `composer.rs` renders the right-aligned Agent, workspace and send
controls; the empty conversation remains retargetable. No existing Agent-picker
painted-bounds diagnostic is available.

Correct only the horizontal target to `innerWidth-154`, inside the visible
Codex picker. Keep the actual pointer click, ArrowUp/Enter menu selection,
`fixture` identity assertion, all later tool assertions and original wait
budgets. The finite audit of the remaining Product App Use and Workbench App Use
suites found no Agent-picker coordinate or keyboard selection to update: both
supply fixture commands for their default Agent IDs. No production changes,
new diagnostics, retries or timeout increases are needed for this stale target.

Evidence: [Desktop artifact 12949171631](https://github.com/phodal/pero/actions/runs/40989854364/artifacts/12949171631),
12 files; independently verified ZIP SHA-256
`eff3817821c4e878ac6dc9ac8dcad328d593d5a968b411d520a0b8c2eaa02b6f`.
JavaScript syntax and diff checks pass. Actual Electron acceptance still
requires the next CI run; this workspace has neither a built Desktop
distribution nor Xvfb. The two App Use suites were not reached by this failure.

The finite follow-on audit also checked the existing diagnostic contracts:
`attachments` still projects context labels, `activeChat` is an index, and
`toolBounds`/`toolViews` retain the tested shapes. The Toolcalls textarea click
is the same `(950,975)` used by the now-passing Workbench suite and lies inside
the captured compact textarea. App Use composer offsets remain inside that
shared textarea layout; their actual execution is not yet verified.

One additional stale target is concrete: Product App Use's `choose()` computes
permission positions with text-width guesses and `height-138`. In the captured
shared compact permission UI this Y crosses card text, above the buttons near
`height-121`. Reuse the existing `permissionBounds` for the requested option in
the same conversation, wait for nonempty painted bounds using the existing
default five-second poll budget, and add the Chat canvas origin before the real
pointer click. Keep option-kind lookup and permission/result/effect assertions;
there is no estimated-coordinate fallback. The existing Workbench permission
click already passed using this diagnostic. Synthetic offset/index arithmetic
checks and syntax checks pass, but are not a substitute for Product Electron CI.
