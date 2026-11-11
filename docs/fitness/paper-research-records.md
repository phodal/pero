# Manual research records (#79, bounded P3/P4 slice)

## 2026-11-05 Data versions and upstream checks

In **Question and scope**, open **Data Workspace** to bind an existing dataset
version to the revision. Host resolves the selected IDs through Data; the
saved record contains the dataset, version and SHA-256. Rebinding creates a new
revision. Earlier versions, references and decisions remain readable. The
handoff exports version metadata, with no Data files. A Data pin is research
context; it does not change the fixed PC-Gym method's inputs.

On a saved revision, **Watch for updates** supports a manual check or an opt-in
daily check at 09:00 local time while Host is running. Each check compares the
pinned Data versions, reads official arXiv version metadata for supported saved
papers, and compares saved paper and installed method identities. An unavailable
version or unverifiable response stays unknown. Paper identifies affected linked
reports and attempts; Insights shows the latest stored check for each revision.
Checks do not download content, launch an Agent, change pins, or rerun work.

The macOS Electron exercise imported two real versions of a local test CSV,
checked saved `2410.22093v3` against official arXiv metadata returning
`2410.22093v4`, rebound the CSV in a new revision and recovered the original
check after restart, then paused the schedule. Automations showed the run in
history without an Agent session. Insights showed the same receipt and could
not change the schedule. The runtime timer test dispatched a scheduled check without ACP and
retained its result after restart. Run with built Host, Electron and Apps:

```sh
PERO_RESEARCH_WATCH_LIVE=1 node tests/e2e/paper-research-watch.mjs
node tests/runtime/automation-app.mjs
```

Desktop receipts and light/dark screenshots are under the gitignored
`test-results/paper-research-watch/` directory.

## 2026-11-05 attempt history and handoff

Question and scope is available from the Reader's Research record and from
Research results. A revision can retain finished PC-Gym attempts, including
failures and cancellations. Each entry opens its original PDF version,
annotation, frozen item and attempt. New inputs use a new frozen Spec and
native approval. Earlier decisions and execution records remain available.

The references export contains identities. The handoff ZIP includes the
selected attempt's frozen item and tolerance, execution and numeric evidence,
checker, and the research revision. Inclusion of revision notes and the bound
PDF excerpt requires explicit confirmation. The export excludes local checkout
and interpreter paths, credentials, full original documents, checkpoints and
execution logs. Notes are included as entered. Other attempts and reports are
retained as references. In a clean directory, `python3.12 -E -s -S verify.py`
checks the archive identities and recomputes both metric grains using the
standard library. The new handoff README documents the Python minimum and
the exact replay command. Rerunning training requires the pinned checkout,
compatible Pero backend and scientific interpreter described in the spec.

Saved-source impact compares the frozen paper and its PDF and structured
document identities to saved versions. Recognized arXiv revisions can be opened
from the impact list. A changed installed method identifies affected frozen
attempts. Source changes identify the reports and attempts linked by the
revision. Opening a reread or an earlier result does not run the method.

The [Desktop acceptance](paper-direct-reproduction.md) exercises B5–B6 on
the original PDF and real PC-Gym, one restart path in B8, and the B9 handoff ZIP
and clean-directory checker. Two independently approved seeds exercise B11 for
one fixed method. B10 includes the Data and official arXiv checks above. A
fresh-context Agent independently unpacked the full Table 6 archive, ran its
checker and performed a fresh run from the unchanged spec in a clean directory.
All three raw numeric archives matched byte for byte; the independent counts
matched for both metric grains. The paper verdict remains `INCONCLUSIVE`.
In a second clean directory, the same reviewer used the new README to replay
the shorter smoke profile without consulting the CLI source. The downloaded
ZIP retained the pinned Data version ID and SHA-256; the CSV was absent and
the rerun completed without it. Set `PERO_PCGYM_DESKTOP_DATA_PIN=1` on the
Desktop exercise to verify a handoff with this metadata.
Commands and raw comparison are recorded under
`test-results/paper-research-watch/independent-review/`. This was independent
Agent replay. The human researcher handoff in B9 and full B1–B11 product
acceptance remain open.

## Earlier manual-record scope (historical baseline)

Baseline: `78881615e37790b0a0b4635a197e18f974ea6867`. Verification date: 2026-11-02.
This is **not completion of #79**, a new observation ledger, or a computational
handoff package. #75/#76 still own source/reading closure; #77 owns actual
attempts, execution, independent checks and supported clean-environment replays.

## Experience and ownership

Open a saved paper → Research records → Question and scope. Save a question,
scope and inclusion/exclusion criteria; every selected paper has a reasoned
include/exclude/pending decision. Optional support/counterevidence references
point to existing ordinary research reports. Gaps can explicitly have no report.
A reference identifies evidence, not proof that the manual interpretation follows
from it. Source evidence reports keep their existing owner and are not converted
into PDF observations or admitted by this route.

