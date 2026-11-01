# Lab verification

Status: implementation in progress for #69; **not complete Desktop acceptance**.

## Actually exercised locally (2026-11-01)

- CPython 3.12.14, actual PyLabRobot 0.2.2 installed from its official wheel;
  pinned typing_extensions 4.16.0 and websockets 17.4, `pip check` clean.
- 25 backend tests passed: immutable domain capacity/depletion/tip/order/budget
  constraints, independent evaluation, 5 real-adapter tests, authenticated HTTP,
  original CSV/JSON bytes/hash/import/export/restart, cancellation and unknown
  outcomes. No fake PLR execution fallback. The real eight-step two-trial example
  yields synthetic FAIL then PASS under unchanged rules; a worse revision is
  explicitly reported as no improvement.
- Frontend TypeScript check and 4 pure UI/actual-manifest schema tests passed.
- Existing Host AppUse unit suites plus Lab bounded-research/goal cases passed
  (27 Host cases and 10 SDK cases); four App write-route tests also passed using
  the repository's `--experimental-transform-types` runner. Seven product/bundle
  tests passed. These are permission/packaging contracts, not rendered UI evidence.
- Independent read-only review re-ran the 25 real-PLR backend cases, four UI/schema
  cases and Lab typecheck. Its concrete findings (numeric overflow, unsupported
  manifest keyword, Agent review authority and missing frozen-hash enforcement)
  were fixed and rechecked; it found no remaining domain/adapter/store/API blocker.

Commands and source are in `apps/lab/README.md`. Tests are not physical or
biological acceptance, and deterministic ACP playback is not model acceptance.

## Pending real Desktop evidence

`tests/e2e/lab.mjs` is an actual Electron → Host → shared Chat → scripted ACP →
App API → real PLR test. It covers two linked trials, visible observations and
verification, direct UI review, CSV import, export, actual process restart,
light/dark/narrow screenshots and clean process exit. It is wired into the
existing full/daily CI tier, not ordinary PR GUI work. The independent sandbox
iframe smoke is `apps/lab/test/browser-smoke.mjs`.

Neither GUI test has run locally: this environment has a known browser socket
permission restriction. No `--no-sandbox`, permission workaround or user Mac was
used. The standard App build also reached the shared reader prerequisite and
failed because `cargo` is absent from PATH; frontend typecheck/esbuild alone is
not a complete Desktop build. GUI receipts/screenshots must come from the
same-revision authorized full CI run before claiming those acceptance items.

## Explicit gaps / boundaries

- No real-provider exercise authorized or performed. No credentials read.
- UI review records `actor:user-interface`, `human_identity_verified:false`.
  Existing Lab-bound research restrictions prevent general DOM/computer tools;
  a global desktop operator is not proof of human identity. Strict human-only
  authenticated acceptance is not implemented or claimed.
- Host-managed first-time dependency installation and install/enable/open through
  Desktop still require actual full CI confirmation; the local venv dispatch
  tests do not substitute for that lifecycle evidence.
- No hardware, calibration, collision, optical/fluid physics, biology,
  packaging/signing or cross-platform GUI acceptance claimed.
