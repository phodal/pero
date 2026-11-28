# Workflow entry points

A pull request runs `ci.yml` only. Each reusable file below has one job, so a
skipped suite is one check and a selected suite is one check.

| File | Purpose |
| --- | --- |
| `ci.yml` | PR, master push, and daily Linux contracts. `Linux CI gate` is the aggregate check |
| `ci-*.yml` | One reusable job each (platform, harness, Desktop, or one App suite). No pull_request trigger |
| `ci-full.yml` | Daily and manual Desktop, Windows, macOS, Windows ACL, and opt-in Paper journeys. `Full-platform CI gate` |
| `acceptance.yml` | Manual sandbox, Docling, Fisher, graphics, and locked scientific Linux suites |
| `computer-use.yml` | Manual native platform diagnostics |
| `release.yml` | Tagged Desktop and Worker publication, plus the daily Virtual Cell canary |
| `pages.yml` | Publishes after a successful master push whose `Linux CI gate` passed |

Ordinary feature contracts belong in CI. Add a step to an existing job, or a
single-job reusable workflow called from `ci.yml`, instead of a new
`pull_request` workflow. A job that is present and skipped still counts as a
check.

`scripts/ci/workflow-scope.mjs` owns which App suites a change selects. Shared
SDK and design inputs select every affected App. Deleted or renamed inputs stay
in scope. An unreadable diff runs every scoped check. Core protocol,
authorization, Rust, Go, Bazel, harness, and recovery checks run on every
pull request. Fisher browser checks run inside the Linux core job when Fisher
paths change.

`ci:full` on a pull request selects every scoped App check. It does not start
Desktop, Windows ACL, or the Windows/macOS Go and harness matrix. Dispatch
`CI full` against that branch for those, or wait for the daily schedule on
master.

Release packaging does not run on pull requests. Tags, manual dispatch, and the
daily Virtual Cell canary still do. Tagged releases are not cancelled by a
later pull request. Historical tags that precede the Worker packager keep their
Desktop-only asset set.

`acceptance.yml` manual suites:

- `graphics` (default): disposable graphics probes.
- `locked-scientific-linux`: pinned scientific environment downloads and real computation.
- `sandbox-standard` / `sandbox-isolated`: disposable sandbox profiles.
- `paper-fisher`: public original scan and independent numerical/browser checks.
- `paper-docling-macos`: also requires `allow_official_downloads=true`.

```sh
gh workflow run acceptance.yml -f suite=sandbox-isolated
gh workflow run acceptance.yml -f suite=graphics
gh workflow run acceptance.yml -f suite=locked-scientific-linux
gh workflow run acceptance.yml -f suite=paper-docling-macos -f allow_official_downloads=true
gh workflow run ci-full.yml
```
