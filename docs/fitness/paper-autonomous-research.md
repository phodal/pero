---
kind: verification_report
date: 2026-11-06
github_issue: 143
github_url: https://github.com/phodal/pero/issues/143
implementation_base: 185673fc8f6e6dc533f11cc9484149a2b6d6b948
---

# Paper autonomous research verification

Latest acceptance: the offline feature checks, controlled real-stack journeys,
and Windows Electron/Scientific Viewer inspection pass. The public-source probe
also passed, without a model. **Real-model and scientific-quality acceptance
remain pending; #143 must stay open.** The final results and desktop screenshots
are described under “Gap closure” and “Actual Desktop and Scientific Viewer”.
Earlier measurements below are retained as dated development evidence, not as
the final feature counts or current Desktop verification status.

Implementation started on the revision above and is published from
`codex/paper-autonomous-research-pr`. The integration check below records the
subsequent rebase onto upstream `master`.
The [design](../design-docs/paper-autonomous-research.md) and
[canonical tracker](../issues/2026-11-06-paper-autonomous-research.md) retain the scope.
Evidence below is from Windows, Python 3.11, Node 22 and the installed Go/Rust toolchains.

## Product behavior

Open Paper's **Autonomous research / 自动研究** page, or use the Reader action.
Select 1–5 saved papers, enter the question, scope and screening criteria, choose
the source policy and limits, then save. Saving does not start a model.
**Start research** starts the existing builtin Pero App Run and opens its shared
conversation. The configured Pero model supplies research decisions.

The plan is frozen. Paper owns candidates, observations, rounds and checkpoints;
Host owns the actual Session; Harness owns model attempts. Pause cancels the
current execution and finite acquisition workers. Resume uses the same Run and
cumulative allowances. A hard stop, elapsed deadline or exhausted allowance
requires a new plan; it does not silently reset the old one.

The three source policies are `saved_only`, `public_pdf`, `public_fulltext`.
The last additionally permits fixed-version official arXiv HTML. Unknown HTML
versions are not guessed. alphaXiv identities resolve to canonical official PDF
URLs; different explicit versions remain different candidates even with one DOI.
HTML authorization is an explicit frozen program grant, not a fabricated manual
download confirmation. Saved HTML uses the existing document/observation/report
owners. Only text in actually observed prose windows enters HTML round claims;
math, tables, images and original markup retain their source observations and
unresolved interpretation status. HTML block IDs never become PDF passage IDs.

Provider failures, partial results, seed choices and pagination are returned as
bounded retrieval outcomes. The complete original response stays in the job
record. Candidate and program lists are paged; abstracts are requested for an
individual candidate. Existing source-store capacity stops the program with
`storage_capacity`, preserving existing sources and the separate program export.

Each committed round can deliver a report, evidence JSON, literature and JSONL
log directly to the existing Session artifact catalog. Terminal projection also
delivers them from the Host's existing owner tick, with no UI polling required.
The catalog is the authoritative delivery receipt. An identical
`thread/program/checkpoint/slot/digest` reuses its saved version; a new checkpoint
creates a new provenance version, including when a slot's bytes are unchanged.
Export chunks preserve complete JSON/JSONL records. Old checkpoint/slot bytes do
not depend on later mutable runtime projections or source workspace files.

## Initial implementation evidence (before gap closure)

| Check | Observed result |
| --- | --- |
| Python program/candidate/lookup/HTML/export concepts | 20 new tests pass: exact evidence, quotas, no-progress, historical export, operation replay, 205 candidates, list paging, official HTML, provider outcomes, version distinction, deadlines and source-store capacity |
| Real Python + Host + Harness + Desktop App Use | One Session and one Turn complete three actual Study read/finalize/commit rounds; the next question uses the preceding gap |
| Actual provider transport in that integration | 25 scripted loopback model requests, including 4 real content-reference reads; no external model or scientific claims |
| Artifact handoff | Four logical artifacts, four versions each; all 16 versions read through the public Host artifact interface and compared byte-for-byte and by SHA-256 |
| Background finalization | Terminal artifact events arrive without `agentrun.status` polling |
| Harness research behavior | Seven focused Go tests pass with `-race`: durable attempts, missing/corrupt audit, ordinary mode, same-turn continuation, failure/cancel stops, feedback limits, actual dispatch whitelist |
| Artifact persistence | Two Rust research-artifact integration tests pass, including reopen, exact replay, different checkpoints, thread separation and rejected file/caller artifact IDs |
| Existing Desktop adapters | Six existing plugin/artifact delivery tests pass; Host-budgeted adapter contract passes |
| Type/build/protocol checks | Root and Paper TypeScript, Paper production build, Host build, shared Chat UI compile check, Harness build and generated protocol check pass |
| Production Paper UI in Chrome | Save without execution, explicit start, pause/resume on original Run, stop/disabled states, reload after errors, light/dark, narrow overflow and keyboard focus pass |

