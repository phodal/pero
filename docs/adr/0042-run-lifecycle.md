# 0042: Run and session projection

Date: 2026-11-28

Status: accepted for P0.5 of #256. Depends on the capability client and on owner-qualified identity. It does not replace the Go Run, the App AgentRun, an ACP session, or a Temporal campaign.

## Decision

Three identities stay distinct:

- An App AgentRun is the local app-scoped run in the existing Host contract. Its status words stay `running`, `needs_input`, `cancelling`, `completed`, `failed`, `cancelled`, and `interrupted`.
- A control-plane Run is the shared Go Run, keyed by run id, task, and generation. Its transitions stay in the existing worker and campaign owners.
- An ACP session is a session id. This slice can observe it. It cannot resume it.

`observe` projects those records for a client. It does not create a fourth lifecycle. A receipt freezes the request id, the operation, and the input hash. The same triple returns the stored result. The same id with a different hash or operation is `conflict`. A start looks up the original run before it considers a new attempt. An explicit retry is the only operation that asks the owner for another attempt, and only when that original run is still known.

Closing the consumer is `transport_abort`. The run status is unchanged and no cancel is sent. A timed-out wait is `timeout`, which is not the owner's `failed` status. An explicit cancel is `execution_cancel` and is sent only when that owner already supports cancel. A second approval returns the first decision.

Event reads use the existing sequence cursor. A duplicate sequence is ignored. A hole is `gap` and is not filled. A cursor older than the retained tail is `expired_cursor`. A generation change is `generation_changed`. If the owner restarts and loses live state, the projection is `interrupted`. It does not invent a resumed session.

The route is `POST /api/client/v1/projects/{project}/runs/observe`. The client credential is the caller. A prompt, a path, or an owner header is refused. There is no SSE stream and no fallback host. Poll and event tail remain the carriers.

## What this does not do

Live ACP continuation is `unsupported`. This slice does not claim that a remote client can resume an ACP session. Campaign and worker transitions stay where they are. A lost prompt is not sent again.
