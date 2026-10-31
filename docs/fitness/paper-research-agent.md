---
kind: verification_report
date: 2026-10-30
---

# Paper research Agent verification

Scope: a macOS arm64 development build, with concurrent unrelated workspace
changes. The original diagnosis used `1350cf7f`; research persistence and Host
integration are `487a8a08` and `f451bcd8` after the concurrent master rebase, and
the Paper UI is `f6c2c22` with continuation visibility fixed in `e48beff`.
The [design](../design-docs/paper-research-agent.md)
defines the new domain and the existing Host/ACP ownership.

Acceptance: L2 for selected-PDF research on the macOS arm64 development build;
the supporting deterministic checks are L0/L1. Signed-package L3 acceptance is
outside this record.

## Deterministic checks

- Paper Python: 26 tests pass, including actual authenticated loopback HTTP,
  frozen PDF replacement, paginated reading, exact observed evidence, unresolved
  gap updates/export, independent saved prompts, and continuation at the budget
  boundary using recall before finalization.
- Root `npm run check`, Paper TypeScript and App/Desktop builds pass.
- App Use: seven tests pass through the same source test bundled with the
  existing esbuild tool. Real loopback MCP covers App-bound background access,
  ordinary-chat and cross-scope refusal, actual turn readiness and interruption.
  Direct Node source execution has an existing parameter-property/import issue;
  no unrelated Computer Use imports were changed for this work.
- The actual Electron journey with a scripted ACP fixture passes seven groups:
  real PDF import, single-session MCP reading of pages 4 and 5, exact PDF citation
  highlighting, parent-question follow-up, matrix revision and narrow dark
  editing, completed-study restart, and cancelled-study restart/explicit
  continuation using recall without replaying original reads. The complete
  Continue button must be in the viewport after cancellation, including when
  the final observed steps arrive after the cancelled status.
- The existing Paper Electron regression passes all 15 groups: import/discovery,
  local search, abstract answering and repair, cancellation, PDF annotations and
  matrices, exact citations, restart and Host grant boundaries. Its expected
  invalid-input/dependency responses are recorded separately from renderer
  errors; unexpected renderer errors are zero.
- The rebuilt Rust Host's three tests and the App Agent contract journey pass,
  including ownership, cancellation, frozen request recovery and journal restart.

The final deterministic profile overrides all builtin provider commands as
unavailable; only its synthetic Agent can run. An earlier development attempt
exposed that the default provider was selected again after restart. That mixed
attempt is not used as deterministic acceptance evidence.

## Evidence

The public PDF is Meta-Harness, arXiv `2603.28052v1`, 26 pages, SHA-256
`7d9b90f53a9f4801a090f1a4acb843340cde81e4f865f97d53fff2a6a570eb73`.

- `test-results/paper-study/fixture/result.json` records the seven journey checks,
  Host starts, selected pages, final reports, cancellation/continuation ledger and
  actual fixture MCP calls. Its short timings are synthetic wiring timings.
- `02-answer-and-original.png`, `05-editor-dark-narrow.png`,
  `06-paused-study.png`, `07-continued-study.png` and `continuation.json` retain
  the actual Desktop evidence in the same directory; `paused-layout.json`
  records the scroll region and continuation-control geometry.
- `test-results/research-agent/app-use.test.mjs` is the ignored bundled test
  runner used for the seven App Use checks.
- `test-results/paper-agent/result.json` contains the 15-group legacy regression,
  loaded App asset digests and expected console responses. It uses a synthetic
  PDF and scripted Agent; the new study journey and live runs use the actual
  Meta-Harness PDF.

The App Use test source is bundled without replacing its MCP behavior:

```sh
node --input-type=module - <<'JS'
import { build } from 'esbuild';
await build({entryPoints:['desktop/src/main/app-use.test.ts'],outfile:'test-results/research-agent/app-use.test.mjs',bundle:true,platform:'node',format:'esm',packages:'external',target:'node26',sourcemap:'inline'});
JS
node --test test-results/research-agent/app-use.test.mjs
```