The real-stack test caught two genuine integration failures before they were
fixed: a tool description exceeded the Host's 1000-byte limit, and the new schema
used keywords unsupported by `AppParameterSchema`. It now installs and calls the
actual production manifest without rewriting it.

Independent tests were written from acceptance criteria. RED cases included
missing program/HTML/outcome/paging behavior, missing terminal delivery, invalid
HTML claims and deadline/capacity handling. Mutation checks detect removed read
quotas, altered historical exports, disabled round/no-progress limits, broken list
paging, lost provider states/cursors, malformed export chunks and unexpected
automatic execution on Save. Mutations were restored and the corresponding
checks rerun GREEN.

Reproduce from the repository root (PowerShell):

```powershell
$env:PYTHONPATH='apps/paper-agent/backend'
python -m unittest discover -s apps/paper-agent/test -p 'test_*program*.py'
python -m unittest discover -s apps/paper-agent/test -p test_research_candidates.py
python -m unittest discover -s apps/paper-agent/test -p test_research_exports.py
go -C harness/go test -race ./cmd/pero-agent-acp -run 'Test(PaperResearch|ResearchRequest|OrdinaryRequest)' -count=1
node scripts/build/harness.mjs
node scripts/cargo.mjs build -p pero-host --target-dir target/research-validation
node scripts/cargo.mjs test -p pero-runtime --test research_artifacts --target-dir target/research-validation
node tests/runtime/paper-program-python.mjs
$env:PERO_RESEARCH_HOST='F:/pero/target/research-validation/debug/pero-host.exe'
node tests/runtime/paper-program-harness.mjs --no-status-poll
node tests/contracts/paper-research-budget.mjs
node scripts/build/apps.mjs --app paper-agent
$env:PERO_CHROMIUM_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
node tests/e2e/paper-programs.mjs
```

Use the machine's executable paths; the independent target directory avoids
overwriting an active Desktop Host. Tests use temporary profiles and loopback
listeners. Python integration requires the existing PDF dependencies. It uses a
valid locally authored three-page PDF, the production HTTP/domain stack, and
scripted model responses. It does not replace the research backend with a stub.

Local evidence directories (ignored by Git):

- `test-results/paper-program-python/`: result, full tool/model/event trace,
  snapshot checks, and original manifest/schema RED evidence.
- `test-results/paper-program-harness/`: lifecycle/caller/budget handoff test.
- `test-results/paper-programs/`: UI result/screenshots, builds, red/green evidence,
  and baseline/current regression logs.

## Initial regression comparison and scope (before gap closure)

The compared full Python runs contain 332 baseline cases and 351 current cases
(the final added capacity case was also verified separately). The full suite
still has 11 failures, 11 errors and 5 skips. The same
22 failing case identities reproduce on the clean implementation base; there
were no new failing case identities in the compared full runs. They include
Windows symbolic-link privileges, fixture line endings, document dependencies,
numeric OCR and timestamp behavior. New feature checks pass separately.

Rust contract library tests pass 102/102. Runtime library tests pass 106, skip 1
and fail 2 (`existing_scientific_environments`, `backend_lifecycle`). Both failures
also reproduce on the clean base. The full Go ACP command suite has the same two
base failures (`TestPluginFetchCommand`, `TestWindowsFileCLIReadCreateApprovalBoundary`);
the focused research tests pass with the race detector.

