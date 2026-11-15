# Workflow entry points

There are five runnable entry points and one shared implementation file:

| File | Purpose |
| --- | --- |
| `ci.yml` | PR/master core contracts, path-selected App acceptance, and daily/manual full-platform coverage |
| `ci-jobs.yml` | Reusable CI job families only; no automatic or manual trigger |
| `acceptance.yml` | Path-scoped Paper checks, labeled sandbox acceptance, and explicitly selected manual diagnostics |
| `computer-use.yml` | Explicitly selected manual native platform diagnostics |
| `release.yml` | Tag publication, daily/manual package validation, and explicitly opted-in PR packaging |
| `pages.yml` | Existing successful-CI deployment and explicit rollback gate |

Ordinary feature contracts belong in CI. Add jobs or suites to an existing
entry point instead of creating one workflow per feature. Separate release and
Pages owners retain their different permissions and publication conditions.

CI calls `ci-jobs.yml` with a `suite` selector for Desktop, Notebook, Notebook
Canvas, Native shell, or an App's browser/scientific contracts (Data, Lab,
Control Lab, Virtual Cell, Scientific Viewer and LCMS2Yield). The reusable file
owns those implementations; `ci.yml` owns their triggers and aggregate gate.

Ordinary PRs and master pushes select expensive Notebook, Notebook Canvas,
Native, App browser/scientific, and MCP Apps browser checks from the changed
paths. `scripts/ci/workflow-scope.mjs` owns that dependency map. Shared SDK/design
inputs select all affected Apps. Deleted/renamed inputs remain in scope; an
unreadable diff runs every scoped check. Core protocol, authorization, Rust/Go
and recovery checks remain ordinary checks.

Daily, manual CI and `ci:full` still run all suites. The aggregate gate accepts
a skipped App only when a successful scope output explicitly excludes it;
failures, cancellations and missing scope evidence remain failures.

Virtual Cell PR packaging requires `ci:package` or `ci:full`, including for
Worker/Host changes. New PR revisions cancel obsolete PR package attempts.
Version tags, manual release, daily packaging, exact-SHA trust and publication
gates retain their existing behavior; tagged releases are not cancelled by this
PR-only policy.

`acceptance.yml` offers these manual suites:

- `graphics` (default): disposable graphics probes.
- `locked-scientific-linux`: pinned scientific environment downloads and real computation.
- `sandbox-standard` / `sandbox-isolated`: disposable sandbox profiles.
- `paper-fisher`: public original scan and independent numerical/browser checks.
- `paper-docling-macos`: also requires `allow_official_downloads=true`.

PR routing preserves each original path filter and event action. Sandbox and
Docling retain their separate same-repository and label opt-ins. No optional
scientific/infra suite is added to the daily schedule or ordinary push trigger.
Each profile retains its tests, artifacts and existing concurrency group.

```sh
gh workflow run acceptance.yml -f suite=sandbox-isolated
gh workflow run acceptance.yml -f suite=graphics
gh workflow run acceptance.yml -f suite=locked-scientific-linux
gh workflow run acceptance.yml -f suite=paper-docling-macos -f allow_official_downloads=true
```

This reduces tracked workflow YAML files from 14 to 6. GitHub may still show
old names in the Actions sidebar because historical runs remain. Removing a
workflow file stops its future triggers; it does not erase historical runs.
No run history, repository features, branch protection or release permissions
are deleted or changed by this consolidation.
