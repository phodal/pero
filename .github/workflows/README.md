# Workflow entry points

There are five runnable entry points and one shared implementation file:

| File | Purpose |
| --- | --- |
| `ci.yml` | PR/master contracts, daily/manual full-platform coverage, and the existing Linux/full-platform gates |
| `ci-jobs.yml` | Reusable CI job families only; no automatic or manual trigger |
| `acceptance.yml` | Path-scoped Paper checks, labeled sandbox acceptance, and explicitly selected manual diagnostics |
| `computer-use.yml` | Scoped native platform checks and their existing daily/manual diagnostics |
| `release.yml` | Existing tag publication and package validation, with its trust/CI gates unchanged |
| `pages.yml` | Existing successful-CI deployment and explicit rollback gate |

Ordinary feature contracts belong in CI. Add jobs or suites to an existing
entry point instead of creating one workflow per feature. Separate release and
Pages owners retain their different permissions and publication conditions.

CI calls `ci-jobs.yml` with a `suite` selector for Desktop, Notebook, Notebook
Canvas, or Native shell. Caller names, implementation job names, tests and final
CI gate dependencies stay unchanged.

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