`npm run check` passes TypeScript and the first generated checks, then fails at
the pre-existing SDK token freshness check. The clean base reproduces that
failure. The generated protocol and locale checks also pass when run separately.
Pre-existing workspace changes to the lockfile and generated themes were preserved.

No external provider credential was configured in this test environment. No
paid/live model research run, external paper download campaign, independent
scientific evaluation, experiment execution or model-weight learning is claimed.
Browser verification uses the built Paper UI and deterministic Host projections;
the native Desktop frame/Viewer was not visually exercised. The real-stack test
separately verifies artifact reading through the actual Host owner. Results stay
`needs_review`, including the synthetic acceptance reports.

## Assessment — 2026-11-07

Issue #143 is still open under `sxyseo` with no comments at this review. The
implementation is feasible and the bounded Session/Study/artifact path is
working. Today the focused 20 Python tests, real Python/Host/Harness three-round
loopback journey, and Paper Chrome UI test passed again. The journey uses one
pre-saved synthetic PDF for all three rounds. Its later questions do follow
earlier gaps, and all 16 artifact versions are read back through Host. The
script does not exercise `research-search` or `research-acquire` in that journey.

The issue's complete acceptance level remains **unverified** for these reasons:

1. Search outcomes and official HTML acquisition have separate concept/worker
   tests, but there is no combined journey that finds, downloads and reads a
   newly discovered real paper. There is no live provider/model run, measured
   cost, source-quality audit or independent check for missed counterevidence.
2. Pending jobs return the same program checkpoint. The Harness allows at most
   two continuation feedbacks for one checkpoint. A model that ends turns while
   a slow worker is still running can exhaust that allowance before the job
   completes; terminal projection then cancels the worker. A controlled delayed
   worker journey is needed before autonomous acquisition can be called reliable.
3. The new ResearchProgram/rounds do not link to the existing ResearchRecord
   revision and impact-watch commands. Their generated reports and artifacts
   are readable, but the proposed common research-record history is not yet
   connected.
4. Pause/retry was exercised in the Chrome UI against fixture Host state, and
   artifact catalog reopen was exercised in Rust. A real Host/ACP restart and
   resume journey, plus native Desktop/Viewer interaction, remain unverified.
5. The current mode mounts frozen Host instructions and four declared App tools.
   It does not mount the dedicated research Skill requested in the issue's
   implementation table. The upstream contract needs either that Skill or an
   explicit maintainer decision to accept the current instruction assembly.

The engineering path has a verified offline vertical slice. Issue #143 should
stay open until a real-source, real-provider acceptance run and independent
claim review satisfy its published A/B criteria. A focused next check is one
fixed-version public seed that discovers and reads two new originals, injects a
controlled slow/429 source, then restarts the original Run. Inspect the exact
query/result/observation chain and score supported, unsupported and omitted
claims against the saved originals.


## Gap closure — 2026-11-07

The initial assessment above is historical. The following gaps have now been
implemented and rechecked:

| Gap | Current result | Evidence |
| --- | --- | --- |
| Slow pending lookup consumes continuation allowance | Harness observes `pendingJob` without model requests or feedback events, then continues the same turn; cancellation still ends the wait | 6 Paper Harness tests, including 2 new signal-controlled pending/cancel cases; all 9 focused Harness/budget tests pass with `-race` |
| Missing common research history | Each committed round publishes existing immutable ResearchRecord revisions; PDF/HTML reports retain their actual owner; original record hashes remain readable | 4 `test_program_records.py` cases, plus 5 existing record tests |
| Retry or rejected commit leaks records | Frozen pending timestamp and existing receipt/head recovery prevent duplicate revisions; the core rejects exhausted rounds before any revision is published | Fault injection at operation receipt and head publication; mutation of timestamp recovery produces the expected RED; independent review's excess-round RED is now GREEN |
| Dedicated research Skill not mounted | Bundled `paper-autoresearch` plugin is installed through normal dependencies; complete Skill content reaches real Harness provider requests | Both Node-backend and real-Python three-round journeys assert installed plugin identity and prompt content |
| Discovery and acquisition not connected | Actual Python worker discovers W9 from W1, screens it, downloads a previously absent PDF, reads it and saves observed counterevidence | `tests/runtime/paper-program-journey.mjs`, `test-results/paper-program-journey/result.json` |
| Host restart/resume not demonstrated | Cancel after a real read, restart Host and App, retry original Run and ACP session; model audit grows 11→18, one download remains one | Same controlled journey; four artifacts × three versions read back exactly, final delivery without UI status polling |
| Windows background worker never reaches its entry point | Use public multiprocessing spawn `set_executable` with the selected environment's `pythonw.exe`; missing windowless interpreter gives an explicit failed result | Controlled Windows RED: `windows-worker-red.json`; GREEN rerun removes every test-side spawn patch |

