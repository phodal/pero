---
kind: incident
status: resolved
---

# Native guidance omitted execution facts and check status preservation

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
