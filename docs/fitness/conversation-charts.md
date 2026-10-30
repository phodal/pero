# Conversation chart acceptance

2026-10-30, macOS arm64, L1 development source build based on `4734707` plus
this worktree's conversation chart changes. This is not packaged-release or
real-model acceptance.

`node tests/e2e/harness-chart.mjs` launches the actual compiled Go harness,
Rust Host and Electron GPUI workbench. A loopback OpenAI-compatible streaming
fixture checks that `chart_render` is advertised, issues an invalid pie request,
then seven valid chart requests. The real harness executes the shared Python
core and journals its receipts; the fixture supplies no precomputed tool results.

The test checks seven inline charts without opening Data Agent, a failed tool
followed by successful charts, Point multi-series/null data, exact aggregate
values above JavaScript's safe-integer range, light/dark appearance, renderer
reload and complete Desktop restart with unchanged chart identities and no
new provider requests. The original source action opens the retained source
in the shared readonly reader; the clipboard equals the exact original bytes.

Screenshots and the reproducible result are in `test-results/harness-chart/`.
The inspected pictures show GPUI candlesticks and Sankey flows in the message
stream, and the original-source table preserves `9007199254740993`.

Additional checks cover the shared Python domain, the Go tool with real Python,
receipt/source identity binding, native GPUI compilation with the repository's
nightly toolchain, Wasm builds, TypeScript and generated contracts. The existing
Data Agent chart and ACP/App Use suites are rerun after shared-core extraction.

Remaining boundaries: the provider is a deterministic fixture, not a real model;
external ACP providers have no newly added chart MCP endpoint; Windows/Linux,
signed packages and screen-reader behavior are not certified. Multi-series line
values remain available through the data reader; hover tooltips for that custom
line view are still absent.
