---
kind: incident
status: in_progress
---

# Native guidance omitted execution facts and check status preservation

## Follow-up: short-check advice disappears with deferred lifecycle tools

The React self-check waited 120 seconds in an infinite loop before promotion.
The short-check instruction required Bash, TaskOutput and TaskStop to be
declared together, which never happened in that deferred Session. Provide
bounded-check advice whenever Bash is available; expose lifecycle operations
only when declared or with an exact discovery instruction. Make the distinction
between promotion and terminating a check explicit, keeping the existing owned
process and cancellation paths.

Bash now accepts `terminate_on_timeout=true` for a bounded foreground check.
It uses the existing exact process owner and cancellation/join path, records the
choice in its durable intent, and rejects explicit background execution with
this option. Running receipts provide an exact TaskOutput/TaskStop discovery
hint without eagerly declaring those tools.

Focused race checks passed for bounded process termination, one-effect durable
receipts, invalid-combination rejection and existing promotion/owner cleanup.
Capability/guidance and full-suite checks are recorded in the active plan.

Native tool guidance did not show the host OS, configured shell, session
workspace or remembered Bash directory. Local coding traces consequently
included platform-specific commands and a script path inferred from shell `$0`.
It also asked for observed exit status without explaining that a successful
output filter or cleanup command can hide a failed check. Recorded calls
returned shell exit 0 while their output contained failed tests or a traceback.
These are guidance gaps; the shell correctly returned the whole command's status.

The native prompt now presents host OS/architecture and the current Session
workspace. When execution tools are declared for the prepared request, it also
shows the configured shell and the existing owner's Bash default directory or
new terminal directory. Directory facts refresh on each request; rendering does
not change directory ownership, inspect user environment variables, launch
probes, create scratch directories, or grant execution permissions.

Declared shell and terminal tools receive one instruction to preserve the
underlying check status across filters and cleanup, and inspect both output and
status before reporting success. Commands and execution semantics remain owned
by the existing tools. This introduces no benchmark-specific API guidance and
does not enable the optional engineering profile.

## Verification

A local adapter fixture executes Bash `cd nested` and checks the next provider
request's environment facts. The Session workspace and new terminal directory
remain distinct from the remembered Bash directory. Withdrawing execution tools
in adapter preparation removes their guidance, while a later actual Bash `pwd`
confirms that prompt rendering preserved the owner's directory. Capability cases
cover both shell and terminal names. No paid model calls are required.

`go -C harness/go test -race ./nativetools`, package `go vet` and
`git diff --check` passed. The explicit Bazel test source list includes the new
guidance tests. This verifies prompt assembly and existing directory behavior;
it does not establish a model-quality or benchmark-score improvement.

The later [four-exercise live sample](../fitness/coding-benchmark.md) observed
the new guidance in effective system messages, but the model still masked some
failed checks with output filters and cleanup. This repair supplies accurate
facts and guidance; it does not enforce a subprocess's status through an
arbitrary shell program. The offline Session report preserves those failures
as review candidates, separately from the independent judge outcome.

## Follow-up: explicit invocation directories and focused validation

The later kth repair repeated `cd python_programs` after a previous Bash call
had already changed the remembered directory. Execution failed before the
proposed scratch file was created. DSH's Bash exposes an explicit workdir
resolved against the Session workspace. Give Pero's Claude Bash the same
per-invocation choice, using the existing executor's directory admission and
durable workdir identity. Explicit-directory calls must neither read nor update
the remembered directory; omitted workdir retains the existing interactive
behavior. Foreground and background calls need the same rule.

React also spent many calls repairing self-generated expectations and twice
piped failed tests into tail with outer exit 0. Strengthen capability-scoped
guidance with concrete status-preservation advice, project-defined checks first,
bounded reproductions and diagnosis of implementation/environment/oracle before
retrying. Keep actual shell status intact and do not automatically infer a
test verdict from arbitrary printed text. Qoder G51/G54 and Qwen are behavior
references; no third-party prompt body or model-name routing is introduced.

Verification: full Harness Go race tests (35 packages), `go vet ./...` and
`git diff --check` pass. Foreground cases cover repeated relative/absolute
workdir, remembered-directory preservation, trusted anchor precedence and
invalid-directory admission. Background cases verify durable workdir identity
and exactly one effect. Guidance follows actual declared tools, including
withdrawal and the TaskOutput/TaskStop prerequisites. These are contract checks;
model compliance is measured separately in the [live follow-up](../fitness/dsh-native-improvements.md).
