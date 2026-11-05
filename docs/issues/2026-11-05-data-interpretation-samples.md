---
kind: incident
status: active
date: 2026-11-05
---

# Data interpretation samples must remain strict JSON

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

The original browser assertions are retained. Hosted browser rerun and screenshot
inspection are required before considering this incident resolved.
