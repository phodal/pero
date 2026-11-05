---
kind: incident
status: resolved
date: 2026-11-05
---

# Data interpretation samples must respect SDK JSON bounds

PR #130's first browser run at `6cfeee3a` passed Python and TypeScript checks,
but the real Data frame failed after the first inspection. The error boundary
reported “App values must be finite JSON without cycles.” Both the existing
Fields regressions and the new complete workflow caught the failure. Evidence:
[Data job](https://github.com/phodal/pero/actions/runs/41953396698/job/127002415381)
and [failure screenshot](https://github.com/phodal/pero/actions/runs/41953396698/artifacts/13382561344).

The new bounded Agent sample wrote optional exact-number and conversion-error
properties as `undefined` for ordinary cells. App SDK semantic state deliberately
rejects values that are not JSON; the failure occurred during render, even without
an Agent session. The fix omits absent sample properties and normalizes an absent
issue condition to null when applying a type. A sample regression uses the real
SDK admission boundary. The SDK validation and permission rules remain unchanged.

The original browser assertions are retained. The hosted rerun at `8bc8b306`
passed all seven browser tests, all seven UI model tests and all 64 Python tests.
The type preview and numerical table in light mode, conversion issue rows in dark
mode, and the 390px layout were visually inspected from the
[passing artifact](https://github.com/phodal/pero/actions/runs/41954040103/artifacts/13382746233).
The real frame renders successfully and retains explicit failure labels and raw
identifiers. The JSON admission regression remains in the model test suite.

## Oversized exact-number follow-up (2026-11-05)

Review of integration head `c6e0ec5e` found that an admitted 40,000-digit JSON
number is copied in full into the semantic sample. Registering that sample with
the actual SDK exceeds its 32 KiB state limit and sends the Data frame into its
error boundary. Display text was bounded, but the new exact-number property was
not. The sample must omit oversized exact values explicitly and retain complete
numbers through source and export. Regression coverage must exercise SDK
registration with long numeric values and a wide sample.

The actual SDK regression reproduced `App value exceeds 32768 bytes` before
the fix. Semantic samples now omit exact values longer than 240 characters
with `exactOmitted: true`, retain up to eight fields, and stay within 8 KiB.
The model tests cover long values and 32-column inputs without modifying their
original data. The browser journey also imports a 40,000-digit number and checks
that its complete source and export survive while the Data frame stays usable.
