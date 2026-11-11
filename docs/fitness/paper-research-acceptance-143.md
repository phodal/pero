---
kind: verification_report
date: 2026-11-11
github_issue: 143
github_url: https://github.com/phodal/pero/issues/143
implementation_base: 5072cbc606064cd6141848a23587c7bdcbdf997e
---

# AutoResearch acceptance audit

This pass repairs remaining engineering/review defects against the original
[#143 acceptance criteria](https://github.com/phodal/pero/issues/143), re-read on
2026-11-11 (still open). It does not complete the real-provider or independent
human scientific gates. The user authorized two new DeepSeek Flash attempts,
each retaining 60 requests, 4096 output tokens/request and 12 minutes. The
executor's `DEEPSEEK_API_KEY` is absent; no provider request was made. The request
and token limits are not a monetary cap. Credentials are to be configured
separately; no other credential location was searched.

Worktree: `/Users/phodal/workspaces/pero-issue-143-acceptance`, branch
`codex/paper-143-acceptance`. Code commits: `b2ddfa02`, `df70e809`, `0720adb1`,
`9d402e94`, `b7c0b0c4`, `e2ade34b`, `56d62aa0`, `46949167`, `c9b39682`, `a81ef136`. No push or issue closure was performed here.
The coordinator owns integration.

## Repairs and owners

- `ResearchEvidence` identifies progress using the retained original and read
  scope. PDF aliases with identical original bytes/page/window, a shortened
  quote, another report, or a reworded unchanged screening decision do not
  manufacture progress. HTML uses source digest/block/unit/window/content digest;
  a different observed window still counts. Historical claims resolve through
  their saved Studies and observations; old checkpoints are not rewritten.
- `ResearchPrograms` continues to consume Paper/Host states. It exposes claim
  stance, the existing configurable no-progress limit, and `Not yet reported`
  for missing execution accounting. It links saved reading batches even before
  a round is committed. These are current Study summaries, not a new immutable
  round snapshot or a second report store.
- PDF claim actions pass the complete saved claim through the existing `cite`
  owner. Choosing the second quote from one passage no longer guesses the first
  reference. New exported links retain the saved evidence index, including matrix
  references. Ambiguous old passage-only links request an explicit claim choice
  instead of silently choosing the first; old artifact bytes remain unchanged.
  HTML links are explicitly labelled original sources; no new HTML observation
  viewer is introduced.
- The independent collector checks exact quote bytes, report membership,
  original digest and the observed page offset. Whitespace normalization cannot
  turn an altered citation into a match. `QualityPacket` remains the sole grading
  owner. A read-only `quality/review.html` provides claims, observed passages,
  retained PDF page links, complete reports, expected sources, requirements,
  gaps and final assistant text alongside the blank human review form.

UI migration: passage-only anchors → shared SDK Button with full-claim callback;
missing runtime → explicit unknown text; hidden claim stance → shared Badge;
hardcoded stop copy → existing protocol field via shared Field/Input. Consumers
are the Paper program page and its existing index-level citation/study owners.
No token source, generated style, execution owner or source schema was changed.

## Observed checks

Evidence is under this worktree's ignored `test-results/` directories.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Program behavior | 24 tests pass, including same-byte PDF aliases, re-quotes, reworded screening, distinct HTML windows, limits, pagination, retained intermediate Study and restart | `paper-143-acceptance/program-tests.log` |
| UI state/behavior | 10 tests pass; exact second quote, stance, retained Study callback and unknown accounting are exercised | `paper-143-acceptance/ui-tests.log` |
| Existing Paper regression | 37 tests run: 36 pass, one Windows process-handle case skipped on macOS; single-paper research, bounded Studies, discovery, manual import, frozen citations and exports | `paper-143-acceptance/regression-tests.log` |
| Independent quality | 9 tests pass; altered whitespace and wrong report identity fail citation verification | `paper-143-acceptance/quality-tests.log` |
| Runner and budget | 7 Node tests pass; Host finalizer/budget contract passes | `paper-143-acceptance/runner-tests.log`, `adapter-budget.log` |
| Build/typecheck | Production Paper build and TypeScript pass | `paper-143-acceptance/build.log`, `typecheck.log` |
| Production browser | Explicit save/start, same-run pause/resume, stop/recovery, exact second-quote navigation, unknown usage, light/dark, narrow layout and keyboard pass | `paper-programs/result.json`, `paper-143-acceptance/browser.log` |
| Real Host/Harness/Python | Three automatic rounds, 26 loopback requests, four artifacts × four retained versions; tool inputs follow saved gaps | `paper-program-python/result.json`, `evidence.json`, `paper-143-acceptance/final-runtime.log` |
| Restart/resume | Same ACP session, cumulative requests 11 → 18, one original download, four artifacts × four versions, final completed projection | `paper-program-journey/result.json`, `paper-143-acceptance/final-journey.log` |
| Actual Electron | Reopened saved program, opened the selected saved Study/report and rendered PDF, highlighted the exact cited original, returned to the retained plan, opened shared Chat artifacts and read versions 4 → 3 → 2; no projection error in final run | `paper-program-desktop/result.json`, `paper-143-acceptance/desktop.log` |
| Retained real B review preparation | Copied old B has two exact citations, one original, one round and no mechanical integrity errors; remains unreviewed and fails the original three-round execution requirement | `paper-143-acceptance/retained-b/quality/` |
| Review dossier browser | Light/dark, two claim cards, original links and narrow layout inspected; no page errors | `paper-143-acceptance/review-browser.json`, `review-claim-light.png`, `review-dark-narrow.png` |
| Live readiness | All local prerequisites except provider credential pass; zero provider requests | `paper-143-acceptance/preflight.json` |

Desktop uses the retained final profile
`/private/var/folders/l8/7nm25zns5qjds0jc7z8f1gpm0000gn/T/pero-paper-python-JWtdoG`.
Original-scope identity was rechecked through the real runtime and domain suites.
The initial Study screenshot was taken before the PDF finished loading. The final
Desktop test waits for a decoded page image and separately asserts a visible exact
citation highlight; both final screenshots were inspected. Indexed matrix links
and ambiguous historical-link recovery were additionally tested in the production
browser after the final index-route change.

Screenshots actually inspected:

- Browser: `paper-programs/exact-second-quotation.png`,
  `unknown-accounting-light.png`, `claims-dark-narrow.png`,
  `export-matrix-citation.png`.
  The second quotation is shown in the evidence panel, both stances remain
  textual, and the narrow dark layout wraps long titles without horizontal loss.
- Electron: `paper-program-desktop/completed-program.png`,
  `saved-reading-record.png`, `exact-source-pdf.png`,
  `historical-artifact-dark-narrow.png`.
  The final program has no projection error, report/reading actions remain
  accessible, the original PDF is rendered with a visible citation highlight,
  and the historical artifact retains its earlier findings and
  explicitly unknown final accounting.
- Dossier: `paper-143-acceptance/review-claim-light.png`,
  `review-dark-narrow.png`. Original whitespace remains visible and wraps on a
  narrow screen; the source-page link and unreviewed status remain explicit.

Earlier Desktop attempts exposed stale test setup: the runtime journey disables
its App during cleanup, while the old Desktop test required only Scientific
Viewer. A temporary extra-permission hypothesis did not fix it and was reverted.
The final test enables Paper via the test product's required-App configuration,
uses a fresh matching declaration binding, and asserts no projection error.
A separate attempt correctly rejected a declaration edited during diagnosis;
no production grant or frozen Run binding was weakened.


The final artifact-link check also exposed two stale runtime-test assumptions:
Markdown used to contain passage IDs, and the restart journey assumed version 3
was necessarily the final projection. It now checks indexed report links while
the evidence matrix retains exact passage IDs. The journey uses the existing
finalization waiter with the resumed request count as a lower bound and matches
all exports to their checkpoint. Its observed final state is completed at 18
requests, rather than the previous cancelled receipt at 11; this changes no
production lifecycle or model budget and dispatches no extra model request.

## Original acceptance matrix

“Engineering evidence” is bounded to the named checks. It is not a completed
real-source/provider/scientific or cross-platform acceptance claim. Earlier
restart/terminal evidence is linked from the
[repair verification](paper-research-repair-143.md); the broader controlled
fixture/source evidence remains in [the original verification](paper-autonomous-research.md).

| Original acceptance item | Current evidence and remaining scope |
| --- | --- |
| Real saved seed, discovery/new sources, ≥3 automatic rounds | Controlled real-stack three-round test passes. Original live A=0/3, B=1/3; new authorized live runs await credential. **Open**. |
| Cycle, cross-provider duplicate, ambiguous seed, counterevidence, missing full text, irrelevant candidates | Existing controlled journey/domain suites retain these cases; this pass additionally checks same-byte PDF aliases and unchanged screening reasons. Real retrieval quality is unproven. |
| A gap changes actual next query/read | Real scripted runtime checks successive read/question inputs against saved gaps; semantic appropriateness still needs human review on live output. |
| Fixed versions/actual observations; citations return to original | Domain suites and exact collector pass; browser selects the correct second quote and indexed matrix evidence. Desktop PDF highlighting passes; ambiguous old links explicitly require a claim choice. |
| Immutable old Studies/reports; bounded batches and complete pagination | Program/record/export tests pass, plus four historical artifact versions. Saved Study summaries are accessible separately from rounds. |
| Recover checkpoints; old answers not evidence; no automatic human acceptance | Current real restart journey and reopened Store/desktop evidence; generated claims remain `needs_review`. |
| Rewrites/same bytes/same observation do not create progress | Corrected original-scope identity and screening digest; current PDF/HTML no-progress cases pass and retain unresolved gaps. |
| Actual action/model budgets; terminal/intermediate delivery | Current three-round runtime plus prior terminal hard-budget journey; missing UI usage now stays unknown; uncommitted saved Study reports remain readable. |
| Unsupported enforced budget rejected; reconnect/Study/resume cannot reset | Current real restart plus prior Host/Harness budget/race results; current adapter contract passes. No new provider receipt or cost observed. |
| Authorized public acquisition has source-bound receipts; metadata mode does not download | Existing acquisition/journey tests, retained in earlier verification; no new public acquisition in this pass. |
| Unauthorized source/code/install/publish cannot be enabled by proposals | Existing frozen Program/tool/Host policy boundaries retained. This pass neither extends policy nor claims a fresh independent security audit. |
| Pause/Stop owner receipts; unknown execution blocks replacement | Browser and UI state tests cover pause/resume/cancel failure/stale lookup; current real restart journey covers owner recovery. |
| Restart preserves queries/budgets/next step; history costs no model calls; persistence failures honest | Reopened real desktop uses retained records without model requests; current real restart and Store/record recovery tests retain budgets and immutable output. |
| Reader/records entry, shared Chat, all request/domain states have recovery | Current saved program → Study/report → shared artifacts path and browser state tests pass. This pass does not claim every Native state or every historical entry path re-inspected. |
| Light/dark/narrow/long title/keyboard/Split; actual Desktop screenshots | Current production-browser and actual macOS Electron evidence above. No new GPUI Native, Windows or packaged-app acceptance. |
| Pure concept tables and few real wiring tests | Existing concept tables extended; production Store/Host/Python and browser/desktop seams exercised. No duplicate execution state machine. |
| Fixed public task + real provider, complete traces and usage | Retained November 9 failures are preserved; new two-case authorization recorded but no credential, so **open**. |
| Independent review of support, counterevidence, next actions and denominators | Exact collector/scorer plus readable dossier are ready. No human review or scientific pass was fabricated. **Open**. |
| Original single-paper/Discover/import/continue/exact-citation regressions | Selected existing regression suite: 36 pass, one Windows-only skip. Full suite and other platforms not rerun. |
| Close only after A/B; related issues retain scope | #143 remains open; no claim that #77/#79/#138/#163 are complete. |

## Reproduction and executable identity

No Rust build or dependency download was performed. Executables were copied
before testing so another chat's rebuild could not replace the files in use:

- Host SHA-256: `9fa3ce64d462609fc7f4cf7a36a4b68aeaaa783506ba248c37a72fd5ce35466d`.
- Harness SHA-256: `b1965f56e418370464f2586a82cc6fb9fa6132f24efb0cd2d4a35a7bc344faed`.

Paper was rebuilt in this worktree. Desktop/web/Scientific Viewer use copied
existing local build assets. `paper-143-acceptance/source-manifest.json` records
file hashes; these hashes identify tested files, not an unrecorded binary build
revision. Python is `/private/tmp/pero-paper-review.gwadvk/cp312/bin/python`
with the pinned PDF dependencies. Node dependencies were reused from the main
checkout. All provider traffic in controlled runs is loopback.

```sh
node scripts/build/apps.mjs --app paper-agent --reader-dist /Users/phodal/workspaces/pero/web/dist-reader
node_modules/.bin/tsc -p apps/paper-agent/tsconfig.json
node --test apps/paper-agent/test/research-program-state.test.mjs
node tests/e2e/paper-programs.mjs
PYTHONPATH=apps/paper-agent/backend "$PERO_RESEARCH_PYTHON" -m unittest discover -s apps/paper-agent/test -p 'test_*program*.py'
"$PERO_RESEARCH_PYTHON" -m unittest discover -s tests/runtime -p test_research_quality.py
node --test tests/runtime/research-quality/*.test.mjs
node tests/contracts/paper-research-budget.mjs
node tests/runtime/paper-program-journey.mjs
PERO_RESEARCH_KEEP_PROFILE=1 node tests/runtime/paper-program-python.mjs
# Use profileDirectory returned by the successful controlled run:
PERO_RESEARCH_UI_PROFILE="$RESEARCH_PROFILE" node tests/e2e/paper-program-desktop.mjs
```

Set `PERO_RESEARCH_HOST`, `PERO_RESEARCH_AGENT` and `PERO_RESEARCH_PYTHON` to the
recorded local executable paths before runtime commands. The public-source/live
runner remains explicitly opt-in; these reproduction commands do not start it.

To prepare independent review, copy a retained run to a separate output tree,
then run `paper-program-quality.py collect <copy>`. Open `quality/review.html` and
supply the blank form to an independent human. The existing score command checks
the frozen packet and original digests; opening the HTML does not score or alter
anything. The original retained November 9 run directories were not modified.
