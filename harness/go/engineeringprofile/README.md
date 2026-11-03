# Engineering profile

An opt-in native Go App for engineering guidance, explicit work contracts,
receipt-backed checks and bounded stop feedback. It uses the existing Harness
runtime, tools, approval, session journal and task table. It grants no tools.

## CLI

`--engineering-profile observe` enables guidance and request measurements.
`--engineering-profile feedback` also permits feedback for explicitly bound
change contracts. The default is `off`. An optional trusted
`--engineering-contract /absolute/contract.json` binds each new session's first
human request; existing sessions and subsequent human requests are not rebound.
The same behavior is available in ACP and print mode. Provider configuration,
workspace, shell enablement and approvals remain separate.

Example contract for a workspace containing the named files:

```json
{
  "id": "arithmetic-fix",
  "revision": 1,
  "kind": "change",
  "goal": "Fix arithmetic and run its tests",
  "checks": [{
    "id": "unit",
    "tool": "shell",
    "command": "go test ./...",
    "required": true,
    "files": ["go.mod", "arithmetic.go", "arithmetic_test.go"]
  }]
}
```

Use `Bash` instead of `shell` when selecting the Claude tool profile. Commands
must use the mounted tool's exact name. `engineering_check {"checkId":"unit"}`
executes the host-bound command through that tool's existing admission and
approval. The wrapper rejects command rewrites and does not turn a background
handle into success. Bash checks run in the session workspace, without changing
the persistent directory of ordinary Bash calls. It does not start an
additional verifier agent.

Enabling the profile also selects the existing owners' bounded Skill/skill
presentation (8 KiB advertisements and pages) and attributed memory context for
new Claude children. See [skills](../skills/README.md) and
[subagents](../subagents/README.md). Legacy defaults remain available when the
profile is disabled; old memory personas are not migrated by string parsing.

## Native composition

`Mount(ctx, h, Options{Mode: Observe})` installs one Point activation. Dispose
the returned App to remove its prompt, tool and listeners, or let Harness
Dispose/Drain own shutdown. For host-bound tasks, allocate a message ID, call
`StageContract(agent, Contract{MessageID: id, ...})`, submit that same human
message, then `DiscardContract(agent, id)` after settlement or rejection.
Discard removes only an unbound candidate. Candidate staging itself grants no
authority. Non-human followups cannot activate it.
Plugin-only delivery rejects `Source.kind=user`; use the existing human or
source-aware DSH admission APIs for actual user input.

Binding occurs at the admitted main-request boundary, after the exact source
message has entered the session. Trusted human claim facts distinguish ordinary
user input and steering from plugin-authored followups. Contract revisions
strictly increase across that ID's history, including candidates queued before
an earlier revision binds; evidence also identifies the check specification. A
new unbound human request suspends the previous contract, including steering
within the same turn. Hosts that want explicit
continuation must stage the updated contract themselves. No intent classifier
guesses authorization from natural-language keywords.

`Current(session)` reconstructs the active contract; `App.Assessment(ctx,
agent)` combines it with settled check receipts and referenced `tasks.Current`
facts. A check is accepted only after the inner tool returns and the outer
`engineering_check` result is committed successfully. Results and Finalized
notifications alone cannot establish success. Input-file digests must agree
before execution, after execution and at assessment. The evidence covers those
declared files only, not every dependency or later concurrent modification.

In feedback mode, only an incomplete `change` contract with available execution
tools and loop continuation eligibility can prompt another step. The default
limit is two attempts per contract revision, with identical assessments deduped.
An attempt is journaled and flushed before Inject; failure or restart consumes
the reservation rather than resetting the allowance. The App never bypasses
max_tokens, step limits, cancellation or existing approval.

## Recovery and measurements

Contract, human-claim, evidence and feedback-attempt facts are small versioned
journal events; task state and command output are not duplicated. PostCompact restores
the attributed current-work context, without rerunning checks or skill scripts.
Forked sessions do not inherit an active contract from their seed.

MainRequest measures the prepared route, final canonical system bytes/digest,
tool-schema bytes and turn/step. It does not retain raw system text or infer
provider token/cache usage. Metrics are best effort; contract durability errors
are explicit failures. Root guidance and check execution are limited to native
root Agents belonging to this Harness.

This version does not intercept every native `tasks.Commit`, impose schemas on
all Agent calls, provide global per-section tracing or introduce model-specific
prompt variants. Task status alone never proves the engineering acceptance.

## Validation

From `harness/go`: `go test ./engineeringprofile` and
`go test -race ./engineeringprofile`. Tests cover early completion, finalizer
failure, stale inputs, running checks, approval, command rewrites, source binding,
historical revisions, stop limits and feedback recovery. No paid model is used.
