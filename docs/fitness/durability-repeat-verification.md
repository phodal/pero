---
kind: verification_report
date: 2026-11-06
---

# Durability problem-case repetitions

Two fresh OpenManus attempts reproduce the fresh-result visibility defect:
three Read results in `r2` and one in `r3` are cleared before their first model
request. Including the [original attempt](durability-trace-analysis.md), all
three observed OpenManus traces contain this defect. This small selected sample
does not estimate a population failure rate. Frozen feature checks pass, but
`r3` additionally changes default-mode exception behavior outside their coverage.

## Protocol and results

Run `20261106-sol-durability-repeat-01` executes OpenManus-r2, FastAPI-r2 and
OpenManus-r3 serially, from fresh Git copies at the original source revisions.
Each has a fresh venv installed from the first cohort's package-version snapshot.
Baseline controls confirm default search fallback and FastAPI's two original
tests pass, while the absent Google-only/blog features fail their probes.
Original prompts and frozen independent judges are reused without earlier
candidate output or independent feedback. No continuation or manual repair is
made. These are repetitions of a local adaptation, not an official score.

The binary is built from clean master
`2a667adf60a5cf66db7c3f7cfc5bde38acbf02fe`, with Go 1.27.3,
`CGO_ENABLED=0`, on macOS arm64. Its SHA-256 is
`fd6932a9f93900df2f281413b49e4dd9570bba1ca44475e78f719b0820558c0d`.
The Harness and Trial Git trees equal those in the original `5e87d45a` cohort;
there is no runtime treatment. Model `gpt-6.1-sol` uses the same
`http://187.124.157.143:8989/v1` Responses endpoint, nonstreaming, with no
automatic retries. Limits remain 128 requests/project, 16,384 output tokens,
1,800-second project, 600-second idle and 180-second request timeouts.
Deferred tools, the neutral plugin, feedback profile and 48,000/24,000-character
history watermarks with four recent results remain unchanged. Model compaction
and the delivery contract remain off. Credentials stay in the ignored `.env`.

| Trial | Frozen independent result | Candidate tests | Requests | Tools / failed | Reported tokens |
| --- | --- | --- | ---: | ---: | ---: |
| OpenManus-r2 | Four scoped search cases pass | 9 scoped pass; ordinary collection blocked | 23 | 45 / 2 | 395,734 |
| FastAPI-r2 | Ten HTTP/persistence/schema/Hero groups pass | 30 pass | 34 | 34 / 4 | 600,711 |
| OpenManus-r3 | Four scoped search cases pass; extra behavior change below | 9 pass | 24 | 44 / 3 | 441,744 |
| Total | Scoped acceptance with stated limits | | 81 | 123 / 9 | 1,438,189 |

All three processes complete with `end_turn`, zero exit and no cleanup errors.
All 81 responses report usage and all 123 calls have results; no request
deadline, batch-budget miss or turn error is recorded. Nine failed calls remain
failed evidence: missing optional packages/tools, candidate test failures later
corrected, and lint/type errors. Native project durations total 886.09 seconds,
excluding preparation and independent verification.

FastAPI delivers the SQLite blog table before independent verification. Review
confirms SQLModel schemas, async repository/routes, dependency injection and
repository/API tests. Independent checks include a fresh interpreter reading
the saved update and existing Hero behavior. Ruff is 8 baseline versus 7
candidate diagnostics; ty is 11 versus the same 11. No normalized diagnostic
is introduced. Whole-repository quality gates therefore still fail on inherited
code, despite feature acceptance.

OpenManus-r2 documents `[search].google_only = true`; r3 documents
`[search].mode = "google_only"`. Both default to multiple engines. Each frozen
judge loads that candidate's actual public TOML configuration and exercises
real search modules, replacing only the external search-engine seam. Search
success, empty/error exclusion of other engines and default empty-result
fallback pass. Full application, browser, sandbox, LLM and live search remain
unverified. R2 ordinary pytest fails on absent `browser_use`; r3's ordinary
command passes because its tests themselves bypass the eager package barrel.
This does not establish complete application import or dependency readiness.

