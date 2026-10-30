---
name: data
description: Analyze accessible datasets and create source-aware charts with the Pero Data Agent App.
---

# Data

Answer the user's question from data actually supplied or accessible through the
current session. Establish what each row represents, the measures and units,
time range, filters and source before drawing a conclusion. If a necessary source
or definition is unavailable, state the gap. Never invent rows, query results,
source links or statistical certainty.

## Work with Data Agent

Use the existing `app_use` workflow. Discover the installed and mounted Data
Agent with `inventory`, then start a task for the needed actions and observe its
`dataset-view` and `chart-document` objects. Use the actual observed actions
and parameter schemas; do not assume that an App or dataset exists. If the App
is not available or the provider has no App Use capability, explain the limitation.
An independent chart document can be rendered without opening a dataset;
creating a chart from a dataset requires a current dataset view.

- Import explicit JSON through the App's declared write when appropriate, or
  ask the user to select a file in the App. Do not fabricate a file reference.
- Read the dataset identity, revision, fields, counts, query and selected scope.
  A sample is only a sample; use bounded `read` requests for additional rows.
- Use `query` to change supported filters, sort, displayed fields or record
  selection. An explicit selection narrows the analysis. Re-observe after an
  action and keep the returned view identity with any resulting conclusions.
- For a chart of the current dataset, invoke `chart-document.create` with the
  chart `type` and field names. It uses the current matching records or explicit
  selection and records the dataset identity, view and source record pointers.
  This action uses the selected rows directly; it does not perform aggregation.
  Read and validate the scope and values before drawing conclusions.
- To display an independently supplied chart document, invoke
  `chart-document.render` with `document` containing the JSON document as a
  string (at most 65,536 characters). Its source label is a declaration, not
  linked dataset evidence. Both actions validate and save a chart; an action
  success does not by itself prove it appeared. Observe or capture the visible
  panel and verify what can actually be seen.
- For a dataset-generated chart, `chart-document.source` opens the linked
  immutable source, optionally at an original record ordinal. A chart with no
  linked dataset cannot use this action.
- Use `dataset-view.source` to open the complete immutable input, or
  `dataset-view.export` to open the selected result and provenance manifest.
  Read only what the task needs and retain source identities and relevant
  limitations in the answer.

## Chart and evidence semantics

Choose the chart for the data relationship and use only chart types the App
actually offers. A visual should not hide values needed for an exact comparison.
Use a table or text when a faithful chart is unavailable. Missing and null are
not zero; do not silently aggregate, fill, deduplicate, reorder or substitute a
chart type. Make an intended aggregation and its scope explicit. Preserve
units, time grain and important qualifications next to the result.

Treat a source label as a claim, not independent verification. A dataset digest
identifies bytes; it does not establish their correctness. Report mismatches,
partial coverage and limitations that affect the conclusion. An image capture
can show what appeared in the panel; it does not verify the underlying analysis.

The version 1 chart document uses a Point-inspired row format, for example:

```json
{
  "schemaVersion": 1,
  "id": "sales",
  "title": "Sales",
  "description": "Illustrative figures",
  "chart": {"type": "bar", "x": "month", "y": "revenue"},
  "rows": [{"month": "Jan", "revenue": 12}],
  "source": {"label": "Illustrative data", "caveats": ["Not actual sales"]}
}
```

`line`, `bar`, `area`, `pie` and `radar` use `x` and `y`; `line` may
add a `series` field with up to five distinct series. For line charts an
explicit numeric `null` remains a gap; do not replace it with zero. Other
chart types reject `series` and numeric `null`. `candlestick`
uses `x`, `open`, `high`, `low` and `close`; `sankey` uses `x`, `target`
and `y`. Pie, radar and sankey values cannot be negative, and sankey flows
cannot contain cycles. Duplicate coordinates are rejected: for a multi-series
line the coordinate is `(x, series)`, and for Sankey it is `(x, target)`.
Choose or aggregate the data explicitly rather than silently overwriting rows.
An arbitrary
document's `source` is a declaration. Dataset-generated charts carry a dataset
identity and view provenance; do not invent those identifiers. To call `render`,
serialize this whole document as the `document` string, and discover the actual
declared operation and its revision before invoking it.

This workflow does not supply a SQL executor, a warehouse connection, a report
publisher or the separate OpenAI Data plugin. Use only capabilities available
in the current host and never represent a fixture or illustrative data as a
real observation.
