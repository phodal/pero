---
kind: issue
status: open
date: 2026-11-06
github_issue: 143
github_state: open
github_url: https://github.com/phodal/pero/issues/143
---

# Paper autonomous literature research

## User need

Read a seed paper, discover relevant work, learn from original sources and advance the investigation without manually triggering every round. The user explicitly requests a detailed proposal and one issue in phodal/pero.

## Current evidence

- Reviewed upstream master 01ec7f0d7edcbded4a214b91b56d99cd93c261e0, including literature discovery, frozen studies, research revisions, App tools, runtime assembly and Automation.
- Existing relation discovery supports related, references and citing, but its UI/API availability does not establish Agent tool access.
- Current continuation and acquisition contracts require explicit user intent. A bounded research authorization and durable overall budget are necessary for autonomous progression.
- Existing reports, original-source observations and execution owners should retain their responsibilities.
- Compared Karpathy autoresearch at 228791fb499afffb54b46200aca536f79142f117. Reuse its feedback-driven iteration principle with literature-specific evidence review.
- Searched local incident context and upstream issues. #79 is the lifecycle umbrella; #138, #9 and #77 own separate evolution, memory and reproduction concerns.

## Proposed delivery

Deliver one serial Host-agent research journey, persistent candidate and round records, source-bound learning, bounded automatic acquisition, pause/recovery and actual product acceptance. No implementation is started by this proposal.

