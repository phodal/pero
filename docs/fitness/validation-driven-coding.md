---
kind: verification_report
---

# Validation-driven coding recovery

This 2026-11-05 follow-up implements the six remaining scoped improvements from
[the runtime comparison](reference-runtime-improvements.md). It uses the same
pinned Qwen, Codex and Pi references; no recovered prompt bodies were copied.
These are runtime and offline-analysis changes, not a new benchmark score.

## Diagnostics and validation progress

The shared `tool.Diagnostic` observes actual returned text and settled exit
status. Categories suggest dependency, platform, permissions, syntax, assertion,
compiler or tool-input investigation. They are heuristic hints, not root-cause
or acceptance verdicts. A bare exit 127 does not establish a missing executable.
Timeouts, interrupted/running results, signals and uncertain cleanup do not
establish a settled diagnostic. Fingerprints retain all visible diagnostic
text; changing line numbers and messages are not normalized away.

The runtime persists `tool/diagnostic` after its original tool result and emits
bounded source-attributed advice for a concrete dependency/platform/input error
or recurring identical diagnostics. The 24-operation window crosses file-edit
calls but never claims that an edit call proves changed input bytes. Existing
exact-repetition feedback may take precedence on the same operation.

With a host-bound engineering change contract in feedback mode, PreStep reads
the existing settled check proofs and declared-input digests. Two failures of
the same check with identical diagnostics distinguish identical checked inputs
from changed input bytes; already changed current inputs request fresh evidence.
Final tool results and completed steps remain mandatory. Passing, changing,
uncertain and unbound evidence do not trigger this recurrence advice. At most
three such reviews occur per turn. Observe mode remains quiet. No new check is
executed automatically and no public requirement or request budget is changed.

## Recoverable duplicate error projection

```sh
--tool-history-chars 48000 --tool-history-low-watermark 24000 \
--tool-history-keep-recent 4 --tool-history-deduplicate-errors
```

The additional flag defaults off and requires positive watermarks and a native
workspace for readback. Above the high watermark, older failures with the same
tool, full invocation arguments and complete identical diagnostics may become
eligible for clearing. The latest identical result and configured recent
eligible results remain. Unique failures, running/uncertain results, rich
content, spills, truncated streams and unrecognized receipt fields stay protected.
These protections can keep history above target.

Only the request surface is replaced. Original Session events, failure status,
call/result pairing and exact `ReadToolOutput` locators survive JSONL restore.
Reused call IDs bind to their original completed occurrence. A source-event
reference alone is not a projection: provenance-bearing append results retain
their own tool identity and error protection. A placeholder
identifies the retained diagnostic's result sequence and the old output's locator.
Character reductions are not token or billing estimates.

## Explicit model launch profiles

Copy [the example](../../harness/examples/model-profiles/coding-experiment.json),
replace its exact provider model ID and declare its actual capacity. Launch with
`--model-profile /absolute/profile.json`; an explicit `--model` must match.
The bounded version-1 JSON file rejects unknown fields and trailing objects.
It contains only model defaults, with no endpoint, credentials or authority.
Explicit CLI flags override supplied settings, including false and zero.
`disable_thinking: false` preserves the provider default; it does not force
thinking on. Reasoning effort is sent only if explicitly configured.

`--tool-format auto|native|claude` declares native tool naming independently of
plugin presence. Auto preserves existing behavior. Native naming with Claude
plugin packages is rejected. A profile never installs tools or enables shell
authority. The launch receipt records profile ID, exact file digest and effective
tool/protocol/reasoning/output/context/compaction settings, without its source
path or secrets. Existing provider/compaction validation owns effective budgets.

The example is an experimental starting point, not tuned DeepSeek/GLM settings.
For paired benchmarks, keep the same model/provider, task IDs, revision, official
deadlines and verifier. Label each profile and its digest; compare acceptance,
recorded cached/uncached/output usage, unresolved recovery windows and unknown
usage together. Do not change frozen baseline artifacts or infer savings from
byte reductions. The current work did not start another paid run.

## Atomic batch Edit

Both native `edit_file` and Claude `Edit` accept their original single replacement
or an `edits` array of 1–64 exact replacements in one file. Claude items use
`old_string/new_string`; native items use `old_text/new_text`. All matches refer
to the original file, require uniqueness unless `replace_all`, and must be
disjoint. Invalid/missing/overlapping replacements leave the file unchanged.
Single and batch forms cannot be mixed, including empty or false fields.

The existing workspace descriptor, lock, digest check, approval and replacement
engine still own the one committed write. No fuzzy matching or new tool alias
is introduced. File/output and combined replacement text stay bounded.

## Offline recovery windows

The Session reporter now emits `recovery.chains` and a Markdown table. A window
begins after an explicit failed operation's observed result. Repeated identical
invocation failures stay in that window. Success of the identical tool and full
arguments resolves it; a different failure starts a new unresolved window.
Otherwise turn/trace end leaves it unresolved. Unrelated successful commands
never resolve the failed operation. An unknown or changed invocation remains
conservative, including a changed timeout. This is an observation policy, not
proof of causality or task acceptance.

Windows do not overlap. Each subsequent committed response is assigned at most
once, with separate agent and compaction usage. The response that first caused
the failure belongs outside that new window. Prepared request boundaries,
unreported attempts, result/response sequences and elapsed duration are retained.
Prepared requests are not confirmed HTTP sends. Missing totals, unmatched
preparations and failed attempts retain unknown usage; known subtotals survive.
Cached reads remain separate; reasoning is already included in output. There is
no fabricated price or per-tool token attribution. Analyzer receipts now pin
all three Python modules.

The unchanged polyglot Session `88041974-2269-4902-99dd-8a26c2972d63` produces
42 windows: one matching-operation success and 41 unresolved. They cover 210
responses, with 10 outside windows. The largest window begins at original
result seq 43303 and includes 33 responses / 2,681,267 recorded tokens.
The full original total remains 13,321,025 tokens. Historical traces without
`tool/diagnostic` keep category unobserved. These windows locate investigation
cost; they do not establish avoidable spend, successful repair or token savings.
Artifacts: `/tmp/pero-validation-recovery-polyglot/summary.json` and `summary.md`.


## Verification

Seven affected Go race suites pass (`tool`, `harness`, `fstools`, `nativetools`,
`engineeringprofile`, native CLI and ACP), as do seven standalone Bazel targets,
related vet and the native CLI build. Final targeted race checks and CLI/tool
Bazel suites were rerun after adding changed-input/observe, reused-ID/recent
protection and real profile wire/receipt cases. Thirty offline reporter tests
and 21 trial tests pass. All changed code files remain below 1000 lines;
whitespace and credential-literal checks pass.

Eighteen pinned AST parser tests pass without skips. Before refreshing the
physical-read file receipts, two selectors were unavailable because delegating
Edit changed the enclosing file hash. Both read functions remain unchanged;
refreshing those receipts restores 17 extracted mappings with none unavailable.
This is source-receipt maintenance, not proof of cross-language equivalence.

These checks cover native local behavior; this change supplies no new paid
benchmark verdict or causal token-saving measurement. The existing Better
Harness exporter continues to consume the same summary and Session evidence.
