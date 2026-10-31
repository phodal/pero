# Automation: local implementation slice

This implements the local portion of [ADR 0024](../adr/0024-event-driven-automation.md),
not the entire target architecture. The Host remains supervised by Desktop and
runs scheduling only while open. It is not an installed always-on service.

## Available path

Workbench's **Automation…** menu opens a compact definition/request view. Create a
fixed local Agent method in the displayed workspace, supply an input, then Run.
Manual, local event and interval-slot triggers share one Rust decision core.
Exact input pins a published revision/digest; Latest reads the current value of
the **Host's published-input registry**, not a remote URL or provider cache.

The trusted stdio/Workbench boundary accepts `method: "automation"` with a request
`id` and the typed public `command` from `protocol/automation.tsp`. Local producers
publish immutable bytes separately with `publish_input`, then send `accept` with
a stable producer ID and optional exact revision. The receiver computes the event
digest. Same ID/content returns its original acceptance; changed content conflicts.
No event can change the definition's Agent, workspace or target.

There is no public HTTP listener. `SourceBinding.authority` is restricted to
`trusted-local-host`; a source is an explicitly published local input registry.
External source authentication, webhook signatures, remote latest-state resolution,
PostgreSQL handoff, Cloud Run/Worker execution, App/deterministic methods and
headless service deployment are **not implemented**. Unsupported target/method
variants and internal execution commands are rejected, not accepted into limbo.
The Workbench modal is available; standalone Product Automation UI is not claimed.

## Responsibility and execution

- `pero-contracts::automation` owns pure typed decisions with supplied time/IDs.
- Host SQLite (`automation.sqlite3`, beside runtime settings) owns the Inbox,
  definition revisions, request state, immutable inputs, effects, admission
  snapshots and execution observations. Cross-record writes commit before ACK or
  dispatch. It uses full synchronous commits and an exclusive profile lock; a
  second Host cannot recover an owner's live reservations.
- Host admission resolves the explicit workspace and installed Agent configuration.
  Its redacted configuration digest and candidate snapshot commit with reservation
  before the existing ACP owner receives a prompt. No second Agent executor exists.
- Interactive permission requests are denied through the existing Session owner.
  This is **not** a claim that a configured Agent or its tools are intrinsically
  read-only; existing non-interactive capabilities still belong to that Agent's
  configured authority. No hidden App UI capability is granted.
- Execution observations are retained independently of the ordinary chat journal.
  `end_turn` means the turn ended; it is not independent result verification or
  scientific/business acceptance. Cancellation records intent and requests the
  original Session to stop, not proof of rollback or descendant cleanup.

Latest wakeups coalesce per definition revision/method/subject while waiting. A
post-snapshot wakeup retains a subsequent observation obligation; the published
registry is read again, and an unchanged event candidate may reference prior known
work. New manual intent IDs and distinct schedule slots instead run unchanged input
again, retaining `reprocess_of` to the prior known request; retries of the same intent
or slot remain idempotent. A duplicate manual input does not republish or roll back
the latest snapshot; conflicting retries fail atomically. Every trigger is blocked
by an active or unresolved effect for that candidate, even when an older completed
request exists.
Exact requests retain every accepted revision. Edited definitions hold old pending
work until explicitly continued or cancelled. Revocation prevents new admission
and requests cancellation; no automatic ownership failover is implemented.

Restart retains pending requests. Any reserved/possibly-started execution becomes
`reconcile` with its original identity, never a fresh prompt. Pending cancellation
intent survives this transition. This slice has no authoritative ACP resume/lookup
or UI “retry unknown effect” shortcut. Reconcile holds the local dispatch budget
until a result can be checked; elapsed time and requesting cancellation are not proof.

The trusted Workbench controller can record an **operator attestation**, not a
provider receipt or platform verification. It binds the original execution, a
known outcome and bounded evidence to explicit confirmation that the execution
and child work have stopped and external effects have been checked. The Host
rejects the operation while its original Session is still live. An absent local
handle after restart does not prove the external outcome; if the operator cannot
establish it, the request stays blocked. App/ACP tool routes do not expose this
operation. This is not isolation from malicious executables with the same OS rights.

Reconciliation atomically retains the original observations and cancellation intent,
adds the operator record, and pauses the original definition. It dispatches nothing.
Independent work can continue; resuming the paused definition is a separate action.
The reconciled candidate remains covered for event wakeups, including a reported
not-started outcome. Reprocessing needs a new explicit manual intent or schedule
slot after resume, never reuse or replay of the original execution identity.

Admission failures remain visible and do not starve
unrelated eligible requests. A typed workspace-lease rejection emitted by the ACP
owner before prompt submission is a known failed attempt, not an uncertain effect;
it remains failed across restart. Generic session errors still require reconciliation.

## Fixed policy and bounds

This slice exposes interval anchor/period/lateness and pause/revoke/cancel controls,
not a configurable policy/workflow engine. Deployment policy is fixed: one active
local execution, at most 2,048 dispatches/requests/events, 512 snapshots, 128
semantic definition revisions, fan-out 16, and 65,536 bytes per frozen input.
Payload metadata/input capacity is 64 MiB; SQLite's page ceiling additionally
bounds its database. Identity records are not automatically expired or evicted.
At capacity new responsibility is rejected; accepted work is retained. Timers
catch up only within their explicit lateness window and never invent event work.

Polling the UI does not drive scheduling: the Host event pump wakes independently
of stdin. Interval schedules are UTC epoch seconds; the UI uses a bounded future
anchor and explicit catch-up window. User/Agent execution runtime and provider
budgets remain subject to the installed Agent configuration, not a claim of an
Automation-wide wall-clock/token quota. Each input is a small UTF-8 registry object;
large scientific blobs and external-reference retention are not implemented here.

## Evidence and limits

Cloud-local L0 checks use real Rust/SQLite and deterministic local ACP fixtures:

```sh
cargo test -p pero-contracts automation
cargo test -p pero-host automation
cargo build -p pero-host
node tests/runtime/automation.mjs
node --test web/src/automation-model.test.ts tests/contracts/automation.test.mjs
```

The store tests cover rollback/no ACK, competing owner, immutable input integrity,
corrupt SQLite and valid JSON with a zero-interval schedule failing closed. Core
tables cover matching, exact/latest, revisions, cancellation, quotas and recovery.
The stdio suite observes real receipt signals: manual/event/time, identity conflict,
fixed workspace, idle timer without stdin, cancellation, failed-admission fairness,
known pre-submit rejection, operator reconciliation without replay,
and SIGKILL/restart without prompt replay. It never contacts a model provider.
Receipts go to `test-results/automation/runtime.json` with the tested binary SHA256.

Hosted Linux L1 is configured as `tests/e2e/automation.mjs`: native menu, create/run,
pause, restart and screenshots with the same local ACP fixture. **A configured
check is not a passed result until its actual run completes.** Evidence is uploaded
from `test-results/automation/`. Live sources/providers (L2), standalone Automation
assembly and signed packages (L3) remain unverified. The user Mac was not accessed.
