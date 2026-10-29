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
