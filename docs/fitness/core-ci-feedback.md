# Core CI feedback

The Linux `core` job keeps one runner, one root npm install and one install for
each App/backend dependency set. Checks use explicit successful setup/build
prerequisites with `!cancelled()`, rather than depending on every earlier
assertion succeeding. There is no `continue-on-error` or successful fallback.
A failed check still fails `core` and the existing aggregate CI gate.

- TypeScript and generated-source checks run immediately after root npm setup.
- Python/backend, individual App checks, Rust tests, permissions, Host build,
 MCP build and Host contracts report independently when their inputs exist.
- A failed Rust test no longer prevents building the Host binaries and checking
 stdio. A failed Host build still blocks Host consumers. MCP build failure
 blocks MCP-specific consumers, not unrelated stdio checks.
- A failed install skips only dependent checks. Cancellation stops new work;
 the existing evidence upload still uses `always()`.
- Four duplicate file executions were removed from the later desktop/content
 batch: app-context, app-use and control-lab-goal remain in `test:app-use:unit`,
 and automation-model remains in the automation model batch. No test cases or
 assertions were removed. No extra runners or dependency installs were added.

`node --test scripts/ci/core-ci.test.mjs` verifies the workflow dependency graph,
including each independent assertion failure, failed prerequisites, cancellation
and the strict gate. It deliberately does not claim to emulate GitHub Actions.
The existing workflow tests retain the command/coverage checks. Real Actions
execution on the published commit remains necessary to certify hosted CI.

## Verification for this change

Local verification uses the assistant workspace, not a user computer. The
complete fast CI command passed 109/109; core TypeScript, generated protocol,
theme, design and locale checks passed. The deduplicated content batch passed
12/12; App-use authorization/SDK batches passed 20/20 and 12/12; automation
contracts passed 14/14. Dependency-graph and actual Bash selection contracts
are included in the fast total (5/5). Rust/Cargo is not installed here, so neither Rust compilation nor
actual Host runtime acceptance is claimed locally. No GUI code is changed.
This change improves feedback collection, not coverage of outstanding GUI
acceptance debt described in `pr125-test-alignment.md`. No wall-clock speedup
is claimed without a comparable hosted run.