Revise creates a new immutable record with parentId. Historical scopes, screening,
evidence notes and local review decisions remain reopenable. Review identities
are local-user-declared, not independently authenticated reviewers. No review or
old scientific PASS is inherited as verification of a new revision.

Check saved source updates compares actual saved PaperSnapshot content digests
only, for the exact same provider/sourceId. It does not infer equivalence between
aliases or arXiv versions. A different saved snapshot is not necessarily newer.
Upstream freshness always remains unknown: no fetch or watcher runs. PDF/IR,
Data assets and method versions are **not compared** in this slice. A missing or
invalid original is unknown; the historical revision remains readable.

Save reread selection records a user choice; it does not create a ResearchStudy,
start an Agent, run a method, or manufacture an observation. Existing Host/ACP
execution and approval remain unchanged. Automation already has a durable local
Agent owner; its current projection lists deterministic/app methods and external
latest resolution as unsupported. This slice adds no Automation platform.

Export references returns IDs/digests only. It omits question/scope, notes,
report/paper text, private data, paths and credentials, and rechecks the referenced
source/report owners. Missing or altered references block export, not historical
viewing. This is explicitly **not** the full research record or a no-Agent
recomputation package. Existing copy permissions are not broadened.

## Entry points

- Authenticated `POST /api/research/record` and declared `research-record` App tool.
- Existing JSON CLI action `record`; domain and persistence code are shared.
- Operations: `create`, `list`, `read`, `impact`, `select`, `export`.
- create accepts question/scope/inclusion/exclusion, 1–32 saved paperIds, one
  decision/reason per paper, optional evidence and local review, optional parentId.
- read returns retained reread selections as well as the immutable revision.
- No operation executes code, downloads sources, installs tools or sends to a model.

Use a separate local cache, not the concurrently running App profile:

```sh
printf '%s\n' '{"action":"record","input":{"operation":"list"}}' \
  | python3 apps/paper-agent/tools/research.py --cache /tmp/pero-record-inspection
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s apps/paper-agent/test -p test_research_records.py -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s apps/paper-agent/test -v
node --test tests/e2e/paper-manual-evidence.test.ts
npm run typecheck --workspace @pero/app-paper-agent
node scripts/build/apps.mjs --app paper-agent
```

Normal App build requires the configured reader/GPUI kit; the local check reused
an existing reader build with `--reader-dist` and does not certify rebuilding it.

## Verification and limits

- Four new behavioral tests pass: immutable revisions/reopen, screening/review and
  report ownership, real saved snapshot differences/missing originals, persisted
  explicit selection, private export omissions, digest tampering, authenticated
  loopback API and shared command persistence. All source content is labelled
  synthetic test data; these tests are not research experiments.
- Full Paper Python suite: **238 run: 237 passed, 1 skipped**.
- Two deterministic frontend tests pass: editing/removing one evidence row preserves
  other references for the same paper; report choices require actual citations,
  not intent membership or section paper labels. Missing summary content is fetched
  from the existing report owner before presenting choices.
- Paper TypeScript check and App bundle build passed (reused reader distribution).
- App contract runtime could not start: `target/debug/pero-host` absent from this
  new worktree. This is not a passing Host tool-discovery test.
- Browser smoke could not launch Chromium in this sandbox (socket EPERM). One
  escalation failed in sandbox setup at a protected directory. No screenshots,
  GUI interaction pass, real Desktop/model/network/scientific acceptance claimed.

Outstanding #79 P3/P4 acceptance is unchanged: full attempt/failure and independent
review history across execution owners; a permission-aware portable package with
supported no-Agent clean-environment recomputation; PDF/IR/data/method version
impact; actual user-selected reread/recompute via the existing owners; fixed-method
new-input reuse; real Desktop accessibility/theme/narrow-window verification;
and the other B1–B11 evidence required by the issue. Do not close #79 from this slice.

## Saved PDF report navigation — 2026-11-11 (#79)

Source: parent integration `528c12ddb` plus `codex/paper-79-evidence-navigation`.
A saved Evidence reference opens its immutable ResearchReport and frozen Intent
in the existing ReportView/Experiments components, even outside the current
history projection. Users choose the exact section, matrix or experiment citation;
the existing source action receives its full quote and passage ID. Opening the
report does not select an arbitrary quotation or edit the matrix. Missing reports
retain the research revision with a retry action. Keyboard opening focuses the
report region; closing returns focus to the initiating link. DataEvidence is unchanged.

`node tests/e2e/paper-record-evidence.mjs` passes against the built production
Paper App in Chromium with synthetic API responses. It verifies the second of
two quotes in one passage, matrix quotation, missing-report retry, retained
revision, focus return, and a 390px dark viewport. TypeScript and App build pass.
Inspected screenshots and receipts: `test-results/paper-record-evidence/` in
`/Users/phodal/workspaces/pero-issue-79-evidence`. This is browser/UI evidence,
not a new Host, Electron, Native, live-provider or scientific acceptance run.
Existing reader distribution was reused. No shared tokens or control styles changed.
HTML SourceReport navigation is a separate follow-up in its existing owner.
