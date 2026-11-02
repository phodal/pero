/*
 * LaneChart: the platform's high-frequency time-series chart for App panels.
 *
 * Small multiples, one signal per lane, every lane on one shared x window with
 * a synced cursor. Lanes rather than one plot with several series because the
 * signals an App shows (a CAN bus, a vehicle log) carry different units and
 * wildly different ranges; a shared y axis would flatten one of them, and
 * normalising each would put incomparable numbers on the same pixel row.
 *
 * Drawn with the one vendored uPlot (../../vendor/uplot), styled with the
 * native Point chart palette (palette.mjs), so an App chart looks like every
 * other chart in Point. Declarative categorical charts (bar/line/area over at
 * most 2000 rows) use `DocumentChart` in this package (same `@pero/data-chart`
 * document as Canvas); this module is for the sample counts and live refresh
 * rates that an SVG chart cannot keep up with.
 *
 * Nothing is invented between samples: a `null` point is a break, drawn as a
 * gap, and every lane declares both how many runs it was given
 * (`data-segments`) and how many it handed to uPlot (`data-drawn-segments`),
 * so a check can compare the two without reading pixels.
 */
// @ts-ignore -- the .esm.js build ships no sibling .d.ts; types come from uPlot.d.ts.
import uPlot from "uplot";
import { UPLOT_CSS } from "./uplot-css.mjs";
import { dashArray, pointChartTheme, seriesStyle } from "./palette.mjs";

export { uPlot };

const STYLE_ELEMENT_ID = "pero-app-chart-styles";
const FONT = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const LANE_CSS = `
[data-pero-lanes]{--pero-lane-text:var(--pero-text,#24354b);--pero-lane-muted:var(--pero-text-secondary,#5f6e80);--pero-lane-accent:var(--pero-chart-1,#24354b);--pero-lane-select:var(--pero-domain-app-sdk-pero-lane-select, rgba(88,211,192,.12));color:var(--pero-lane-text);font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
[data-pero-lanes] .pero-lane{margin-bottom:var(--pero-space-3, 6px)}
[data-pero-lanes] .pero-lane__head{display:flex;gap:var(--pero-space-5, 10px);align-items:baseline;flex-wrap:wrap;min-height:18px}
[data-pero-lanes] .pero-lane__title{font-weight:var(--pero-font-weight-semibold, 600)}
[data-pero-lanes] .pero-lane[data-primary=true] .pero-lane__title{color:var(--pero-lane-accent)}
[data-pero-lanes] .pero-lane__readout{margin-left:auto;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--pero-lane-muted);font-variant-numeric:tabular-nums}
[data-pero-lanes] .pero-lane__note{font-size:var(--pero-font-size-xs, 11px);color:var(--pero-lane-muted)}
[data-pero-lanes] .pero-lane[data-error=true] .pero-lane__note{color:var(--pero-danger,#a62f41)}
[data-pero-lanes] .uplot{font-family:inherit}
[data-pero-lanes] .u-select{background:var(--pero-lane-select)}
`;

/** Inject uPlot's stylesheet and the lane styles once per document. */
export function ensureChartStyles(doc = globalThis.document) {
  if (!doc || doc.getElementById(STYLE_ELEMENT_ID)) return;
  const element = doc.createElement("style");
  element.id = STYLE_ELEMENT_ID;
  element.textContent = UPLOT_CSS + LANE_CSS;
  (doc.head ?? doc.documentElement).appendChild(element);
}

/**
 * Draw-ready arrays for one lane. A point is `[x, y | null, identity?]`; a
 * bare `null` is a break, which becomes one `null` sample halfway between its
 * neighbours so uPlot (spanGaps off) draws a gap there.
 */
export function alignLane(points) {
  const entries = [];
  let previous = null;
  let broken = false;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (point === null || point === undefined) {
      // Consecutive breaks are one gap.
      if (broken) continue;
      let next = null;
      for (let j = i + 1; j < points.length && !next; j += 1) next = points[j];
      if (previous && next) { entries.push([(previous[0] + next[0]) / 2, null, null]); broken = true; }
      continue;
    }
    entries.push([point[0], point[1] ?? null, point[2] ?? null]);
    previous = point;
    broken = false;
  }
  entries.sort((a, b) => a[0] - b[0]);
  return { xs: entries.map(entry => entry[0]), ys: entries.map(entry => entry[1]), ids: entries.map(entry => entry[2]) };
}

