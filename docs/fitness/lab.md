# Lab verification record

Scope: Issue #69; one implementation PR, simulation-only. Base inspected:
`7dffe662b78894ed7a7a3a0e3ce78f5dd24feb80` (master). Implementation: [PR #71](https://github.com/phodal/pero/pull/71).

## Executed GitHub acceptance

At code revision `8c9af357a42f28f8bc88da25e55bf1fb409706f5`, both jobs of
[Lab App acceptance run 41260182594](https://github.com/phodal/pero/actions/runs/41260182594)
passed. This is an observed run, not only a configured workflow.

| Check | Result | Evidence / scope |
| --- | --- | --- |
| Python 3.12.15, actual pylabrobot==0.2.1 | 16 tests passed, no skips | Domain, authenticated API, persistence/recovery tests plus real Chatterbox command/tracker round trip; `lab-engine-evidence` artifact |
| TypeScript and production App build | Passed | Actual shared App SDK and Lab frame built using the existing App build pipeline |
| Node presentation tests | 2 passed | Regressions/unchanged error not mislabeled as improvement; mixed-origin evidence not compared |
| Production bundle + real backend + real Chatterbox in Chromium | Passed | Two linked trials, synthetic FAIL→PASS, explicit review, export, restart without replay, invalid action, missing-dependency state; zero page errors |
| Light/dark and 390 px view | Captured and inspected | Browser screenshots, not an Electron shell; initial narrow well-value crowding found during visual review and corrected in this PR, with an added keyboard/narrow-results regression assertion |

Artifacts for that verified revision:
- [Browser screenshots, experiment JSON and receipt](https://github.com/phodal/pero/actions/runs/41260182594/artifacts/13064786798)
- [Real engine test log](https://github.com/phodal/pero/actions/runs/41260182594/artifacts/13064224459)

The exported experiment records both trials with engine `PyLabRobot` 0.2.1,
backend `LiquidHandlerChatterboxBackend`, origin `synthetic`, and absolute target
errors approximately 0.095 and 0. The disclosed synthetic sensor multiplies the
predicted fraction by 0.9. This demonstrates a software feedback example, not
measured optical performance, biological validation, or an autonomous real Agent.

The browser parent is an explicitly labeled loopback test harness with a token
proxy, not Electron or the Rust Host. The resulting receipt says `desktop: NOT RUN`
and `real_agent: NOT RUN`. A browser PASS must not be relabeled Host/ACP acceptance.
The later narrow-layout regression must be judged by its own PR check run.

## Local development checks and limitations

| Check | Result | What it establishes |
| --- | --- | --- |
| Python unittest, Linux CPython 3.13.5 | 15 passed; 1 real-library test skipped | Same core/API tests with an explicit test executor; not local real-library acceptance |
| Node 22.16.0 presentation tests | 2 passed | Pure comparison behavior |
| Python compilation and JS syntax | Passed | Syntax only |
| Local browser attempt | Blocked before page navigation | `net::ERR_BLOCKED_BY_ADMINISTRATOR`; successful browser evidence above came from GitHub CI instead |
| Pero Desktop / Host ACP tool loop | Not executed | No Desktop or scripted ACP acceptance claim |
| Real model/provider / signed package | Not executed | No L2 Agent or L3 package acceptance claim |

## Automated gate

`.github/workflows/lab.yml` uses `LAB_REQUIRE_PYLABROBOT=1`, so missing or broken
engines fail instead of skipping. Browser acceptance is pinned to Ubuntu 24.04,
compatible with the pinned Playwright version. Artifacts retain screenshots and
structured receipts. Tests never connect to hardware or call a paid model.

## Remaining acceptance before closing #69

- Actual Pero Desktop install/enable/open/disable/reopen and process cleanup.
- Host ACP declared App-tool round trip using a scripted provider, followed by a
  separately recorded real-provider run when credentials are available.
- Final narrow-layout regression check after the screenshot-driven adjustment.

Keep the implementation PR in draft while the Desktop/Host integration gates are
unresolved. No physical-device acceptance is planned or implied by this PR.
