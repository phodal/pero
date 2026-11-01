# Lab verification

Status: the bounded Linux Desktop vertical slice passed on 2026-11-01.
Draft PR #74 remains unmerged; scientific and identity boundaries below still apply.

## Actually exercised locally (2026-11-01)

- CPython 3.12.14, actual PyLabRobot 0.2.2 installed from its official wheel;
  pinned typing_extensions 4.16.0 and websockets 17.4, `pip check` clean.
- 25 backend tests passed: immutable domain capacity/depletion/tip/order/budget
  constraints, independent evaluation, 5 real-adapter tests, authenticated HTTP,
  original CSV/JSON bytes/hash/import/export/restart, cancellation and unknown
  outcomes. No fake PLR execution fallback. The real eight-step two-trial example
  yields synthetic FAIL then PASS under unchanged rules; a worse revision is
  explicitly reported as no improvement.
- Frontend TypeScript check and 6 pure UI/reference/actual-manifest schema tests passed.
- Existing Host AppUse unit suites plus Lab bounded-research/goal cases passed
  (17 Host cases and 10 SDK cases); four App write-route tests also passed using
  the repository's `--experimental-transform-types` runner. Seven product/bundle
  tests passed. These are permission/packaging contracts, not rendered UI evidence.
- Independent read-only review re-ran the 25 real-PLR backend cases, four UI/schema
  cases and Lab typecheck. Its concrete findings (numeric overflow, unsupported
  manifest keyword, Agent review authority and missing frozen-hash enforcement)
  were fixed and rechecked; it found no remaining domain/adapter/store/API blocker.

Commands and source are in `apps/lab/README.md`. Tests are not physical or
biological acceptance, and deterministic ACP playback is not model acceptance.

## Actual hosted Desktop evidence (2026-11-01)

PR head `87a2697d8693a969a0b96cdb4314984d8f771b78` (local `91d5386`)
was built at CI merge `e35b30a1c9832661590e29a91fa1859a7c44b016`.
Full run [41280752769](https://github.com/phodal/pero/actions/runs/41280752769),
Lab job `124773299418`, passed in **143.844 seconds**. The full run completed
**42/42 successful jobs**, including **19/19 Desktop suites** and three OS build/contract jobs. The same-revision
Linux runtime was built once and verified before the independent GUI job.

The actual Electron → Host → shared Chat → scripted ACP → real pinned PLR
journey passed: install/open; freeze; two linked eight-step trials; synthetic
FAIL then PASS under unchanged criteria; independent verification/comparison;
blocked scripted review followed by UI decision; real file export; user-supplied
CSV import with original-byte SHA-256; and actual Desktop/Host/Python restart
with unchanged saved evidence and no replay. Both owned process trees exited.
There were no page errors; the sole console 403 was the intentional forbidden
UI Agent-endpoint probe.

Artifact [13073073988](https://github.com/phodal/pero/actions/runs/41280752769/artifacts/13073073988)
contains the receipt, exported report and inspected light/dark, Results,
imported-observation, reopened-run and narrow screenshots. ZIP SHA-256:
`9676e4f1e2f98a40cf9e9870b81132ce426f5b7e12e7ea3a00c91e5c0d0e13a6`.
The exported JSON has 797253 bytes, SHA-256
`523d95c704e28ca1e68696fb2bab05206c25509e978d6d429e54cfe5439b1638`.
Independent inspection of the downloaded artifact rechecked this digest,
full experiment equality and every embedded observation's original-byte digest.

The narrow screenshot is a **visible interactive 725×702 App viewport** in
1000×773 window content, with Chat closed and target-well click verified.
It is not mobile acceptance. Earlier hidden-iframe and impossible 900px window
assertions were corrected; their failing runs remain failures, not reused proof.
Other hosted findings fixed without weakening checks were the missing UI proxy
guard, transient App reference revision, Electron-native download capture and
readability of evidence-table labels.

Ordinary Linux CI [41280858411](https://github.com/phodal/pero/actions/runs/41280858411)
passed in **6m19s**. Full GUI stays in the existing full/daily tier.
No local GUI was run: the known browser socket restriction was not bypassed,
no `--no-sandbox` was added, and no user Mac was used. The separate isolated
iframe smoke is not claimed executed merely because the real Desktop passed.

## Explicit gaps / boundaries

- No real-provider exercise authorized or performed. No credentials read.
- UI review records `actor:user-interface`, `human_identity_verified:false`.
  Existing Lab-bound research restrictions prevent general DOM/computer tools;
  a global desktop operator is not proof of human identity. Strict human-only
  authenticated acceptance is not implemented or claimed.
- The Native shell guard has independent source review only. Its feature-gated
  Rust tests were not compiled/run; existing CI does not install the additional
  native WebKit/GPUI stack. Electron GUI success is not Native runtime proof.
- No hardware, calibration, collision, optical/fluid physics, biology,
  packaging/signing or cross-platform GUI acceptance claimed.

## Original-paper software reproduction (2026-11-01)

The original VERID PDF was read, not just the Google blog. Its source version,
PDF byte digest, comparison against the other two linked original papers,
method-to-code matrix and missing experimental prerequisites are documented in
[the primary-source comparison](../design-docs/lab-google-reproduction.md).

Two additional local suites passed: 7 independent analytic/high-precision tests
for §6.3 equations (1)–(5), and 2 deterministic stateful/schema-only benchmark
contracts. The final Python aggregate is now **34 passing tests**. Both report
scripts actually ran and were independently rerun by the paper reviewer.

- The four artificial scoring vectors yield 2902.7682013901763 mnats, versus the
  independently reduced-expression golden 2902.7682013901442. This is equation
  reproduction, not the paper's 307→58 physical result.
- The constructed resource suite has nine schema-valid cases: one valid and
  eight invalid. Schema-only accepts the eight invalid cases; the stateful fold
  rejects them at the expected step/code. A separate malformed control is
  rejected by both and excluded from the resource counts. This is not an
  estimate of general safety or an official Google benchmark.
- Normal Color Mixing still uses its own single-dye fraction/volume evaluator.
  The four-dye paper metric is separate; no synthetic observation is relabelled
  as a paper measurement or used to claim physical/biological reproduction.

JSON reports under `test-results/lab-paper/` retain exact input-set/source hashes,
parameters, units and limitations. CI emits them as a small Linux-job artifact.
