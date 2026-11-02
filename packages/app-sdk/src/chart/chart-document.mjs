/**
 * Pero-owned declarative chart document contract (Desktop side).
 *
 * It lives next to the Canvas broker because it belongs to the Electron Node
 * side: the browser runtime package owns the Chart component, this module owns
 * the document that drives it. It is plain ESM JavaScript with no dependencies,
 * so tests can import it directly. It is the only place that reads a
 * declarative chart document: the projected input is then handed to the Pero
 * Canvas Chart component as a safe JSON literal. Nothing from the document is
 * ever inserted as source.
 *
 * The contract mirrors the inline chart input: schemaVersion 1, a title, an
 * evaluated `chart` specification, ordered `rows`, and a `source` record.
 * Unknown fields are rejected instead of ignored, rows are never aggregated,
 * overwritten or zero-filled, and unsupported chart families are never
 * silently substituted.
 */

export const CHART_DOCUMENT_SCHEMA_VERSION = 1;

/** Bound of the chart document input, in bytes, for JSON text and for objects. */
export const CHART_MAX_INPUT_BYTES = 2 * 1024 * 1024;
/** Bound of the row projection. */
export const CHART_MAX_ROWS = 2000;
/** Bound of the generated TSX source, in bytes. */
export const CHART_MAX_OUTPUT_BYTES = 262144;
/** Bound of the reader-facing title, in characters. */
export const CHART_MAX_TITLE_CHARS = 80;
/** Supported chart families. Anything else is rejected. */
export const CHART_TYPES = Object.freeze([
  "line", "area", "stackedArea",
  "bar", "horizontalBar", "stackedBar", "stackedBar100", "horizontalStackedBar", "horizontalStackedBar100",
  "histogram", "scatter", "heatmap", "pie", "leaderboard", "rankedList", "sparkline",
  "funnel", "waterfall", "boxPlot", "sankey",
]);

/**
 * What each family reads from a row. Every family is still one closed
 * long-form table: `x` a category (or, for scatter, a number), `series` a
 * second category, `y` the measure. A family never aggregates, fills or
 * reorders; the few derived views (stack offsets, histogram bins, waterfall
 * running totals) are drawn by the renderer from the unchanged rows.
 */
const FAMILY = Object.freeze({
  line: { series: "optional" }, area: { series: "optional" }, stackedArea: { series: "required", nonNegative: false },
  bar: { series: "optional" }, horizontalBar: { series: "optional" },
  stackedBar: { series: "required" }, stackedBar100: { series: "required", nonNegative: true },
  horizontalStackedBar: { series: "required" }, horizontalStackedBar100: { series: "required", nonNegative: true },
  histogram: { series: "optional", x: "optional", unique: false },
  scatter: { series: "optional", x: "number", unique: false, label: true },
  heatmap: { series: "required" },
  pie: { series: "none", nonNegative: true }, funnel: { series: "none", nonNegative: true },
  leaderboard: { series: "none" }, rankedList: { series: "none" }, sparkline: { series: "none" },
  waterfall: { series: "none", totals: true },
  boxPlot: { series: "none", box: true },
  sankey: { series: "required", nonNegative: true },
});
const BOX_FIELDS = Object.freeze(["low", "q1", "q3", "high"]);
export const HISTOGRAM_MIN_BINS = 2;
export const HISTOGRAM_MAX_BINS = 60;

const TOP_FIELDS = Object.freeze(["schemaVersion", "id", "title", "description", "queryId", "generatedAt", "chart", "rows", "source"]);
/** Closed chart specification fields. */
export const CHART_FIELDS = Object.freeze(["type", "x", "y", "series", "yLabel", "xLabel", "label", "low", "q1", "q3", "high", "bins", "totals"]);
/** Chart fields that name a row column, so a checked result must project them. */
export const CHART_COLUMN_FIELDS = Object.freeze(["x", "y", "series", "label", "low", "q1", "q3", "high"]);
const SOURCE_FIELDS = Object.freeze(["label", "caveats", "executedAt", "sql"]);

const LIMITS = Object.freeze({
  id: 128,
  queryId: 128,
  description: 1024,
  generatedAt: 64,
  yLabel: 80,
  sourceLabel: 160,
  executedAt: 64,
  sql: 4096,
  caveats: 8,
  caveat: 400,
  column: 64,
  coordinate: 160,
});

