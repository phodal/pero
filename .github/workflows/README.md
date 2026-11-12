# Workflow entry points

Keep separate entry points for distinct triggers or trust boundaries, not each
new feature test. Ordinary contracts belong in CI (or its reusable jobs).

- **CI**: PR/master checks, daily/full-platform acceptance, and the existing
  Linux/full-platform gates. `desktop-check`, `notebook`, `notebook-canvas`, and
  `native-ui` are reusable implementations, not additional automatic triggers.
- **Computer Use**: scoped native platform checks and explicit diagnostics.
- **Release Desktop products** and **Pages**: existing release/deployment gates.
- **Paper Fisher browser verification**: scoped Paper browser acceptance.
- **Paper optional Docling on macOS**: existing explicit download/label opt-in.
- **Agent Sandbox acceptance**: choose `standard` or `isolated` on manual
  dispatch. PRs still require the matching existing label and a same-repository
  head. Each profile retains its own services, tests, artifacts, and teardown.
- **Manual diagnostics**: choose `graphics` (default) or
  `locked-scientific-linux`. The latter downloads pinned scientific environments
  and runs real computation. Neither suite runs on PRs, pushes, or a schedule.

The consolidation reduces tracked workflow YAML files from 14 to 12 without
removing test jobs. Older entries such as `lab.yml`, Paper document contracts,
and Paper reproduction contracts can remain in GitHub's Actions sidebar because
GitHub retains historical runs. Those are not necessarily active workflow files.
This cleanup does not delete run history, disable repository features, alter
branch protection, or change CI/Pages/release job names.

Examples:

```sh
gh workflow run agent-sandbox.yml -f profile=isolated
gh workflow run diagnostics.yml -f suite=graphics
gh workflow run diagnostics.yml -f suite=locked-scientific-linux
```
