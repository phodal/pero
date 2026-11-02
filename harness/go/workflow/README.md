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
| `agent(prompt, options)` | Options: label, phase, provider, model and schema. Reuses existing model routes, tools, approvals, cancellation and structured output. Returns text, a structured value, or null for a failed member. |
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
There is no execution-resume protocol, arbitrary module loader or claim of
general JavaScript application compatibility. Scripts run as trusted selected
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
never launches Node, repeats members or retries file effects. This is terminal
recovery, not workflow execution resumption. External storage durability still
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
is a fixture. Automatic parent completion notices and resumable workflow
continuations remain separate work; callers retrieve results through TaskOutput.
