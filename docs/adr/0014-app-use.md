# Agent App Use over the managed App surface

Status: accepted for the Desktop implementation, 2026-10-29.

## Problem

The shared Chat in ADR 0012 provides App → Chat `open` and `compose`. An Agent
still needs the opposite path: discover an App, observe its current state,
perform a declared operation and verify an outcome. A chat scope alone grants
none of those capabilities. Point's App Use is the functional reference; Pero's
cross-origin App documents require a different transport.

## Decision

```text
ACP Agent ── HTTP MCP app_use ── Desktop AppUse authority
                                  │ task + conversation + instance + actions
                                  ├── Agent session approval policy; Chat only when requested
                                  ├── native panel-only capture and evidence
                                  └── managed parent RPC ── App SDK semantic registry / bounded DOM
```

### One state projection, explicit actions

`useAppObject` registers the same React state and callbacks used by the App UI.
Each object has an ID, kind, label, JSON state and declared commands. The SDK
validates the supported parameter-schema subset when registering the object and
checks command parameters when invoking it. Unsupported schema constraints fail
explicitly. Interpretation requires no `eval` or CSP relaxation. Equal declared
values retain their revision; current callbacks replace previous closures.

A semantic invocation names its object and supplies the observed object revision.
DOM fallback uses a bounded list of observation-specific refs. Filling is limited
to editable plain-text inputs and textareas; password/file controls are excluded.
A successful action returns `verdict: not-run`. Verification is a separate request.

### Session and task authority

The Rust Host supplies the private Desktop MCP endpoint in ACP `session/new`
only when the Agent advertises HTTP MCP. Session identity is injected by the Host
in transport headers; tool arguments cannot select their caller. The loopback
endpoint has an ephemeral bearer token and is not published to App documents.
The current Codex and Claude adapters advertise this ACP capability. Providers
without it retain ordinary chat but do not receive the App Use tool.

Desktop main owns `AppUseTask`: one running, selected Host conversation, one
parent-owned App/panel instance, one fixed action set and a maximum five-minute
lease. The Rust Host continues to own ACP execution, cancellation and history;
Desktop owns authorization and effects against its live UI surfaces.

The calling Agent owns approval policy. Codex/Claude apply their advertised
session settings to tool calls; an auto-approved authenticated MCP call proceeds
without a second Desktop question. If the Agent emits `session/request_permission`,
the existing Host/Chat path asks and returns the selected outcome to that Agent.
Desktop does not infer provider modes or create another approval selector.

Reading remains distinct from operation. Explicit `scope: session` creates a
revocable standing read grant for one App in one conversation. It never grants
writes. The parent panel displays reading/operating/standing state and Revoke.
Tasks survive turn boundaries within their lease; calls require a running turn.
Cancellation and conversation changes end tasks. Standing read grants remain
until revoked or Desktop reloads; a new allowed user turn may start a new task.

An App-scoped conversation discovers its own App/panel. An ordinary conversation
can discover all retained mounted Apps, allowing hidden semantic state to be read.
Each task still binds the actual selected surface. Only visible, active,
uncovered surfaces may be operated or captured. Trusted user input pauses Agent
operation. Reload/remove replaces the instance and invalidates pending requests.

### Tool and transport

One `app_use` tool exposes `inventory`, `start`, `describe`, `observe`, `capture`,
`wait`, `act`, `verify`, `runPlan` and `stop`. Its MCP instructions explain the
workflow, data/instruction boundary and approval behavior. It opens no panels and
executes no arbitrary scripts.

The parent shell identifies a managed iframe by its source and origin. App JSON
cannot choose a different App identity. Geometry supplied by an App is validated
and clipped inside the parent-owned iframe and viewport before native capture.
Captures return image content and a durable receipt containing App/panel,
conversation, Agent, task, frame instance, crop, capture time, SHA-256, byte count
and dimensions. The PNG and JSON receipt are stored together in the Desktop profile. Screenshots remain evidence rather than verification verdicts.
Ordinary App fields named `image` remain App data during MCP serialization.

`wait` polls declared state or revision with a bounded deadline. `verify` supports
semantic equality, text containment, declared DOM existence and mechanical pixel
nonblank/changed checks. Hidden rendered-content checks and inconclusive
truncated observations return `indeterminate`; semantic state remains readable.
A visual check does not establish the scientific meaning of an image.

`runPlan` executes at most twenty steps, allows references to earlier results,
stops on failure, indeterminate verification or timeout, and releases the task.
It performs no retries or rollback. Cancellation/timeout stops waiting promptly;
an already-dispatched App callback may have produced effects. The caller must
observe current state before continuing rather than assuming rollback.

### Persistence and readiness

Host replay restores conversation associations, never App Use grants. A prompt
can reach the Agent before the asynchronous Host event reaches Desktop. Desktop
records the trusted prompt intent and waits for the actual `turn_started` event
before accepting its tool call, bounded to five seconds. No timed pause assumes
that the Host has become ready.

### Frozen Composer context

The SDK's `objectReference` fixes object ID, revision and optional selection.
Desktop reads that revision from the managed App and freezes it as a typed
`app_object` ContextReference. A stale selection is refused. Shared Chat owns
Preview, Remove and the same context budget as other attachments. App launches
append by default and may explicitly replace the draft; neither submits a prompt.
The destination thread is fixed before asynchronous work, and background results
return to that thread's retained draft.

App-requested screenshots and the trusted parent Capture to chat control add
context directly to the draft. Neither sends a prompt. The person can preview,
annotate or remove it before sending. Capture compares
App annotation snapshots before and after the native frame crop, then inserts
both immutable pixels and their state/receipt. Image preview supports region
annotations, undo and a note. Annotation JSON names the original image/evidence
and is a separate frozen context; the original PNG hash remains unchanged.
Unsupported provider images preserve the draft and expose a recovery error.

### Conversation file handoff

Desktop retains only file/image contexts explicitly supplied through Host user
messages. Inventory exposes content hashes, names, media types and lengths, not
Host paths. A declared semantic parameter with `format: pero-file-ref` resolves
that conversation's hash to a temporary same-App URL. Serving it reauthorizes
the original task and session. Cross-App/conversation requests, stop, selection,
revocation and expiry cannot reuse that authority. The original bytes survive
handoff, including JSON number spellings required by domain content hashes.

### Declared persistent writes and bundled workflow

`contributes.writes` names a document schema and fixed local `/api/` POST route.
The manifest requires an enabled App backend, bounded schemas and unique names.
Desktop `app_describe` exposes those declarations; `app_write` accepts only App,
tool and document. `PreparedAppWrite` freezes the schema-validated document and
installed route before execution. Writes use the calling Agent session approval
policy and create no additional Desktop prompt. The routing token stays private; route changes/disablement
invalidate the write. The backend continues to own its domain invariants.
App data-changed events let the SDK refresh the existing UI after persistence.

The Host embeds one `/app-use` skill for Composer search and HTTP MCP Agent
instructions. It documents tasks, files, operations, evidence, writes, denial
and the data/instruction boundary. Virtual Cell declares real view/import
operations and a persistent input route. Paper Agent declares its actual source
library/selection and read/refresh operations plus an immutable source import
route. None of these changes advances scientific acceptance automatically.

## Verification and boundaries

See [App Use verification](../fitness/app-use.md). Source checks, actual Desktop
fixture execution, live-provider execution and signed release acceptance are
recorded separately. This implements the listed Point App Use interfaces using
Pero's managed cross-origin App boundary. It does not require Point bundles or
its same-document architecture. Native GPUI preview still has no HTML App
surface; cross-platform capture and signed distribution remain platform checks.