## Real provider

The opt-in Codex journey in `test-results/paper-study/real-agent/` passes all six
groups, including three actual questions, exact citation highlighting, manual
matrix revisions and restart recovery. Its recorded model is
`gpt-6.1-terra[ultra]`; the earlier baseline used `gpt-6.1-sol[high]`, so their
quality and timings cannot isolate a workflow effect. The first two answers
took 186,916 and 302,213 ms in this run.

A separate disposable profile pins `gpt-6.1-sol[high]` through the installed
Codex adapter's per-process `CODEX_CONFIG`, without changing global settings.
Its first saved answer in `test-results/paper-study/real-agent-sol-high/`
actually reads and cites formal-method pages 4 and 5, which the old answer
missed. It uses one Host start, 22 study steps and 60 observed passages. Manual
review against the original text found no material method or numerical errors;
the answer also identifies the paper's unresolved 250/88 math-search-size
description and distinguishes the four search-unseen models from the five
evaluated models. Its follow-up also passes: the saved parent question is
retained, the Agent takes one Host session and 15 study steps, and the source
review confirms the ablation conditions, file-access statistics and limits of
the qualitative logs. The full six-group run passes all three questions,
matrix correction, exact PDF highlighting and restart with no Agent replay.
The final receipt records exactly `gpt-6.1-sol[high]`, three Host starts and zero
renderer errors. The H100 answer states its actual read/search scope, invents no
GPU hours or cost, and does not treat missing evidence as zero cost or a proof
of full-paper absence. Its recorded read pages and search matches were also
checked against that scope.

The old first/follow-up answers took approximately 177/193 seconds in one run;
the new same-model first/follow-up answers took 331,644/242,580 ms and are longer.
The old flow used four Host sessions per question; the new first answer uses
one. This demonstrates repair of the observed source-coverage gap, not a speed
improvement or a general benchmark result. Provider token/cost measurements were
not established. The original baseline remains in
`test-results/paper-harness/real-agent/`; synthetic fixture timing is separate.

The completed Terra answers correctly retain the ablation conditions (all three
variants have code and scores), the same-89-task TerminalBench search/evaluation
boundary and the distinction between qualitative log examples and controlled
experiments. The H100 question invents no GPU hours or training costs and
distinguishes search wall time/API credits from training compute. Exact quote
validation alone did not establish these semantic checks; the original text was
reviewed separately.

An initial live attempt saved the report but then kept emitting duplicate JSON
because the Host's generic prompt contradicted the App delivery contract. That
attempt is retained under `attempt-before-delivery-fix` and excluded from
acceptance. The Host now honors tool-based delivery and a brief closing message.

## Reproduce

Use current Host/Web build outputs and a prepared Python containing the pinned
PDF dependencies. Build only changed App/Desktop outputs, then run Electron
suites sequentially:

```sh
node scripts/build/apps.mjs --app paper-agent --reader-dist web/dist-reader
npm run build:desktop
PERO_APP_PYTHON=/path/to/prepared/bin/python PERO_HARNESS_PDF=/path/to/meta-harness.pdf node tests/e2e/paper-harness.mjs
PERO_APP_PYTHON=/path/to/prepared/bin/python node tests/e2e/paper-agent.mjs
PERO_APP_PYTHON=/path/to/prepared/bin/python PERO_HARNESS_PDF=/path/to/meta-harness.pdf PERO_PAPER_JOURNEY_AGENT=codex node tests/e2e/paper-harness.mjs
PERO_APP_PYTHON=/path/to/prepared/bin/python PERO_HARNESS_PDF=/path/to/meta-harness.pdf PERO_PAPER_JOURNEY_AGENT=codex PERO_PAPER_JOURNEY_MODEL=gpt-6.1-sol PERO_PAPER_JOURNEY_EFFORT=high PERO_PAPER_JOURNEY_OUTPUT=test-results/paper-study/real-agent-sol-high node tests/e2e/paper-harness.mjs
```

