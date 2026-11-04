# Tool-call efficiency verification

This follow-up fixes six findings from the DSH/Pi/Qwen source and Session audit.
It reuses the existing tool registry, scoped spill policy, ordered batch commit,
owned Bash lifecycle and native Session history.

| Finding | Resulting behavior |
| --- | --- |
| TaskStop also activated Agent/Bash | A complete registered tool name selects only that tool, case-insensitively; keyword and explicit multi-name queries retain their behavior. |
| Discovery repeated full schemas in history | Deferred receipts return bounded descriptions, activation/hash/pagination facts; complete schemas remain in durable metadata and the next request declarations. |
| Bash-only deferred requests lost timeout guidance | Short checks have explicit `terminate_on_timeout`; timeout cancels and joins the owned process. Default promotion remains available, with exact-handle recovery advice. |
| Argument repetition looked unproductive despite changing results | Turn-local advisory reminders require consecutive unchanged observed results, at counts 3/5/8. Changes, mutations, new turns and polling reset/exclude the chain. No effect is vetoed or replayed. |
| Parallel outputs exceeded individual caps | A live `agent-loop.toolOutputBatchBytes` text budget defaults to 65,536 bytes, zero disables it. Small results retain their share; larger results save full text before projection. Missing/quota-exhausted storage preserves evidence and records a budget miss. |
| Native search could not reach later files | Descriptor-rooted directory pages and query-bound Glob/Grep cursors continue past 256/512 entries and inside matching files, with root/nested `.gitignore` filtering. |

Native CLI spill files live under the configured `--session-dir/tool-output/`.
`ReadToolOutput` reads exact Session-owned locators with bounded UTF-8 byte pages,
including after a cold store restart. It does not broaden ordinary workspace
Read authority. Deferred discovery can activate this tool by its exact name.

The batch budget measures text, excluding images and serialization overhead.
Failure flags and durable metadata survive projection. A result that cannot fit
its recovery pointer remains whole, so the budget is best effort with an explicit
`met` fact. Search enumerates live directories; directory mutations require a
restart. Tested nested ignore patterns do not establish complete Git parity.

OpenAI `request/wire-size` records the actual serialized body length/digest and
serialized tools/tool-result messages before HTTP. This reflects the selected
request after replacement/compaction. It is preparation evidence, not a sent
request receipt or provider token count; retries and auxiliary generations keep
separate records. Zero turn coordinates are omitted so auxiliary requests do not
break Session resume.

The offline reporter distinguishes changed/unchanged/unknown repeated results,
counts declaration exposure per committed response, and reports the contribution
from tools never invoked in that Session. It uses boundary records for retained
tool-result bytes rather than summing raw history. Older traces without those
records retain unobserved wire cost. Spilled/truncated previews cannot establish
equality of full returned results. Usage still comes only from committed provider
reports; printed failures remain review candidates without rewriting shell exit.

## Verification

- Full standalone Harness Go race suite, `GOWORK=off go test -race -count=1 ./...`.
- `go vet ./...`; all changed code files remain below 1,000 lines.
- Six affected standalone Bazel race targets pass: fstools, nativetools, harness,
  tool, openai and pero-agent-acp. Gazelle diff and standalone agent build pass
  with `--lockfile_mode=error`.
- Reporter: 20 cases; benchmark judge acceptance: one table with five real
  subprocess verdicts; trial client: 18 cases.
- Real-process bounded timeout checks establish process termination and one
  owned effect. Loopback HTTP checks establish actual declarations, compact
  history, body size/digest and safe resume after auxiliary requests.

The audit baseline is four Sessions, 65 committed responses, 62 calls and
717,812 recorded tokens, including cache reads. A bounded same-task provider
follow-up is recorded separately below; it cannot establish causal savings.
