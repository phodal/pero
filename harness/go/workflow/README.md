# Selected plugin workflows

`workflow` runs selected JavaScript orchestration from explicitly selected
plugin packages. It registers the `Workflow` tool in the existing Harness tool
registry and delegates `agent()` through `subagents.ClaudeContribution.Invoke`.
It does not own a second model loop, credentials, approval system or task store.

## Selection and execution

Only `.js` and `.mjs` files under a selected package's `workflows/` resource
directory are admitted. Calls use an absolute `scriptPath`; descriptors and
digests are frozen at mount, and a changed file requires selection again.
Nested workflows use the same catalog and checks. The catalog opens selected
package files read-only; agent tools retain the caller's existing workspace
and approval authority.

The CLI mounts this tool when selected packages contain workflow scripts. It
resolves `node` from PATH, or the executable supplied with `--workflow-node`.
The package API requires an absolute executable path. Process ownership and
cleanup currently support macOS and Linux.

Scripts begin with `export const meta = { name, description, ... }` after any
leading whitespace or comments. The export is authoritative; optional call
metadata must match it. The body supports top-level `await` and `return`.
`args` is the supplied JSON value: a JSON string remains a string for scripts
that call `JSON.parse(args)` themselves.

```js
export const meta = {
  name: 'review',
  description: 'Review independent dimensions',
  phases: [{ title: 'Review', model: 'senior' }],
};

phase('Review');
const results = await parallel([
  () => agent('Check behavior', { label: 'behavior' }),
  () => agent('Check tests', { label: 'tests' }),
]);
log('Review finished');
return results;
```

| Helper | Contract |
| --- | --- |
| `agent(prompt, options)` | Options: label, phase, provider, model, schema, isolation, and agentType. `isolation: "worktree"` runs that child in a separate Git worktree. `agentType` selects a mounted agent such as Explore or Plan. Reuses existing model routes, tools, approvals, cancellation and structured output. Returns text, a structured value, or null for a failed member. |
| `parallel(thunks)` | Runs functions and preserves input order. Ordinary member failures become null; protocol and unsupported-capability errors remain explicit. |
| `pipeline(items, ...stages)` | Runs each item's stages in order, preserving item order; stages receive current value, original item and index. |
| `workflow({scriptPath, meta?}, args)` | Runs another selected script, sharing the process, cancellation and agent() budgets. |
| `phase(title)` / `log(message)` | Records phase/log events in the caller's session. |

Default limits are three concurrent `agent()` calls and 64 admitted calls per
run, shared with nested workflows. These limits count script helper calls.
Model-authored descendant delegation retains the existing agent policy; the
provider request budget still covers those model requests. `Result.AgentCalls`
reports admitted helper calls, not every descendant agent.

When a script returns, its value is retained. Unfinished member agents are
cancelled, their actual terminal states are durably recorded, and cleanup is
joined before the tool returns. `stopReason: completed` means the script
returned; it does not assert that every member completed successfully. This
matches the pinned DSH host's settlement behavior. Cancellation and runtime
disposal also reclaim Node and child activations before returning.

## Scope and remaining differences

`run_in_background: true` returns an owned task handle as described below.
There is no JavaScript-stack resume, arbitrary module loader or claim of
general JavaScript application compatibility. An explicit `resumeFrom` run id
re-enters the same script without repeating recorded agent() effects, as
described below. Scripts run as trusted selected
package code. The Node VM restricts available globals but **is not an OS
sandbox**; deployment isolation remains the host's responsibility.

The original three review scripts in `testdata/review` run through the real
Workflow tool and loopback model adapter. The approved path exercises nine
agent calls, ten HTTP requests, peak concurrency three, structured results,
an approved file write and nested quality/assessment workflows. The denied
path proves the spec gate prevents downstream work. Lifecycle tests cover
unawaited-member settlement, durable cancellation, runtime disposal and an
asynchronous CPU loop. These tests establish orchestration behavior, not the
quality of a real model's review or every plugin workflow.

## Sources and licenses