The default live run uses the configured model and login. The explicit model
override is isolated to the disposable test Agent and is checked against the
actual session-ready model receipt. Neither development acceptance nor exact
source matching establishes scientific correctness or signed-package acceptance.

## 2026-10-31 Harness² live user journey

L2, macOS arm64 development Electron, real alphaXiv/arXiv and authenticated Codex
through the real Rust Host/App MCP path. Source: `29e0c32` (the live sequence started at `0c1bcc3` and exercised the
scoped follow-up/navigation/delivery changes before they were committed). The first session receipt
reported `gpt-6.1-sol` with `max` reasoning. No literature responses or Agent
answers were replaced in these runs.

- Searched the exact Harness² title, added it from live results, downloaded and
  rendered all 37 pages. Queried the two recursion levels, then followed up about
  evaluation without ground-truth verifiers. Both reports saved with exact
  original evidence; clicking references opened and highlighted their source.
- The initial broad answers took 293,783 ms / 13 study steps and 392,362 ms / 22
  steps. These are individual observations, not a latency benchmark. The latter
  also reread evidence instead of retaining the previous observed sources.
- Added version-bound original-passage carryover. A real KEEP_BASE follow-up
  retained 55 prior passages and saved a report in 156,208 ms. This run exposed
  repeated quote-validation probes because errors did not identify the failing
  quotation. Error messages now identify the passage/page/quote and direct the
  Agent to recall the source; exact matching is unchanged.
- A subsequent short real question saved in 6,432 ms using one recall and one
  finalization, but the Host turn continued using tools and the composer stayed
  disabled beyond 30 seconds. Added post-delivery Host cancellation. A repeat
  saved in 12,626 ms and the composer was ready at 12,631 ms, with no new read
  steps. Questions and available carried evidence differ across these runs, so
  these times do not establish a controlled speedup or a general latency SLA.
- Reopened the actual saved reports after Desktop restart and checked the
  original PDF digest, page-specific buttons and fully rendered source-page
  highlights. Narrow-window citation navigation exposed the PDF rather than
  leaving it behind the conversation. Source navigation centers the quote so
  the page counter remains consistent when quoting near a page boundary.

Evidence: `test-results/paper-live-agent/answer-{1,2}.json`,
`test-results/paper-live-followup/`, `test-results/paper-live-final-delivery/`,
and `test-results/paper-live-final-render/`. The initial full script stopped on
an incorrect assumption that history reopens as an expanded active turn. The
persisted profile was reopened through the actual history controls and passed;
that initial failure is retained in its original directory.

Manual review checked the distinction between task-level and harnessing-level
recursion against quoted method pages, and KEEP_BASE against the original
Composer prompt. This is source/interaction acceptance, not independent
scientific reproduction, a signed package, or native Wry runtime acceptance.
Deep questions with max reasoning remain minute-scale.

Final regression: 33 Python cases, App TypeScript/build and root checks pass.
The complete 16-group Desktop suite passes with zero unexpected browser errors;
after centering source navigation, the focused PDF journey and an actual saved
report render were rechecked, including matching the page counter to its source.

## 2026-10-31 Context-file and conversation acceptance

Development Electron L2, the same authenticated Codex/real Host route and saved
37-page Harness² PDF, through `3e6eb781`. No source responses or Agent answers
were substituted. These runs cover the follow-up fixes after the earlier audit:

- Selected the actual first page using Page text → Discuss page: 2,822 characters
  / 2,844 UTF-8 bytes. The saved `.txt` matches the page text exactly, the question
  remains separate, and the frozen prompt includes the absolute file path.
  The initial file-backed question saved in 25,111 ms and unlocked at 26,431 ms.
- The workspace-only file tool rejected that absolute App-data path. A study
  context read recovered, but ordinary questions lack a study ID. Added the
  declared `read-context` App tool for both flows. A subsequent actual Agent call
  to that tool completed successfully, then saved a cited report in 35,004 ms;
  the composer unlocked at 35,008 ms. The report's distinction between two
  recursion levels was reviewed against the actual first-page abstract; clicking
  its citation showed the rendered page and exact quote highlight.
