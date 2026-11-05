---
kind: verification_report
---

# Runtime follow-up from local coding harnesses

2026-11-05, macOS arm64. This implements the runtime improvements identified
after the Terminal-Bench failure review. It does not change the frozen full-suite
run or establish a new benchmark score, model comparison or token-saving rate.

## References

Local sources were read only; no recovered prompt bodies were copied.

| Reference | Revision | Mechanism adapted |
| --- | --- | --- |
| deepseek-harness | `8bd073392eef6f54e921a093b95076248eb08cbb` | Existing model-free Session replacement and explicit job ownership |
| qwen-code | `6fe83a82457def9ab8daa43bf833b4cfdf192bd2` | Historical text watermarks; bounded alternating-call and Git-overview observations |
| pi-mono | `90b42bca6ed161b8e7ee40ceda9755205c2882ec` | Constraint-preserving checkpoints with separately sourced file operations |
| codex | `fc39cfcacd8c6efaf561269e882ea76bdc1dff42` | Exact process ownership and confirmed cleanup; ordinary process Drop terminates |
| claude-code-extracted | `1dbf34de9b8652da95ba6c8cca47b764d535a5d9` | Stop continuation as a reference; existing Pero hooks are retained |

The official DSH AST mapping uses its separate historical source pin. Extraction
is evidence for review, not semantic equivalence.

## Tool history and checkpoints

Opt in with the native CLI:

```sh
pero-agent-acp --workspace /absolute/workspace \
  --tool-history-chars 48000 --tool-history-low-watermark 24000 \
  --tool-history-keep-recent 4
```

At request boundaries, text above the high watermark is cleared oldest first
toward the low watermark. Recent successful outputs, explicit errors, known
native shell nonzero exits/timeouts/interruptions and rich non-text blocks are
protected. These protections and small outputs can keep the total above target.
Watermarks count Unicode characters, not tokens. Zero disables the new policy;
existing library per-result clipping stays source compatible.

The placeholder carries a `ReadToolOutput` Session locator. Readback pages the
exact retained event text at UTF-8 byte boundaries after JSONL restore, including
a direct fork's copied parent prefix. It reads no other Session store. An event
clipped by an older policy remains a clipped source. The tool is mounted in
native workspaces even without a spill store, so Explore/Plan read-only lists
include it. Original events survive; reports do not count replacements as calls.

Model-driven compaction separately requires `--context-window`. Print mode now
receives the same compaction options as ACP. Checkpoints preserve constraints,
public acceptance requirements, facts versus assumptions and deliverables.
Additional file-operation records come from successful Read/Write/Edit/Notebook
calls in the selected prefix, bounded to 32 rows and 4096 JSON bytes. Shell
effects, failed calls and future operations are excluded. Records are observations,
not proof of current file contents. Non-shrinking summaries remain rejected.

## Progress and delivery

Existing exact-call/unchanged-result reminders at 3/5/8 repetitions remain.
Additional source-attributed advisories cover unchanged ABABAB, eight consecutive
tool errors or a repeated nonzero exit class, and eight narrow Git overview
inspections. File-specific diffs/mutations do not match that Git pattern. Explicit
file edits and task/terminal operations reset or bypass the chain. Alternating
calls with changing results do not match. These reminders impose no call cap.

`--engineering-profile feedback` requests one final public-requirement review
after tool use even without a contract. It does not turn model claims into
acceptance evidence. Unlimited steps now correctly permit this stop continuation.
With a host-owned `--engineering-contract`, delivery requirements join the
existing bounded feedback policy:

```json
{
  "id": "public-delivery", "revision": 1, "kind": "change",
  "goal": "Produce the explicitly requested report and answer",
  "delivery": {
    "artifacts": [
      {"path": "out/report.md", "nonEmpty": true},
      {"path": "out/answer.txt", "runes": 12, "trimSpace": true}
    ],
    "fileSet": {"directory": "out", "files": ["report.md", "answer.txt"]},
    "noGitConflicts": true
  }
}
```

The length is illustrative, never a benchmark answer. Host requirements must
come from the public task. Artifact reads use the native workspace boundary;
file-set walks reject symlinks and inspect at most 1024 entries/256 files.
Unreadable artifacts, unavailable Git and traversal limits remain unverified.
The Git check reads unresolved index entries. Hidden tests and model-generated
oracles cannot bind requirements.

## Environment services

On unsandboxed Linux/macOS, add `--enable-shell` and
`--service-dir /absolute/private/service-directory` to mount ServiceStart,
ServiceStatus and ServiceStop. Start/Stop use existing approval; status is read
only. Ordinary Bash jobs keep their Session cleanup. Sandbox/Windows support
is not added.

ServiceStart launches a separate detached supervisor for a foreground command.
With deferred tools, an authorized caller receives a ToolSearch discovery hint
before ServiceStart is declared. Restricted callers receive no such hint; the
hint itself does not activate a tool.
The environment directory owns it across agent exit. Default lifetime is 30
minutes; range is 100 ms to two hours. Keep servers in the foreground. Running
confirms process start, not endpoint readiness. Verify independently, preserve
the exact service_id, then stop after the environment verifier:

```sh
pero-agent-acp services status --dir /absolute/private/service-directory --id SERVICE_ID
pero-agent-acp services stop --dir /absolute/private/service-directory --id SERVICE_ID
```

`stop_requested` acknowledges intent; poll status for confirmed termination.
Expiry also cancels the owned process group. Uncertain cleanup or a stale
receipt without termination evidence is unverified. The private output log is
capped at 4 MiB with a truncation flag. This is not a general daemon manager;
detached grandchildren are outside the foreground-command contract.

## Deadlines and trace reports

`--request-timeout-ms 180000` optionally bounds the whole provider request,
including continuous trickle streams. Zero preserves the outer task deadline;
earlier parent cancellation remains authoritative. REQUEST_DEADLINE_EXCEEDED is
absent from default retries, so expiry does not silently reissue a paid request.
Missing final usage remains unknown.

`agent/launch-config` records explicit model, context/output/step budgets,
thinking/image flags, compaction and service enablement. It is a frozen launch
receipt, not later routing authority. The existing offline reporter recognizes
this, tool-history/config, provider/request-timeout, progress advisories,
engineering/delivery-review and environment-service/receipt. JSON retains event
references; Markdown adds replacement/advisory/deadline/service counts beside
usage and failures. Receipts omit credentials/environment values. No extra model
call is needed.

## Verification

Local tests cover watermarks, replay/readback, protected shell failures, direct
forks, progress counterexamples, checkpoint boundaries, exact delivery, real Git
conflicts, unlimited stop feedback and continuous SSE deadlines. A real launcher
subprocess exits before independent loopback HTTP access, followed by exact
service stop and expiry checks. Related Go race suites and 25 offline reporter
tests pass. Eight standalone Bazel test targets, related `go vet`, the native
CLI build and whitespace checks also pass. The pinned AST parser suite passes
18 tests without skips; refreshing the two changed turn-function file receipts
restores 17 extracted pairs and zero unavailable selectors. This is native
runtime evidence, not Desktop/release acceptance or AST semantic equivalence.

Subsequent [real-provider reruns](terminal-bench-runtime-rerun.md) passed two of
three selected old failures, followed by a separate passing service-discovery
fix acceptance. The versions remain separate. Recorded usage grew substantially,
dominated by polyglot compile/patch loops; these observations establish neither
token savings nor a uniform full-suite score. Thinking/image configuration
already exists; paired model/configuration experiments remain separate.
Original full-suite results and strict-stop validity retain their own evidence
in [the failure review](terminal-bench-failure-repair-review.md).