The original three-round journey also passes again: 25 model requests (including
4 spill reads), one Session/Turn, 4 artifacts × 4 versions. Current artifacts
include references to the ResearchRecord revisions. Synthetic fixtures prove
control flow and evidence ownership; they do not establish scientific quality.

Additional current checks passed: 22 `test_*program*.py` cases plus candidate and
export tests (24 feature cases total), 2 acquisition settlement tests, 2 Rust
artifact tests, 6 Desktop artifact/plugin tests, 6 manual evidence/schema tests,
TypeScript checks for root and Paper, locale validation, Host/Harness/App/Desktop
builds, and light/dark/narrow Paper and manual-record browser checks.

The shared acquisition change also reran the existing PDF/source suites. The
same 4 PDF errors and 3 source-download failures reproduce on clean base
`185673fc`: Windows symlink privileges, installed PDFium context-manager support,
and same-size tampering timestamp fixtures. Logs:
`test-results/paper-program-python/baseline-pdf-downloads.log` and
`baseline-source-downloads.log`. These are not reported as green suites.

### Public source probe and remaining scientific gate

`PERO_RESEARCH_PUBLIC=1 python tests/runtime/paper-program-public.py` ran real
public provider and acquisition code with no model. It added 3 candidates and
saved arXiv `1706.03762v7`: 2,215,244 bytes, 15 parsed pages, SHA-256
`bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697`.
OpenAlex returned a real HTTP 429; the search retained partial success and the
provider warning. No hidden provider retry or invented success was introduced.
Result: `test-results/paper-program-public/2026-11-06T16-49-45Z/result.json`.

The local Pero configuration contains an encrypted DeepSeek credential, but the
existing HarnessPreferences interface could not load a usable key. No key was
printed or saved in test artifacts, and no live model request was sent. The user
explicitly chose to finish offline/controlled acceptance and leave real-model
acceptance pending. `tests/runtime/paper-program-live.mjs` and its backend prepare
an opt-in, isolated 3-round qualification with 60 requests/100 App calls/12 minutes;
it is not a completed live-model acceptance result.

Still required for the scientific gate: a real model must independently choose
related originals, extract and compare claims, seek counterevidence, report
actual usage/cost, and undergo an independent review with supported/unsupported
claims and omitted evidence counted explicitly. Exact quote matching and the
controlled script's correct decisions are not substitutes. Issue #143 stays open.


### Actual Desktop and Scientific Viewer — passed

The real Electron workbench reopened the retained completed Python/Host/Harness
profile through the production Paper UI. Its original Run and 4 artifact
categories were restored. This found one additional implementation gap:
Scientific Viewer's catalog boundary accepted only text/file sources and rejected
Research provenance. The existing boundary now admits the typed Research source;
its 3 concept tests pass, including valid provenance and missing-field rejection.
The main workbench WASM must be rebuilt together with Host when adding this
contract variant; rebuilding only the separate Chat frame is insufficient.

`tests/e2e/paper-program-desktop.mjs` now passes with the actual Scientific Viewer:
keyboard preview of the report, its needs_review text and unresolved evidence,
versions 4→3→2, absence of the third round's finding in v2, dark appearance,
narrow-window overflow check, and no browser errors. Screenshots were captured
and visually inspected:

- `test-results/paper-program-desktop/completed-program.png`
- `test-results/paper-program-desktop/research-artifact-reader.png`
- `test-results/paper-program-desktop/historical-artifact-dark-narrow.png`
- Result: `test-results/paper-program-desktop/result.json`

