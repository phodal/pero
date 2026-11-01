# Lab verification record

Scope: Issue #69; one implementation PR, simulation-only. Base inspected:
`7dffe662b78894ed7a7a3a0e3ce78f5dd24feb80` (master).

## Executed during implementation

| Check | Result | What it establishes |
| --- | --- | --- |
| Python unittest, Linux CPython 3.13.5 | 15 passed; 1 real-library test skipped | Pure domain rules, frozen input/budget, loopback token/API, fixture two-trial loop, import immutability, cancellation, restart, no replay, persistence failure |
| Node 22.16.0 presentation tests | 2 passed | Higher/equal error is not presented as improvement; absent/mixed-origin results not compared |
| Python compilation and JS syntax check | Passed | Syntax only |
| Real PyLabRobot | Not executed locally | Dependency unavailable; outbound installation/download failed |
| Browser fixture attempt | Blocked before page navigation | Chromium returned `net::ERR_BLOCKED_BY_ADMINISTRATOR`; no screenshots or UI acceptance claimed |
| Production App build / TypeScript | Not executed locally | Full checkout/node dependency installation unavailable |
| Pero Desktop / Host ACP tool loop | Not executed | No Desktop or scripted ACP acceptance claim |
| Real model/provider / signed package | Not executed | No L2 Agent or L3 package acceptance claim |

The unit fixture is explicitly named `test-fixture`; it is NOT PyLabRobot and NOT
an Agent. The fixture's deterministic error improvement is not a scientific result.

## Required automated gate

`.github/workflows/lab.yml` installs `pylabrobot==0.2.1` on Python 3.12 and runs
`LAB_REQUIRE_PYLABROBOT=1` so missing/broken engines fail instead of skipping. It also
builds the production App entry, typechecks, runs presentation tests, and runs the
Playwright browser suite without the executor fixture. Screenshot/JSON receipts are
uploaded as `lab-browser-evidence`; real engine logs as `lab-engine-evidence`.

A workflow definition is not evidence of execution. Consult the PR's actual check
runs and artifacts before upgrading any row above. The browser parent is a loopback
test harness with an explicit token proxy, not Electron or the Rust Host.

## Remaining acceptance before closing #69

- Successful real-library install and tracker round-trip on target Python 3.12.
- Successful actual bundle/browser flow, including light/dark/narrow/error/reopen.
- Actual Pero Desktop install/enable/open/disable/reopen and process cleanup.
- Host ACP declared App-tool round trip using a scripted provider, followed by a
  separately recorded real-provider run when credentials are available.
- Review screenshots and keyboard behavior; no visual-verification claim from source.

Keep the implementation PR in draft while these applicable gates are unresolved.
No physical device acceptance is planned or implied by this PR.
