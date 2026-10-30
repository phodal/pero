# Conversation charts from the harness

Status: implemented for local development, 2026-10-30.

## Decision

`chart_render` is a harness capability mounted by `charts.Mount`, independent
of App installation, navigation and App Use. It accepts the existing version 1
chart JSON, or a supplied dataset, DatasetView and chart mapping. The Go shell
runs the embedded Python data core with a trusted interpreter and no shell.
The same core lives in `harness/go/charts/python` and is packaged into Data
Agent's `backend/_core`; App handlers do not own another chart validator.

The result is a `pero.chart.v1` receipt containing canonical chart JSON and its
SHA-256 identity. Dataset-generated receipts retain the source text and existing
format-bound dataset digest, query/view identity, record pointers and exact
aggregate values. Supplied data and source labels remain declarations, not an
independent assertion of data correctness. Input is bounded to 2 MiB and receipt
to 4 MiB; chart row and family constraints remain in the shared value core.

The normal harness and Host session journals retain the result. ACP uses the
existing tool call/result stream; no marker parsing, App command, separate
history or second execution loop is introduced. A completed `chart_render`
receipt becomes typed chart content in ChatPanel. It stays visible below the
collapsed tool status, with data/source reader actions. Receipt and source
identities are checked before display; errors remain visible. Replay rebuilds
presentation from recorded values without executing the tool again.

`pero-chat-ui` owns the shared GPUI chart renderer. The standalone reader and
conversation both consume it; neither depends on the other. All seven chart
families, multi-series line gaps, theme colors and existing numeric limits are
preserved. The Data skill prefers `chart_render` when it is advertised and
retains the App workflow for providers without that tool.

## Scope

The built-in Go harness advertises this tool. This does not install a separate
Codex plugin or add the tool to arbitrary external ACP Agents. Such an adapter
can later expose the same capability through a Host MCP seam. Python 3.9+ is
required and `--chart-python` selects its executable. No App server is required.

Verification and explicit limits: [conversation chart acceptance](../fitness/conversation-charts.md).
