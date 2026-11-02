# Manual research records (#79, bounded P3/P4 slice)

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