/** Runs of consecutive non-null values: what the eye sees as separate lines. */
export function countRuns(values) {
  let runs = 0;
  let inside = false;
  for (const value of values) {
    const present = value !== null && value !== undefined;
    if (present && !inside) runs += 1;
    inside = present;
  }
  return runs;
}

const defaults = Object.freeze({
  syncKey: "pero-lanes",
  laneHeight: lane => (lane.primary ? 190 : 120),
  xAxis: "every",
  formatX: value => `${Math.round(value)}`,
  formatReadout: ({ x, value, baseline }) => `${x.toFixed(1)} · ${value === null || value === undefined ? "—" : +Number(value).toFixed(6)}${baseline === null || baseline === undefined ? "" : ` · 基线 ${+Number(baseline).toFixed(6)}`}`,
  markPointsBelow: 120,
  minWidth: 200,
});

export class LaneChart {
  /**
   * @param root      the element the lanes are drawn into (owned by the chart)
   * @param callbacks `{ onPick?(identity, x, laneKey), onSelect?(from, to), onReset?() }`
   * @param options   `{ syncKey, laneHeight, xAxis: 'every'|'last', formatX, formatReadout, markPointsBelow, dark }`
   */
  constructor(root, callbacks = {}, options = {}) {
    this.root = root;
    this.callbacks = callbacks;
    this.options = { ...defaults, ...options };
    this.lanes = new Map();
    this.window = [0, 1];
    this.deco = { markers: [], bands: [], cursorMs: null };
    this.dark = !!options.dark;
    this.width = Math.max(this.options.minWidth, Math.floor(root.getBoundingClientRect?.().width ?? 600) || 600);
    ensureChartStyles(root.ownerDocument);
    root.setAttribute("data-pero-lanes", "");
    this.applyTheme();
    this.observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.resize()) : null;
    this.observer?.observe(root);
  }

  theme() { return pointChartTheme(this.dark); }

  applyTheme() {
    const theme = this.theme();
    const style = this.root.style;
    style?.setProperty?.("--pero-lane-text", theme.text.primary);
    style?.setProperty?.("--pero-lane-muted", theme.text.secondary);
    style?.setProperty?.("--pero-lane-accent", seriesStyle(0, this.dark).stroke);
    style?.setProperty?.("--pero-lane-select", theme.select);
  }

  /** Re-read theme colours and redraw. `themeId` lets a switch between two dark themes repaint too. */
  setTheme(dark, themeId) {
    if (!!dark === this.dark && themeId === this.themeId) return;
    this.dark = !!dark;
    this.themeId = themeId;
    this.applyTheme();
    for (const lane of this.lanes.values()) this.rebuild(lane);
  }

  /**
   * @param lanes  `[{ key, label?, unit?, points, baseline?, value?, note?, error?, primary?, height?, attributes? }]`
   * @param window the shared x range `[from, to]`
   * @param deco   `{ markers: x[], bands: [from, to][], cursorMs: x | null }`
   */
  render(lanes, window, deco = this.deco) {
    this.window = window[1] > window[0] ? window : [window[0], window[0] + 1];
    this.deco = { markers: [], bands: [], cursorMs: null, ...deco };
    const keep = new Set(lanes.map(lane => lane.key));
    for (const [key, lane] of this.lanes) {
      if (!keep.has(key)) {
        lane.plot?.destroy();
        lane.root.remove();
        this.lanes.delete(key);
      }
    }
    lanes.forEach((input, order) => {
      let lane = this.lanes.get(input.key);
      if (!lane) {
        lane = this.createLane(input.key);
        this.lanes.set(input.key, lane);
      }
      if (this.root.children[order] !== lane.root) this.root.insertBefore(lane.root, this.root.children[order] ?? null);
      this.fill(lane, input, this.options.xAxis === "every" || order === lanes.length - 1);
    });
  }

  setDecorations(deco) {
    this.deco = { markers: [], bands: [], cursorMs: null, ...deco };
    for (const lane of this.lanes.values()) lane.plot?.redraw(false, false);
  }

  createLane(key) {
    const doc = this.root.ownerDocument;
    const root = doc.createElement("section");
    root.className = "pero-lane";
    root.dataset.lane = key;
    const head = doc.createElement("div");
    head.className = "pero-lane__head";
    const title = doc.createElement("span");
    title.className = "pero-lane__title";
    const note = doc.createElement("span");
    note.className = "pero-lane__note";
    const readout = doc.createElement("span");
    readout.className = "pero-lane__readout";
    head.append(title, note, readout);
    const host = doc.createElement("div");
    host.className = "pero-lane__plot";
    root.append(head, host);
    this.root.append(root);
    return { key, root, title, readout, note, host, plot: null, seriesCount: 0, showX: null, ids: [], xs: [], input: null, attributes: [] };
  }

  fill(lane, input, showX) {
    lane.input = input;
    lane.title.textContent = `${input.label ?? input.key}${input.unit ? ` (${input.unit})` : ""}`;
    lane.note.textContent = input.error ? `不可显示：${input.error}` : input.note ?? "";
    lane.root.dataset.primary = String(!!input.primary);
    lane.root.dataset.error = String(!!input.error);
    for (const name of lane.attributes) if (!Object.hasOwn(input.attributes ?? {}, name)) delete lane.root.dataset[name];
    lane.attributes = Object.keys(input.attributes ?? {});
    for (const [name, value] of Object.entries(input.attributes ?? {})) lane.root.dataset[name] = String(value);
    if (!lane.hovering) lane.readout.textContent = input.value ?? "";
    lane.root.dataset.segments = String(countRuns((input.points ?? []).map(point => (point === null || point === undefined ? null : point[1]))));
    if (input.error) {
      lane.plot?.destroy();
      lane.plot = null;
      lane.host.replaceChildren();
      lane.root.dataset.drawnSegments = "0";
      return;
    }
    const target = alignLane(input.points ?? []);
    let data;
    let ids = target.ids;
    if (input.baseline) {
      const base = alignLane(input.baseline);
      data = uPlot.join([[target.xs, target.ys], [base.xs, base.ys]]);
      const byX = new Map();
      target.xs.forEach((x, i) => { if (target.ids[i] !== null && !byX.has(x)) byX.set(x, target.ids[i]); });
      ids = data[0].map(x => byX.get(x) ?? null);
    } else {
      data = [target.xs, target.ys];
    }
    lane.ids = ids;
    lane.xs = data[0];
    lane.root.dataset.drawnSegments = String(countRuns(data[1]));
    const count = data.length - 1;
    const height = input.height ?? (typeof this.options.laneHeight === "function" ? this.options.laneHeight(input) : this.options.laneHeight);
    if (!lane.plot || lane.seriesCount !== count || lane.showX !== showX || lane.height !== height || lane.dense !== this.dense(data)) {
      lane.seriesCount = count;
      lane.showX = showX;
      lane.height = height;
      this.rebuild(lane, data);
    } else {
      lane.plot.setData(data, true);
    }
  }

  dense(data) { return (data?.[0]?.length ?? 0) >= this.options.markPointsBelow; }

  rebuild(lane, data) {
    const input = lane.input;
    if (!input || input.error) return;
    const values = data ?? lane.plot?.data;
    lane.plot?.destroy();
    lane.host.replaceChildren();
    const theme = this.theme();
    const primary = seriesStyle(0, this.dark);
    const baseline = seriesStyle(1, this.dark);
    lane.dense = this.dense(values);
    const self = this;
    const axis = { stroke: theme.text.secondary, grid: { stroke: theme.stroke.secondary, width: 1 }, ticks: { stroke: theme.stroke.secondary }, font: FONT };
    const options = {
      width: this.width,
      height: lane.height,
      legend: { show: false },
      cursor: {
        sync: { key: this.options.syncKey, setSeries: false },
        drag: { x: typeof this.callbacks.onSelect === "function", y: false, setScale: false },
        points: { show: false },
      },
      select: { show: typeof this.callbacks.onSelect === "function", left: 0, top: 0, width: 0, height: 0 },
      scales: {
        x: { time: false, range: () => [self.window[0], self.window[1]] },
        y: { range: (_u, min, max) => { if (min === null || max === null) return [0, 1]; const pad = Math.max((max - min) * 0.1, Math.abs(max) * 0.01, 0.05); return [min - pad, max + pad]; } },
      },
      axes: [
        { ...axis, show: !!lane.showX, size: 28, values: (_u, ticks) => ticks.map(tick => self.options.formatX(tick)) },
        { ...axis, size: 56 },
      ],
      series: [
        {},
        { stroke: primary.stroke, width: 1.5, spanGaps: false, points: { show: !lane.dense, size: 3, fill: primary.stroke } },
        ...(lane.seriesCount > 1 ? [{ stroke: baseline.stroke, width: 1.25, dash: dashArray(baseline.dash), spanGaps: false, points: { show: false } }] : []),
      ],
      hooks: {
        draw: [u => self.decorate(u)],
        setCursor: [u => {
          const idx = u.cursor.idx;
          if (idx === null || idx === undefined) { lane.hovering = false; lane.readout.textContent = lane.input?.value ?? ""; return; }
          lane.hovering = true;
          lane.readout.textContent = self.options.formatReadout({
            lane: lane.key, x: u.data[0][idx], value: u.data[1][idx], baseline: lane.seriesCount > 1 ? u.data[2][idx] : undefined,
          });
        }],
        setSelect: [u => {
          if (u.select.width < 4) return;
          const from = u.posToVal(u.select.left, "x");
          const to = u.posToVal(u.select.left + u.select.width, "x");
          u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
          self.callbacks.onSelect?.(from, to);
        }],
      },
    };
    const plot = new uPlot(options, values ?? [[], []], lane.host);
    if (typeof this.callbacks.onPick === "function") {
      plot.over.addEventListener("click", () => {
        const idx = plot.cursor.idx;
        if (idx === null || idx === undefined) return;
        // Nearest drawn sample that is a real point (breaks have no identity).
        for (let d = 0; d < lane.ids.length; d += 1) {
          for (const i of [idx - d, idx + d]) {
            const id = lane.ids[i];
            if (id !== null && id !== undefined) { self.callbacks.onPick(id, lane.xs[i], lane.key); return; }
          }
        }
      });
    }
    if (typeof this.callbacks.onReset === "function") plot.over.addEventListener("dblclick", () => self.callbacks.onReset());
    lane.plot = plot;
  }

  decorate(u) {
    const theme = this.theme();
    const ctx = u.ctx;
    const { top, height, left, width } = u.bbox;
    const ratio = globalThis.devicePixelRatio || 1;
    const x = value => u.valToPos(value, "x", true);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.fillStyle = theme.band;
    for (const [a, b] of this.deco.bands ?? []) {
      if (b < this.window[0] || a > this.window[1]) continue;
      ctx.fillRect(x(a), top, Math.max(1, x(b) - x(a)), height);
    }
    ctx.strokeStyle = theme.marker;
    ctx.lineWidth = 2 * ratio;
    for (const marker of this.deco.markers ?? []) {
      if (marker < this.window[0] || marker > this.window[1]) continue;
      ctx.beginPath();
      ctx.moveTo(x(marker), top);
      ctx.lineTo(x(marker), top + 10 * ratio);
      ctx.stroke();
    }
    if (this.deco.cursorMs !== null && this.deco.cursorMs !== undefined) {
      ctx.strokeStyle = theme.cursor;
      ctx.lineWidth = 1.5 * ratio;
      ctx.beginPath();
      ctx.moveTo(x(this.deco.cursorMs), top);
      ctx.lineTo(x(this.deco.cursorMs), top + height);
      ctx.stroke();
    }
    ctx.restore();
  }

  resize() {
    const width = Math.max(this.options.minWidth, Math.floor(this.root.getBoundingClientRect().width));
    if (!width || width === this.width) return;
    this.width = width;
    for (const lane of this.lanes.values()) lane.plot?.setSize({ width, height: lane.plot.height });
  }

  destroy() {
    this.observer?.disconnect();
    for (const lane of this.lanes.values()) lane.plot?.destroy();
    this.lanes.clear();
    this.root.replaceChildren();
  }
}
