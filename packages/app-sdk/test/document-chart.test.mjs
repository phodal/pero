import test from "node:test";
import assert from "node:assert/strict";
import {
  APP_DOCUMENT_CHART_TYPES,
  appHistogramBins,
  buildDocumentPlot,
  projectAppChartDocument,
} from "../src/chart/document.mjs";

const barDocument = (overrides = {}) => ({
  schemaVersion: 1,
  title: "Slice complexity",
  chart: { type: "bar", x: "bin", y: "count", yLabel: "count" },
  rows: [
    { bin: "0", count: 5 },
    { bin: "50", count: 1 },
    { bin: "100", count: 0 },
  ],
  source: { label: "overview" },
  ...overrides,
});

test("App document chart accepts the shared bar document and keeps row order", () => {
  const projected = projectAppChartDocument(barDocument());
  assert.equal(projected.ok, true);
  const plot = buildDocumentPlot(projected.data);
  assert.equal(plot.type, "bar");
  assert.deepEqual(plot.categories, ["0", "50", "100"]);
  assert.equal(plot.series[0].points[0].y, 5);
  assert.equal(plot.series[0].points[2].y, 0);
  assert.equal(plot.empty, false);
});

test("App document chart refuses families it does not draw", () => {
  const secret = "node-must-not-appear-in-error";
  const projected = projectAppChartDocument(barDocument({
    chart: { type: "sankey", x: "from", y: "flow", series: "to" },
    rows: [{ from: secret, to: "b", flow: 1 }],
  }));
  assert.equal(projected.ok, false);
  assert.match(projected.error, /do not render chart type "sankey"/);
  assert.equal(projected.error.includes(secret), false);
});

test("App document chart refuses an invalid document without echoing input", () => {
  const secret = "must-not-leak-xyz";
  const projected = projectAppChartDocument(barDocument({ title: "" }));
  assert.equal(projected.ok, false);
  assert.equal(projected.error.includes(secret), false);
});

test("histogram observations are binned; missing y stays out of the counts", () => {
  const bins = appHistogramBins(
    [{ y: 1 }, { y: 2 }, { y: null }, { y: 9 }],
    2,
  );
  assert.equal(bins.length, 2);
  assert.equal(bins.reduce((n, bin) => n + bin.y, 0), 3);
});

test("APP_DOCUMENT_CHART_TYPES is the closed App render set", () => {
  assert.deepEqual([...APP_DOCUMENT_CHART_TYPES], ["bar", "horizontalBar", "line", "area", "histogram"]);
});