- A final real run explicitly requested `startLine=1,endLine=3`. The Agent used
  those exact arguments with `read-context`, then saved a cited report in
  44,654 ms and unlocked at 45,979 ms. Its successful tool/range receipt and
  rendered-source screenshot are in `test-results/paper-context-line-read/`.
- While Paper was hidden behind New Chat, a real question saved in 10,230 ms;
  the Host reached terminal `cancelled` after successful App delivery, and the
  composer was ready at 10,596 ms. This checks background cleanup, not merely
  cleanup after returning to the App.
- Added the real 36-page Harness Learning paper, started a question on Harness²,
  switched to Harness Learning, then hid Paper. The former report saved in
  13,672 ms; returning preserved the latter's source checkbox and reading title
  without displaying the other paper's active turn. Its Host was already
  terminal while hidden. Returning to Harness² reopened the cited result.
- Explicitly continued an older completed report and checked the new intent's
  parent ID. Scrolled upward during actual execution; report/status updates did
  not force the transcript down. That report saved in 26,126 ms.
- Reopened a saved actual report, unchecked all sources and pressed Enter with
  Send disabled: no context/study/intent POST occurred. Restoring the source
  retained valid report-to-PDF navigation. This check made no new model request.

Receipts/screenshots: `test-results/paper-context-live/`,
`paper-context-background-rerun/`, `paper-context-switch-source-rerun/`,
`paper-context-branch-scroll/`, `paper-context-send-guard/`, and
`paper-context-universal-read/` under `test-results`. The last includes the actual
completed App-tool call receipt in `context-read.json`. Initial background and
source-switch attempts stopped on test navigation/focus assumptions; their
original failure artifacts remain, and corrected reruns exercised the controls.
Observed times use different questions/history and are not a latency benchmark.

Final checks: 35 Python tests (including abstract-only file reads over authenticated
HTTP, exact CRLF/Unicode, reload, range bounds, source scoping and integrity), App
TypeScript/build, root checks and the complete 16-group Desktop fixture suite
pass. Final fixture output: `test-results/paper-context-final-regression/`, zero
unexpected browser errors. Fixture output is not real-provider acceptance.

The screenshots were inspected. Manual native-app inspection was unavailable
because the Mac was locked; these results do not establish native Wry or signed
package acceptance. Standard/side/App Chat view unification remains unimplemented.


## Shared Chat integration — 2026-10-31

Paper no longer owns a React composer, Agent selection, transcript poller or
closing-message report parser. Ask, comparison, selection and saved-record
continuation use the shared Host draft and frozen App references. Declared
prepare/continue/submit tools complement the existing evidence ledger and
context reader. Electron and native share AppChatContext, MCP authorization and
AppWriteRoutes; native still does not provide general App UI operation/capture.

Development checks on macOS arm64: Paper TypeScript/build, root checks, native
feature build, 35 Python tests, 32 Chat/Workbench Rust tests and 15 context/MCP
tests pass. Actual Electron passes 16 groups with zero unexpected browser errors.
The explicit synthetic PDF study journey passes four groups, including
cancellation, restart and recall-based continuation in shared Chat. Native
passes three fixture checks through Wry, GPUI, stdio Host, Python and MCP.

Receipts: `test-results/paper-agent/result.json`,
`test-results/paper-study/shared-chat/result.json` and
`test-results/native-paper-chat/result.json`. The study journey used a synthetic
two-page PDF; the earlier publication-PDF/real-model evidence above remains
historical and is not a verification of this Chat integration. Signed package,
real-provider output quality and scientific acceptance are separate.

See [the integration record](../issues/2026-10-31-paper-shared-chat.md) and
[the capability boundary](../design-docs/paper-research-agent.md#shared-conversation-and-declared-paper-capabilities-2026-10-31).