Helper behavior was adapted from DSH at commit
`ce7073d51254c26cd63b22a60835b8f948deb447` through a new Go/Node RPC host. The
original TypeScript runtime was not copied. Relevant fixed sources are
[tool-workflow](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/workflow/tool-workflow/src/index.ts),
[runtime](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/workflow/workflow-ptc/src/runtime.ts),
[host settlement](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/workflow/workflow-ptc/src/host.ts#L286)
and [metadata](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/workflow/workflow-ptc/src/meta.ts).
The applicable reference license is preserved in [LICENSE.dsh](LICENSE.dsh).

The three original JavaScript files were copied verbatim as integration
fixtures from a selected package snapshot. Its applicable MIT license and
copyright notice are preserved in [testdata/review/LICENSE](testdata/review/LICENSE).
Snapshot commit, exact file hashes and the distinction between behavior
adaptation and copied fixtures are recorded in [SOURCE.json](SOURCE.json).

## Background task ownership

The Workflow tool accepts run_in_background=true. It appends and flushes a
workflow-task/started intent before launching the same selected Node executor.
The tool returns task_id and kind=workflow; shared TaskOutput polls or waits,
and TaskStop cancels and joins the real Node process and member activations.
The exact parent owns access. Admission context cancellation after the returned
handle does not stop accepted work. Runtime ownership, parent interruption and
retirement do cancel it. There are at most 16 concurrent background workflows.

Normal completion of a parent turn leaves accepted work running, including
later member stages and their existing approval channel. No model credentials
or additional model loop are introduced. The task ID also identifies progress
RunID. Repeated dispatch of the same call ID in the same turn returns the
existing receipt. A terminal fact is flushed after actual executor and child
settlement; success requires the real completed result. Failed persistence
is reported as failure, never as durable success.

Lookup reconstructs terminal results from the owning Session's journal. An
unfinished intent with no live process owner becomes interrupted once; it
never launches Node, repeats members or retries file effects. Restart does
not resume a JavaScript stack. External storage durability still
requires the existing Session persistence configuration; in-memory Sessions
do not acquire disk durability from this API.

Parent retirement cancels without joining from within its lifecycle hooks:
member receipts themselves await parent retirement. The AgentManager owns child
retirement, and contribution drain joins the workflow bookkeeping afterwards.
See the [retirement wait fix](../../../docs/issues/2026-11-03-workflow-retirement-wait.md).

Real integration tests exercise two background stages, a member Write and its
approval after the parent turn ends, shared polling/waiting/stopping, exact
parent isolation, cancellation, disposal, actual parent retirement, terminal
restoration and lost-owner interruption without replay. The actual model seam
is a fixture. Online parent completion notices are described below. Explicit
continuation is separate from this restart behavior; TaskOutput remains
available for retrieval.

## Explicit continuation

`resumeFrom` continues one recorded run id in the foreground. Node starts
again and re-enters the same script and args. Each `agent()` call is matched
in admission order to the journal by a fingerprint of the script, prompt,
label, phase and schema. A completed record supplies its stored text or
structured result and does not invoke a child. A start without a terminal
record, and any terminal record that is not completed, is returned as not
completed and does not invoke a child. Only calls after that prefix invoke
new children. A fingerprint, script or args mismatch fails before a new
child. A completed run, a run that is still executing, and
`run_in_background` cannot resume. This does not restore a JavaScript stack
or in-flight process memory.

## Completion notifications

After real Node/member cleanup and a successfully flushed terminal receipt,
completed and failed background workflows post their actual result to the
controlling parent. Source kind is workflow-settled, not subagent-settled: a
workflow task is not a child session. The task supplies a deterministic message
ID. The existing inbox retains source identities, so a repeated notification
cannot create another model request, including after that message was consumed.

DeliverBackgroundNotice uses that inbox and its normal serialized Agent worker.
With attached Session persistence, insertion is flushed before wake scheduling;
without it, the Session remains memory-only. The notice owns a follow-up turn
and does not require another user prompt or TaskOutput polling. A failure to
confirm delivery is visible as notification_error on the live task receipt;
it does not change the actual workflow completion status.

TaskStop and owner cancellation do not publish stopped-task notifications.
Retiring, closed, replaced or interrupted parents are not woken. The inbox
wake also preserves the interrupt latch if interruption races insertion: work
can stay parked for a later explicit user admission. No notice is sent when
the workflow terminal persistence barrier failed.

Tests prove a completed controlling Prompt followed by an automatic second
turn, actual child Write and approval, actual failure delivery, source identity
deduplication, checkpoint-failure-before-wake, and interruption without wake.
Model responses use the existing local adapter seam. These tests do not prove
external model quality or replace the earlier ACP stream visibility check.

Persisted pending inbox messages use existing resume behavior. The terminal-to-
inbox crash window is reconciled at the resume boundary described below.
Explicit resumeFrom continues a recorded run from its journal. Restart still
does not resume a lost process.

## Recovery reconciliation

BeforeInboxResume runs after a controller has attached Session persistence and
published its event subscription. The Workflow owner restores terminal tasks
from the original journal, marks lost process owners interrupted without
executing them, and stages completion notices in recorded terminal order. The
staging API flushes each stable message identity but never starts a model. The
normal ResumeDurableInbox driver schedules work only after staging finishes.
The existing inbox deduplicates both pending and already consumed messages.

The common current-turn interruption rule suppresses recovery for a controller
whose last turn was aborted or failed. A later admitted turn advances that
correlation; PreStep then reconciles missing notices. Live tasks from the same
generation retain their original owner and are never mistaken for lost ones.
Recovery has a five-second budget and never converts an unconfirmed terminal
persistence failure from the live owner into a notification.

A JSONL regression executes a real child Write and one approval, omits notice
insertion at the real terminal boundary, and reloads the persisted file using
fresh runtime and persistence objects. It observes the original completion
without a new Node run, child model call or file effect. A second fresh reload
produces no duplicate model request. This is fault injection at the crash
boundary; the test does not claim it killed the original OS process.
Additional disk fixtures cover interrupted-controller deferral, lost-owner
interruption, and terminal-order staging without model startup.

The headless API now omits absent turn correlation instead of writing turn:0,
which Session resume correctly rejects. See the
[JSONL incident](../../../docs/issues/2026-11-03-workflow-zero-turn-journal.md).
Missing terminal data is still reported as interruption. Recovery cannot
continue an in-flight JavaScript stack or revive a lost model process.
