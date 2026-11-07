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
