---
kind: issue
status: resolved
---

# Declarative App chart rejects valid documents in a browser

The browser SDK verification rendered a valid bar document as an invalid chart.
The pure document validator counted UTF-8 bytes with Node's global `Buffer`.
Browsers do not supply that global. Its ReferenceError was caught by the chart
projection and became the generic invalid-document state, while Node-only tests
accepted the same data.

The validator must count UTF-8 bytes with a web-standard primitive. The existing
input limits and invalid-document behavior must remain unchanged. Verification
must include actual browser rendering and bounded Unicode input.

Resolved with TextEncoder-based byte accounting. Pure Unicode/boundary cases and
`node tests/e2e/app-sdk.mjs` passed; real Chromium rendered both SVG and uPlot
charts in light/dark/narrow layouts. Screenshots: `test-results/app-sdk/`.