Reproduce by building Host/Harness, Paper, Scientific Viewer, full workbench WASM,
Web and Desktop; run `paper-program-python.mjs` with
`PERO_RESEARCH_KEEP_PROFILE=1`, then pass the resulting profileDirectory as
`PERO_RESEARCH_UI_PROFILE` to `paper-program-desktop.mjs`. The harness fixture's
requestId and event permissions match the production UI. These screenshots use
synthetic evidence only. Native GPUI/macOS binaries and live scientific output
are outside this Windows Electron verification.

The final independent review found no remaining blocking issue in this change.
It also checked a fresh Windows venv: the windowless child preserves sys.prefix
and communicates over the existing multiprocessing Pipe. All private process
patches used during diagnosis were removed from the passing controlled journey.


Historical report review also exposed misleading interim accounting: before a
terminal Host observation, counters defaulted to zero and the execution label
could read not_started. Interim exports now explicitly say final accounting is
not yet recorded, and an absent stop reason is not recorded. Terminal exports
retain measured counts. The export test went RED then GREEN, and the actual
Desktop history test checks this text in v2. The real-Python three-round and
acquisition/restart journeys both passed again after the correction.

For a retained profile copied to another disk, set `PERO_RESEARCH_UI_PROFILE`
to the copy and `PERO_RESEARCH_UI_WORKSPACE` to its original workspace binding.
The final copied-profile rerun passed: versions [4, 3, 2], keyboard preview,
dark/narrow layout, interim accounting text, and zero browser errors.
The final screenshots were visually inspected after this rerun.

## Publication verification — 2026-11-07

The isolated PR branch was rebased onto upstream
`ff7d463b846f3c465b892bfb75449d6e052bfafd`. Other ongoing Skills marketplace,
lockfile and generated-theme changes are excluded. Independent review found
one missing build registration: the two new Harness sources and their tests
now appear in the existing Bazel target. Its dependencies already cover their
imports. Bazel itself was not run locally; the Go build and focused tests pass.

The following were rerun on the rebased code:

- Python: 24 feature cases, 5 existing ResearchRecord cases and 2 acquisition
  settlement cases pass.
- Go: all 9 focused research/budget tests pass with `-race`; the selected-skills
  and scoped-files packages pass. The broader pluginruntime suite still fails
  `TestMCPServerBindings` on this Windows environment; the unchanged test also
  fails in the clean implementation-base checkout.
- Rust: Host build and both research-artifact persistence tests pass, using the
  upstream-pinned GPUI Kit 0.9.0 checkout.
- Root, Paper and Scientific Viewer TypeScript checks, generated contracts,
  1052 bilingual messages, the budget contract and 9 Viewer/manual-evidence
  tests pass. Paper and Viewer production builds pass.
- The real Python/Host/Harness journey again completes 3 rounds with 25 scripted
  requests, 4 content-reference reads and 4 artifacts × 4 versions. The separate
  acquisition/restart journey passes with 1 download, the same ACP session,
  11→18 cumulative requests and 4 artifacts × 3 versions. Both finalize without
  UI status polling.
- Production Paper UI fixture: explicit start, original-run resume, stop,
  error recovery, keyboard focus, light/dark and narrow overflow checks pass.

The rebased Host SHA-256 is
`8b8bf9f3b4dcf5bc1d5411a2f50ad88e31ba10db417b778b1c0cb1a2ba3d304f`;
Harness is `2890213e9cbe6e8d9d39cd126b9d33791ff96cc08f7e40e548298cbc879ef9db`.
The full `npm run check` remains blocked at the SDK token freshness gate;
this PR does not change that generator or its token inputs. This is not a claim
that every repository-wide suite is green.

The actual Electron screenshots above were captured and inspected before this
rebase, on the implementation base with this feature applied. They are not a
new capture of the upstream unified Files/Artifacts UI. The rebased production
Paper UI fixture passed; the complete new Electron frame was not recaptured.
The author will attach the three desktop PNGs to the PR manually; they are not
committed as repository binaries. Real-model/scientific acceptance remains
explicitly pending, with no external model requests in this publication pass.