/** Raised for every rejected document. The message never echoes raw input. */
export class ChartDocumentError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChartDocumentError";
  }
}

const reject = (message) => {
  throw new ChartDocumentError(message);
};

const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const characters = (value) => Array.from(value).length;

function assertClosed(value, allowed, where) {
  if (!isPlainObject(value)) reject(`${where} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      reject(`${where} carries an unsupported field; the chart document schema is closed`);
    }
  }
}

function boundedText(name, value, { required = false, min = 0, max }) {
  if (value === undefined) {
    if (required) reject(`${name} is required`);
    return "";
  }
  if (typeof value !== "string") reject(`${name} must be a string`);
  const length = characters(value);
  if (required && value.trim() === "") reject(`${name} must not be blank`);
  if (length < min) reject(`${name} must be at least ${min} character(s)`);
  if (length > max) reject(`${name} exceeds ${max} characters`);
  return value;
}

/**
 * Column names and series values become object keys downstream: the renderer
 * pivots long-form rows into per-series objects. A key that names a prototype
 * member would reach through those objects instead of sitting in them, so it is
 * refused at the contract rather than sanitised later.
 */
const RESERVED_KEYS = Object.freeze(["__proto__", "prototype", "constructor"]);

function columnName(name, value, { required = false } = {}) {
  if (value === undefined) {
    if (required) reject(`${name} is required`);
    return "";
  }
  if (typeof value !== "string") reject(`${name} must be a string`);
  if (value === "") {
    if (required) reject(`${name} is required`);
    return "";
  }
  if (value.trim() !== value) reject(`${name} must not be blank or padded`);
  if (characters(value) > LIMITS.column) reject(`${name} exceeds ${LIMITS.column} characters`);
  if (RESERVED_KEYS.includes(value)) reject(`${name} must not name a reserved object key`);
  return value;
}

/**
 * Reject anything that is not exact JSON data.
 *
 * A JSON document may only carry finite numbers, strings, booleans, null, plain
 * objects and arrays. An already-decoded object can still smuggle in a cycle, a
 * BigInt, a function, a symbol, an undefined entry or a non-finite number (NaN /
 * Infinity), and `JSON.stringify` would silently rewrite them (NaN and Infinity
 * become null, functions and undefined disappear). This walk rejects all of
 * that before any field is read, and never echoes a value.
 */
function assertJsonValue(name, root) {
  const seen = new WeakSet();
  const visit = (value, where) => {
    if (value === null) return;
    switch (typeof value) {
      case "number":
        if (!Number.isFinite(value)) reject(`${where} must be a finite JSON number`);
        return;
      case "string":
      case "boolean":
        return;
      case "undefined":
        reject(`${where} must be JSON data; undefined is not representable in JSON`);
        return;
      case "bigint":
        reject(`${where} must be JSON data; BigInt is not representable in JSON`);
        return;
      case "function":
      case "symbol":
        reject(`${where} must be JSON data; functions and symbols are not representable in JSON`);
        return;
      case "object":
        break;
      default:
        reject(`${where} must be JSON data`);
    }
    if (seen.has(value)) reject(`${where} must be JSON data; a circular structure is not representable in JSON`);
    seen.add(value);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (Object.hasOwn(value, index)) visit(value[index], `${where}[${index}]`);
      }
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        reject(`${where} must be JSON data; only plain objects and arrays are accepted`);
      }
      for (const key of Object.keys(value)) visit(value[key], `${where} object field`);
    }
    seen.delete(value);
  };
  visit(root, name);
}

/** Depth of a JSON value, used to bound decoded objects without serializing them. */
function jsonDepth(root) {
  const seen = new WeakSet();
  const walk = (value) => {
    if (value === null || typeof value !== "object") return 1;
    if (seen.has(value)) return 1;
    seen.add(value);
    let depth = 1;
    for (const key of Object.keys(value)) {
      const child = walk(value[key]);
      if (child + 1 > depth) depth = child + 1;
    }
    seen.delete(value);
    return depth;
  };
  return walk(root);
}

/**
 * Byte bound for a decoded object. The value was already checked to be acyclic
 * JSON data, so re-encoding it is safe; nothing from it is ever echoed back.
 */
function assertObjectSize(raw) {
  let text;
  try {
    text = JSON.stringify(raw);
  } catch {
    reject("chart document input must be JSON data");
  }
  if (new TextEncoder().encode(text ?? "").length > CHART_MAX_INPUT_BYTES) {
    reject(`chart document input exceeds ${CHART_MAX_INPUT_BYTES} bytes`);
  }
}

/** Parse JSON text once, bounded by the document limit before decoding. */
function fromJsonText(text) {
  if (typeof text !== "string") reject("chart document input must be a JSON string or an object");
  if (text.length === 0) reject("chart document input is empty");
  if (new TextEncoder().encode(text).length > CHART_MAX_INPUT_BYTES) {
    reject(`chart document input exceeds ${CHART_MAX_INPUT_BYTES} bytes`);
  }
  let decoded;
  try {
    decoded = JSON.parse(text);
  } catch {
    // The parser message echoes the offending input slice; never surface it.
    reject("chart document input is not valid JSON");
  }
  return decoded;
}

/**
 * Validate one declarative chart document and return its reviewed projection.
 * @param {string|object} input JSON text or an already-decoded object.
 */
export function validateChartDocument(input) {
  let raw;
  if (typeof input === "string") {
    raw = fromJsonText(input);
  } else if (input !== null && typeof input === "object") {
    raw = input;
    assertJsonValue("chart document", raw);
    if (jsonDepth(raw) > 64) reject("chart document input is nested too deeply");
    assertObjectSize(raw);
  } else {
    reject("chart document input must be a JSON string or an object");
  }
  if (raw === undefined || raw === null) reject("chart document input is empty");
  if (typeof raw !== "string" && typeof raw !== "object") reject("chart document input must be a JSON string or an object");
  assertClosed(raw, TOP_FIELDS, "chart document");

  if (raw.schemaVersion !== CHART_DOCUMENT_SCHEMA_VERSION) {
    reject(`schemaVersion must be ${CHART_DOCUMENT_SCHEMA_VERSION}`);
  }
  const title = boundedText("title", raw.title, { required: true, min: 1, max: CHART_MAX_TITLE_CHARS });
  const id = boundedText("id", raw.id, { max: LIMITS.id });
  const description = boundedText("description", raw.description, { max: LIMITS.description });
  const queryId = boundedText("queryId", raw.queryId, { max: LIMITS.queryId });
  const generatedAt = boundedText("generatedAt", raw.generatedAt, { max: LIMITS.generatedAt });

  assertClosed(raw.chart, CHART_FIELDS, "chart");
  const type = raw.chart.type;
  if (typeof type !== "string" || type === "") reject("chart.type is required");
  if (!CHART_TYPES.includes(type)) {
    reject(`chart.type is unsupported; supported types are ${CHART_TYPES.join(", ")}`);
  }
  const family = FAMILY[type];
  const x = columnName("chart.x", raw.chart.x, { required: family.x !== "optional" });
  const y = columnName("chart.y", raw.chart.y, { required: true });
  const series = columnName("chart.series", raw.chart.series, { required: family.series === "required" });
  if (family.series === "none" && series !== "") reject(`chart.series is not used by ${type}; ${type} draws one measure`);
  const labelColumn = columnName("chart.label", raw.chart.label);
  if (labelColumn !== "" && !family.label) reject(`chart.label is only used by scatter`);
  const box = {};
  for (const field of BOX_FIELDS) {
    box[field] = columnName(`chart.${field}`, raw.chart[field], { required: family.box === true });
    if (box[field] !== "" && !family.box) reject(`chart.${field} is only used by boxPlot`);
  }
  const named = [x, y, series, labelColumn, ...BOX_FIELDS.map((field) => box[field])].filter((name) => name !== "");
  if (new Set(named).size !== named.length) reject("chart columns must name distinct row fields");
  const yLabel = boundedText("chart.yLabel", raw.chart.yLabel, { max: LIMITS.yLabel });
  const xLabel = boundedText("chart.xLabel", raw.chart.xLabel, { max: LIMITS.yLabel });
  let bins = 0;
  if (raw.chart.bins !== undefined) {
    if (type !== "histogram") reject("chart.bins is only used by histogram");
    if (!Number.isInteger(raw.chart.bins) || raw.chart.bins < HISTOGRAM_MIN_BINS || raw.chart.bins > HISTOGRAM_MAX_BINS) {
      reject(`chart.bins must be an integer from ${HISTOGRAM_MIN_BINS} to ${HISTOGRAM_MAX_BINS}`);
    }
    bins = raw.chart.bins;
  }
  let totals = [];
  if (raw.chart.totals !== undefined) {
    if (!family.totals) reject("chart.totals is only used by waterfall");
    if (!Array.isArray(raw.chart.totals) || raw.chart.totals.length > 32) reject("chart.totals must be an array of at most 32 x values");
    totals = raw.chart.totals.map((value, index) => coordinate(`chart.totals[${index}]`, value));
    if (new Set(totals).size !== totals.length) reject("chart.totals must not repeat an x value");
  }

  assertClosed(raw.source, SOURCE_FIELDS, "source");
  const label = boundedText("source.label", raw.source.label, { required: true, min: 1, max: LIMITS.sourceLabel });
  const executedAt = boundedText("source.executedAt", raw.source.executedAt, { max: LIMITS.executedAt });
  const sql = boundedText("source.sql", raw.source.sql, { max: LIMITS.sql });
  if (raw.source.caveats !== undefined && !Array.isArray(raw.source.caveats)) reject("source.caveats must be an array");
  const caveats = (raw.source.caveats ?? []).map((caveat, index) =>
    boundedText(`source.caveats[${index}]`, caveat, { max: LIMITS.caveat }));

  if (!Array.isArray(raw.rows)) reject("rows is required and must be an array");
  if (raw.rows.length > CHART_MAX_ROWS) {
    reject(`rows contains ${raw.rows.length} entries; the limit is ${CHART_MAX_ROWS}`);
  }

  const columns = named;
  const unique = family.unique !== false;
  const seen = new Set();
  const rows = raw.rows.map((row, index) => {
    const where = `rows[${index}]`;
    assertClosed(row, columns, where);
    for (const [field, name] of [["x", x], ["y", y], ["series", series], ["label", labelColumn], ...BOX_FIELDS.map((field) => [field, box[field]])]) {
      if (name !== "" && !Object.hasOwn(row, name)) reject(`${where} is missing its chart.${field} column`);
    }
    let xValue = "";
    let xNumber = null;
    if (family.x === "number") {
      if (typeof row[x] !== "number" || !Number.isFinite(row[x])) reject(`${where} chart.x must be a finite number for scatter`);
      xNumber = row[x];
      xValue = String(row[x]);
    } else if (x !== "") {
      xValue = coordinate(`${where} chart.x coordinate`, row[x]);
    }
    const seriesValue = series === "" ? "" : coordinate(`${where} chart.series coordinate`, row[series], { key: true });
    const yValue = measureOf(`${where} chart.y measure`, row[y], family.nonNegative === true);
    if (unique) {
      const key = `${xValue}\u0000${seriesValue}`;
      if (seen.has(key)) reject(`rows[${index}] duplicates an earlier chart coordinate`);
      seen.add(key);
    }
    const projected = { x: xValue, series: seriesValue, y: yValue };
    if (xNumber !== null) projected.xValue = xNumber;
    if (labelColumn !== "") projected.label = row[labelColumn] === null ? "" : coordinate(`${where} chart.label value`, row[labelColumn]);
    if (family.box) {
      const values = {};
      for (const field of BOX_FIELDS) values[field] = measureOf(`${where} chart.${field} measure`, row[box[field]], false);
      const ordered = [values.low, values.q1, yValue, values.q3, values.high];
      const present = ordered.filter((value) => value !== null);
      if (present.length !== 0 && present.length !== 5) reject(`${where} box summary must be complete or entirely null`);
      if (present.length === 5 && ordered.some((value, position) => position > 0 && value < ordered[position - 1])) {
        reject(`${where} box summary must satisfy low <= q1 <= median <= q3 <= high`);
      }
      projected.box = values;
    }
    return projected;
  });
  if (type === "sankey") assertAcyclicFlow(rows);
  for (const total of totals) {
    if (!rows.some((row) => row.x === total)) reject("chart.totals names an x value no row carries");
  }

  return {
    schemaVersion: CHART_DOCUMENT_SCHEMA_VERSION,
    id,
    title,
    description,
    queryId,
    generatedAt,
    chart: { type, x, y, series, yLabel, xLabel, label: labelColumn, ...box, bins, totals },
    rows,
    source: { label, caveats, executedAt, sql },
  };
}

/**
 * A Sankey diagram lays nodes out left to right, so a flow that returns to an
 * earlier node has no drawing. It is refused rather than broken silently.
 */
function assertAcyclicFlow(rows) {
  const next = new Map();
  for (const row of rows) {
    if (row.x === row.series) reject("sankey flows must not link a node to itself");
    if (!next.has(row.x)) next.set(row.x, []);
    next.get(row.x).push(row.series);
  }
  const state = new Map();
  const visit = (node) => {
    if (state.get(node) === 2) return;
    if (state.get(node) === 1) reject("sankey flows must not form a cycle");
    state.set(node, 1);
    for (const target of next.get(node) ?? []) visit(target);
    state.set(node, 2);
  };
  for (const node of next.keys()) visit(node);
}

function measureOf(name, value, nonNegative) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) reject(`${name} must be a finite number or null`);
  if (nonNegative && value < 0) reject(`${name} must not be negative for this chart type`);
  return value;
}

function coordinate(name, value, { key = false } = {}) {
  if (value === null || value === undefined) {
    reject(`${name} must not be null; missing measures stay null, missing coordinates are rejected`);
  }
  if (typeof value !== "string") reject(`${name} must be a string`);
  if (value.trim() === "") reject(`${name} must not be blank`);
  if (characters(value) > LIMITS.coordinate) reject(`${name} exceeds ${LIMITS.coordinate} characters`);
  // A series value is carried in `seriesNames` and used to look a series up.
  // The renderer pivots through internal `series_N` keys rather than this
  // text, but the name is refused here so no consumer has to remember that.
  if (key && RESERVED_KEYS.includes(value)) reject(`${name} must not name a reserved object key`);
  return value;
}

/**
 * Build the input projection the Chart component renders. It is data only:
 * no imports, no expressions, no host objects.
 */
export function projectChartDocument(document) {
  const reviewed = validateChartDocument(document);
  const { chart, rows } = reviewed;
  const multi = chart.series !== "";
  const seriesNames = [];
  const seen = new Set();
  if (multi) {
    for (const row of rows) {
      if (seen.has(row.series)) continue;
      seen.add(row.series);
      seriesNames.push(row.series);
    }
  }
  const measure = chart.yLabel === "" ? chart.y : chart.yLabel;
  let observed = 0;
  for (const row of rows) if (row.y !== null) observed += 1;
  const shape = chart.x === ""
    ? `${measure} 的分布`
    : multi
      ? `按 ${chart.series} 分系列，${chart.x} 为横轴，${measure} 为纵轴`
      : `${chart.x} 为横轴，${measure} 为纵轴`;
  const summary = rows.length === 0
    ? `当前输入没有数据行；${shape}。`
    : `${seriesNames.length > 1 ? `${seriesNames.length} 个系列，` : ""}${rows.length} 行输入数据，${observed} 个观测值，${rows.length - observed} 个缺失值保持 null。`;
  return Object.freeze({
    schemaVersion: reviewed.schemaVersion,
    id: reviewed.id,
    title: reviewed.title,
    description: reviewed.description,
    queryId: reviewed.queryId,
    generatedAt: reviewed.generatedAt,
    type: chart.type,
    x: chart.x,
    y: chart.y,
    series: chart.series,
    yLabel: chart.yLabel,
    xLabel: chart.xLabel,
    bins: chart.bins,
    totals: Object.freeze([...chart.totals]),
    seriesNames: Object.freeze(seriesNames),
    rows: Object.freeze(rows.map((row, index) => Object.freeze({
      index, x: row.x, series: row.series, y: row.y,
      ...(row.xValue === undefined ? {} : { xValue: row.xValue }),
      ...(row.label === undefined ? {} : { label: row.label }),
      ...(row.box === undefined ? {} : { box: Object.freeze({ ...row.box }) }),
    }))),
    source: Object.freeze({
      label: reviewed.source.label,
      caveats: Object.freeze([...reviewed.source.caveats]),
      executedAt: reviewed.source.executedAt,
      sql: reviewed.source.sql,
    }),
    ariaLabel: `${reviewed.title}：${shape}`,
    summary,
  });
}