The detailed public specification and acceptance criteria are maintained in [upstream issue #143](https://github.com/phodal/pero/issues/143), authored by sxyseo through the repository's authenticated GitHub CLI. The replacement body was verified against the original. The user now reports that the repository owner deleted the earlier, withdrawn issue #142. This tracker continues to refer only to #143.

The [artifact-aware implementation design](../design-docs/paper-autonomous-research.md) supplements the proposal against upstream master `6bdb05ed02d30f187e406ee6bb9930cf7a4860cb`. It specifies Program state, declared discovery tools, existing Harness feedback, cumulative budgets and direct App-to-Host artifact delivery. It is supporting analysis, not another active issue or implemented behavior.

## Verification

Source and issue review. Existing artifact/plugin transport tests passed 6 cases; existing research-record tests passed 5 cases on 2026-11-06. No autonomous feature implementation, real-provider research, paper downloads, training or UI acceptance were performed for this proposal.

## Implementation update — 2026-11-06

The user approved implementation. Branch `codex/paper-autonomous-research` now
contains the bounded Paper program, candidate and round records, source-bound PDF
and official HTML evidence, Host-bound tools, durable Harness request allowance,
same-turn feedback, Session artifact snapshots and the Paper research UI.
Implementation base: `185673fc8f6e6dc533f11cc9484149a2b6d6b948`.

The real Python/Host/Harness integration completes three rounds in one Session
and Turn, using each prior gap as the next question. Four artifacts retain four
versions each, verified by 16 public Host reads; finalization does not depend on
UI status polling. Additional tests cover lookup ambiguity/errors/pagination,
205 candidates, exact old exports, HTML authorization, versioned arXiv identity,
deadline and capacity stops, pause/resume and ordinary-mode regressions.

See [verification and known limits](../fitness/paper-autonomous-research.md) for
commands and local evidence. Independent reviews found and drove fixes for real
provider outcomes, canonical source acquisition, distinct revisions and deadline
projection. Existing full-suite environment failures reproduce on the clean base.
No live model research or scientific acceptance is claimed. The upstream issue
remains open for review and integration; this task has not published a PR or
closed the upstream request.

## Assessment update — 2026-11-07

The local three-round Python/Host/Harness journey and focused concept/UI checks
passed again. The current binary hashes match the saved trace. Upstream #143 is
still open under `sxyseo` with no comments. The journey reads one synthetic saved
PDF across three rounds; it does not discover and acquire a new real original.
The bounded feedback allowance can end an otherwise valid slow pending lookup,
and the new program is not yet linked to existing ResearchRecord revisions.
Real Host restart/resume, live model/source quality and native Desktop/Viewer
acceptance remain unverified. Exact evidence and completion gate are recorded in
[the verification report](../fitness/paper-autonomous-research.md). This remains
the one active tracker for #143.


## Gap closure update — 2026-11-07

The slow-worker continuation, dedicated Skill and ResearchRecord-history gaps
are fixed and covered by independent acceptance tests. A new real
Python/Host/Harness journey discovers synthetic fixture metadata and acquires a
synthetic original PDF through the real worker, reads it,
cancels, restarts Host, and resumes the original ACP session with cumulative
allowance (11→18 model attempts, one download). Four artifact categories retain
three exact versions. It reproduced a Windows background Python startup stall;
the production acquisition shell now uses the same environment's windowless
interpreter through multiprocessing's public spawn API. No test-side process
patch remains in the passing journey.

An independent review also found excess rounds could publish an orphan revision
before budget rejection; validation now precedes record writes. Record retries
across receipt/head faults and changed retry timestamps remain idempotent.
The 3-round/16-artifact-version journey and focused concept checks pass.
A separate real-network probe retained OpenAlex's 429 as partial success and
fetched a fixed-version arXiv PDF (15 pages); no model was involved.

The user explicitly deferred live-model acceptance. Local encrypted credentials
could not be loaded through the existing interface; none were exposed or copied
into evidence. Scientific quality, independent counterevidence coverage and
actual model cost remain pending, rather than being inferred from script-driven
tests. See the updated verification report for exact scope and known baseline
failures. This remains the canonical local tracker for the implementation and
the outstanding real-model/scientific acceptance.


Actual Windows Desktop/Scientific Viewer verification is now complete. It
reopened the original Run and displayed versions 4, 3 and 2 with keyboard input,
dark appearance and a narrow window. This exposed and fixed the Viewer's omitted
Research-source admission branch. The three boundary tests and actual UI journey
pass; screenshots and precise rebuild commands are in the verification report.
The separate native GPUI/macOS builds and live scientific quality remain outside
this Windows Electron acceptance.


Historical reports now mark unavailable final accounting explicitly instead of
presenting pre-terminal zero counters as measured usage. Export regression and
both controlled runtime journeys passed again; the desktop history assertion
also checks this distinction.

## Upstream PR preparation — 2026-11-07

Implementation is split into small Conventional Commits on
`codex/paper-autonomous-research-pr`, rebased onto upstream master
`ff7d463b846f3c465b892bfb75449d6e052bfafd`. Post-rebase acceptance and known
suite limits are recorded in the verification report. The author will manually
attach the inspected desktop screenshots. The PR references #143 without an
automatic closing keyword; real-model and independent scientific review remain
outstanding, so this issue stays open.


## PR review corrections — 2026-11-07

Review found hard-stop finalization bypasses, ready-job application failures that
blocked subsequent work, manual HTML preparation that reused a program download
grant, missing stable mutation IDs, sandboxed form submission and stopped-plan
cancellation recovery gaps. Host research I/O also blocked its command loop and
failed observations were cached. These are implementation defects; the rollout
continues to require independent scientific review of needs_review outputs.

The combined PR review also found that the real Python journey printed success
before cleanup and left its App backend holding process pipes open. The fixture
now disables the App while the Host still owns it, and writes success only after
cleanup. The three-round journey exits zero with no remaining fixture backend.

## P0 qualification preparation — 2026-11-07

The separate Host/Harness-only fixture had the same App-before-Host cleanup
omission: assertions passed but the process did not exit. It now disables its
App through the still-running owner, asserts normal Host exit and writes success
only after cleanup. The rerun exits zero. The opt-in live runner receives the
same cleanup ordering; no live execution is implied. Review then found that an
App-disable failure could skip later shutdown steps. A shared cleanup routine
now attempts every owner before reporting errors; actual subprocess/listener
regressions cover App, Host and Desktop failure. The real Python three-round
journey, focused Go race tests, two Rust artifact tests and offline scoring tests
pass again. See [current readiness](../fitness/paper-research-quality-readiness.md)
for build hashes, retained failure evidence and the remaining secure-credential,
generated-reader, real-model and independent-review boundaries. #143 stays open.

## Saved-run repair — 2026-11-11

Rechecked upstream #143 (open) and PR #157 (merged), then isolated this work from
`master@b1b952939f8986c150eb9d1b7d63166411657a63`. The November 9 retained runs
are now available: A stopped at MaxTokens with zero rounds; B exhausted 60 model
requests after one round. Neither meets the registered three-round gate.

The PDF claim tool required a rewritten quote although the domain could resolve
saved evidence by identity. B's seven quote-rejected claims all point to passages
with multiple saved quotations. Omitting the quote alone is ambiguous. The claim
owner now rejects that ambiguity and exposes stable indices within the immutable
report; an explicit `evidenceIndex` selects the saved exact quotation. Incorrect
explicit quotes still fail. The schema and bundled Skill expose this selection
without changing the report, observation, scientific standard or overall budget.

The live runner also still contained the pre-launch defects repaired only in the
old evidence directory: omitted App enable, obsolete resolve argument and wrong
seed receipt path. Those corrections and failure provenance are now in source.
MaxTokens remains a hard stop with no automatic model continuation.

[Repair verification](../fitness/paper-research-repair-143.md) records source,
commands, exact evidence, original-failure replay, continuation/accounting and
terminal delivery. Offline engineering passes do not revise the old failed runs
or constitute a new provider run. Independent human scientific review and a new
explicitly authorized provider attempt remain outstanding; #143 stays open.

## Acceptance audit — 2026-11-11 (5072cbc6)

The next isolated pass audits the original A/B acceptance matrix independently
of the missing live credential. Confirmed gaps: changing a quote within the same
observed passage counts as new evidence; the report UI omits claim stance and
coalesces unavailable runtime accounting to zero; the independent collector
normalizes whitespace before declaring a citation verified. These can mislead
progress or review even with a correctly bounded execution. Repairs retain the
existing Program, Host and review owners and the original scientific thresholds.
The pass also prepares a readable independent review dossier and checks actual
report/source navigation, rather than treating a raw JSON packet as usable review.

The audit repairs are committed in the isolated acceptance branch. Original
source scopes now own progress identity across PDF aliases and HTML windows;
rewriting a quote or unchanged screening rationale cannot extend the run.
The program UI exposes exact saved citations, claim stance, configurable
no-progress limits, unknown execution accounting and retained reading batches.
The collector checks exact original/report/observation membership and produces
a readable independent-review dossier without assigning scientific verdicts.

[Acceptance matrix and current evidence](../fitness/paper-research-acceptance-143.md)
map the original criteria to controlled runtime, browser, macOS Electron and
regression evidence, with unverified scope explicit. The user authorized both
DeepSeek Flash reruns at the original caps (60 requests, 4096 output tokens per
request, 12 minutes each), with credentials configured separately. This executor
still lacks `DEEPSEEK_API_KEY`; no new real-model call or human review occurred.
#143 remains open. The parent coordinator owns integration and any later closure.

Final navigation checks also cover indexed section/matrix links in new artifacts
and explicit recovery for ambiguous historical passage-only links. Actual
Electron PDF rendering and exact citation highlighting pass. The controlled
restart journey now waits for the resumed request frontier and matching final
checkpoint artifacts; it observes the same ACP session, 11 → 18 cumulative
requests, one download and four retained versions, with no additional model
dispatch from the waiter.
