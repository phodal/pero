# Engineering profile verification

Date: 2026-11-03. Source: working changes based on
`e2a142506ba15d418cabe3922d50e0a0c7906264`. Platform: macOS arm64.
Acceptance: L0, with fake providers, loopback HTTP and real local Bash scripts.
No paid provider requests or model-quality A/B were run.

The opt-in native Go App is documented in
[engineeringprofile](../../harness/go/engineeringprofile/README.md). ACP and
print mode select it with `--engineering-profile observe|feedback`; default is
`off`. A trusted JSON contract can bind a new session's first human request.
Native composition can explicitly stage later revisions and steering messages.

Implemented behavior:

- Root guidance and capability-aware check guidance use the existing prompt
  registry. Dynamic contract facts remain attributed runtime context.
- Exact human admission and committed source messages bind contracts. A new
  unbound human request or same-turn steering suspends the previous contract.
  Queued stale revisions and plugin messages cannot reactivate old acceptance.
  Plugin-only admission rejects declarations of human source; trusted user/DSH
  admission retains explicit human input.
- `engineering_check` runs only a host-declared command through existing tool
  admission and approvals. A check is accepted only with an unambiguous call,
  settled outer result, committed step and matching declared file digests.
  Bash uses the session workspace while ordinary Bash retains its own directory.
- Incomplete change contracts may receive up to two feedback attempts per
  revision, with repeated assessments deduped and reservations journaled before
  injection. Cancellation, explicit tool conclusion, refusal, token limits and
  exhausted steps do not trigger continuation.
- Skills use an 8 KiB advertisement/page budget when the profile is enabled;
  every visible entry remains discoverable through snapshot-bound pagination.
  Legacy schema and response shapes remain the default without this option.
- New Claude memory contexts keep body text outside the persona and retain
  scope/path/digest attribution through managed resume, JSONL restore and
  compaction. Legacy descriptors are not migrated by parsing prompt strings.
- Measurements record the final request route, system bytes/digest, tool schema
  bytes and turn/step. They do not estimate provider tokens or cache hits.

Validation from `harness/go`:

- `go test -p 1 ./... -count=1` passed across the final module changes.
- Race checks passed for engineeringprofile, harness, skills, subagents, ACP,
  CLI and native tools. Print/engineering regressions passed 10 repeated runs.
- `go vet ./...` passed. The ACP executable built to a temporary output path.
- Bazel tests passed for all seven affected packages: engineeringprofile,
  harness, native tools, skills, subagents, ACP and CLI. Scoped Gazelle diff
  passed for those packages after updating their manifests.
- Real local shell regressions distinguish a failing root check from a passing
  check in Bash's previously selected directory, and verify directory retention.
- A recovery regression exercises actual compaction, plugin continuation and
  App disposal without rerunning the successful check.

A concurrent Go/Bazel run hit timing failures in the unchanged
`TestAsyncHookDeliversContextOnTheNextTurn` and
`TestManagedExecutionKeepsProcessUntilOwnerDeadline`. The serial full-module
rerun passed both; this work does not claim to fix their timing sensitivity.
The unrestricted Gazelle diff also reports pre-existing manifest drift in
`claudehooks` and `pluginruntime`; only affected package manifests were updated.

This edition does not provide a completion validator across every native
`tasks.Commit`, a default schema for all delegated agents, an automatic verifier
agent, global prompt-section tracing or model-specific prompt variants. It does
not establish provider-quality improvements or Desktop/release acceptance.