## Reproduced context defect

The offline surface replay agrees with recorded tool-result wire sizes at all
81 request boundaries. Each row below is a newly produced result replaced by
an omission locator before its first subsequent prepared request. Raw outputs
remain in the Session; these are result instances, not distinct source lines.

| Trial | Read window | Result | Replacement | First following request |
| --- | --- | ---: | ---: | ---: |
| OpenManus-r2 | `web_search.py`, 201, limit 240 | 88 | 113 | 117, step 6 |
| OpenManus-r2 | `web_search.py`, 1, limit 210 | 131 | 153 | 157, step 7 |
| OpenManus-r2 | `README.md`, 45, limit 100 | 179 | 196 | 200, step 9 |
| OpenManus-r3 | `web_search.py`, 201, limit 240 | 82 | 105 | 109, step 6 |

There is no prepared request between each original result and its replacement.
The [canonical open issue](../issues/2026-11-06-tool-results-pruned-before-model.md)
continues to own the defect: protect all results since the preceding request
through first use, then apply ordinary retention. No repair is included here.

| OpenManus attempt | Requests before first Edit/Write | Tokens before first Edit/Write | Native Read lines | Previously returned at same digest | Still retained as original windows before repeat |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original | 9 | 113,754 | 2,537 | 874 | 1 |
| r2 | 10 | 128,985 | 2,708 | 1,416 | 0 |
| r3 | 7 | 83,384 | 2,552 | 717 | 3 |

These line counts exclude shell `cat` output and do not establish that every
earlier result reached the model. The repeated discovery is observable, but
its counterfactual savings cannot be measured without a repaired comparison.

## Diagnostic retention and change scope

FastAPI again retains verbose earlier failures: its first Ruff and ty results
contribute 269,603 serialized bytes across later requests. All failed results
contribute 312,603 bytes, 13.15% of its request payload. At the final request,
failed results occupy 28,646 of 41,664 tool-result bytes. Type/lint corrections
and checks are useful; the optimization target is retention of old full logs,
with current concise diagnostics and durable raw readback.

Across these repetitions, assistant function-call items occupy 1,078,316 bytes
and reasoning replay 842,880 bytes, together 34.33% of request payload. Tool
results occupy 2,436,192 bytes of 5,596,517 total. Tool-result clearing alone
does not bound the entire conversation. These are cumulative serialized bytes,
not provider token attribution or demonstrated savings.

R3 exposes a separate review limit. After candidate-written tests fail, it adds
generic exception handling in the existing search loop. A post-run diagnostic
on separate copies makes Google raise in default multi mode: baseline and r2
attempt Google three times then raise `RetryError`; r3 attempts Google three
times, falls back to Bing and succeeds. This may be a useful change, but it
expands behavior beyond selecting the requested Google-only mode. The frozen
default control tests empty results and does not pin this exception behavior.
The extra diagnostic is recorded separately; it neither changes the frozen
verdict retrospectively nor repairs the submission using hidden feedback.

Priorities remain: repair first-use visibility, rerun matched feature checks,
then measure complete-conversation compaction and compact diagnostic retention.
Also review changes against baseline behavior, especially when a model-written
test prompts a production-code change. This sample supports more explicit
scope checking; it does not justify adding a new scheduler, retry mechanism
or benchmark-specific runtime branch.

## Retained evidence

The run directory is
`/Users/phodal/benchmarks/ai4se/runs/20261106-sol-durability-repeat-01/`;
offline metrics and the frozen analyzer are under
`/Users/phodal/benchmarks/ai4se/analyses/20261106-sol-durability-repeat-01/`.
The [machine report](../design-docs/harness-durability-sol-repeat-evaluation.json)
records source/runtime refs and hashes for receipts, Sessions, manifests,
verification, the analyzer, post-run diagnostic and audit. Source clones,
prompts, frozen inputs/judges/postprocessors remain unchanged; no credential
literal or owned native process remains in the audit. Raw traces, binaries
and SQLite files stay outside Pero Git. The original cohort is unchanged.
