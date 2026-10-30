---
kind: issue
status: resolved
date: 2026-10-30
---

# Paper research misses central method pages despite two retrieval rounds

## What

Real Electron / installed Paper Agent / Codex `gpt-6.1-sol[high]`, based on
`1350cf7f` with unrelated concurrent workspace edits, was tested using the public
26-page Meta-Harness PDF (`2603.28052v1`). The question was:

> 这篇论文的核心方法是什么？proposer 使用哪些历史信息？请用证据矩阵整理方法、反馈来源、评估任务。

The first answer saved about 177 seconds after the initial reading screenshot.
This is one observed run, not a latency benchmark. It used planning, two evidence
selections and answering in four separate Host-owned Agent sessions.

The frozen evidence contains twelve passages from pages 2, 2, 7, 17, 16, 3, 6,
7, 23, 9, 22 and 17, but none from pages 4–5. Those omitted pages contain the
formal search-loop description and Algorithm 1. The answer consequently says
the complete Section 3 algorithm is missing, including candidate selection and
stopping rules, although the supplied PDF contains them. It correctly qualifies
this as a retrieval limitation rather than absence in the full paper.

The quoted ablation values and TerminalBench same-89-task evaluation boundary
match the original source. Actual citation clicking produces a PDF highlight.
The finding is incomplete evidence coverage and long waiting, not demonstrated
fabrication of those checked facts.

## Why

The reading flow gives the answering session only the selected lexical-search
passages. Recognizing a gap does not let the answering Agent read the missing
section: the two-search ceiling has already been reached. Long broad keyword
queries and the resulting passage selection missed the central method pages in
this run. Ranking, candidate coverage and selection need separate measurement
before attributing the entire miss to one component.

## Evidence and next verification

- `test-results/paper-harness/real-agent/first-answer.json`: complete saved report,
  frozen passages and retrieval queries.
- `test-results/paper-harness/real-agent/02-answer-and-original.png`: actual
  Desktop answer, evidence matrix and PDF citation highlight.
- `test-results/paper-quality-review-20261030/original-page-5.png`: independently
  rendered original algorithm page.

The follow-up completed about 193 seconds after the preceding answer screenshot.
Its Table 3 numbers and file-access statistics (median 82, code 41%, traces 40%)
match the original. It appropriately limits the ablation interpretation instead
of claiming all summary strategies fail. The H100 question also produced a saved
answer without inventing GPU hours or costs, distinguishing search wall time from
training compute. See `followup-answer.json` and `unsupported-question.json` in
the same evidence directory.

All three questions used four stages each, producing twelve Host sessions visible
in the workspace sidebar. The complete suite did NOT pass: after Desktop restart,
`openApp()` timed out waiting for the App's Add papers button, and `failure.png`
shows the Apps catalog. This run does not establish restart recovery. No claim of
lost research data is supported; the failure is at reopening the panel and could
be a stale coordinate in the test. No unexpected renderer errors were recorded
before this failure.

No product code was changed during the initial diagnosis. The repair needed to prove that a broad
method question can read the formal method section, while preserving exact
source references; it must not merely remove the limitation wording.

## Resolution

The full-PDF question now starts one existing Host/ACP session. The Agent can
read frozen pages, search, save findings/gaps and finalize through the declared
App tool. `ResearchStudy` preserves actually observed passages and incomplete
work; explicit continuation recalls that evidence under a new Host request.
The backend is `487a8a08`, Host access/delivery is `f451bcd8`, and the Paper UI is
`f6c2c22`. See [the design](../design-docs/paper-research-agent.md).

The same question, PDF and actual `gpt-6.1-sol[high]` model were rerun in an
isolated test profile. The new answer actually reads and cites pages 4–5,
explains Algorithm 1, interface validation, candidate evaluation and Pareto
return, and no longer marks the available formal algorithm as missing. Its
report, frozen passages and ledger are in
`test-results/paper-study/real-agent-sol-high/first-answer.json`, with the actual
PDF highlight in `02-answer-and-original.png`. Original-source review found no
material method or numerical errors in that answer. This repairs the observed
coverage failure; it does not establish general scientific accuracy.

The repair does not demonstrate a latency improvement. This same-model first
answer took 331,644 ms, observed 60 passages across 21 pages and gave a longer
answer than the old approximately 177-second run. It used one Host session
instead of four. Tool-budget and prompt changes are part of the new flow, so
this is a single-case acceptance check rather than a controlled benchmark.

The separate `gpt-6.1-terra[ultra]` live journey passes three questions, citation
highlighting, matrix correction and completed-report restart. Its different
model is recorded explicitly. The deterministic journey also verifies cancelled
study restart and explicit continuation without replaying reads. The baseline
restart failure was the test's App reopening path; the updated journey opens
through actual catalog navigation and verifies retained data. Final regression
results and remaining scope are maintained in
[the verification record](../fitness/paper-research-agent.md).
