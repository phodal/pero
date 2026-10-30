# Data Agent

Development preview. This App is built or installed explicitly and is not part
of the default Pero product. Backend and type checks are separate from Desktop
and real-model acceptance.

Import a JSON array of records, one JSON object, or JSON Lines (up to 16 MiB and
100,000 records). The original UTF-8 source is stored unchanged in the Host's
App data directory and identified by its SHA-256 digest. No connector or remote
model is needed to inspect data.

The field list distinguishes missing fields, explicit `null`, and mixed types.
Choose any 32 fields for a bounded page of up to 200 records. Filters and numeric
sorts use exact decimal values. Record identities refer to the original source,
even after sorting; source actions locate that record in the shared GPUI reader.

Charts and exports use the same matching records or explicit selection. Sum and
count charts show at most 50 groups, with omitted and excluded counts visible.
Numerical values whose decimal exponent is outside ±4096 remain readable and
exportable but are excluded from sum charts. Plot coordinates alone use floating
point; exported number tokens and sums retain precision. Exports contain every
field and a manifest with the source digest, query, selection and record pointers
(line numbers for JSON Lines).

The chart panel uses GPUI Kit in the managed reader surface. Choose an
aggregation or map record fields to line, bar, area, pie, radar, candlestick,
or Sankey. Candlestick needs category and open/high/low/close fields; Sankey
needs source, target, and value fields. Chart data and source sections expose
plotted values, dataset digest, view identity, record pointers, exclusions,
and the original source. Plot coordinates use floating point; exact aggregate
values and source records remain available. Charts currently accept up to
2,000 selected or matching records. Unsupported or ambiguous inputs are
reported instead of silently filling, aggregating, or changing the chart type.
Line charts support up to five series and preserve explicit nulls as gaps;
their multi-series view exposes values in the data table instead of hover
tooltips. Other chart families currently reject series and null values.

Open a Point-inspired version 1 chart document with **Open chart JSON**, or
export a generated document. Charts are saved by content digest and can be
reopened from **Saved charts**. A dataset-generated chart keeps its local
provenance when reopened; an external document's source is a claim, not
independent verification. A dataset-linked export can be imported again when
its complete content matches a chart saved in this App's local data.

Ask Agent freezes a revision of the existing App object and fills the owning
chat's draft. The user sends the prompt through the normal ACP session. App Use
exposes query, chart, complete source, and export actions; these return bounded
metadata rather than repeating the dataset. The declared import write accepts
up to 64 KiB of explicit JSON text; larger inputs use the App's file picker.

This is Pero's managed Data Agent App. It does not claim compatibility or account
access for the separate OpenAI Data plugin. A loopback/fixture Agent test does
not certify a real model, connector, or analytical conclusion.

The Composer skill picker can discover and attach the built-in `data` skill.
It guides use of the existing App Use actions; it does not install arbitrary
Codex plugins or enter every conversation automatically.

Run `npm test` and `npm run typecheck` in this directory. Build with
`node scripts/build/apps.mjs --app data-agent` from the repository root.
