// Scientific series preserve the App SDK palette; dash patterns also distinguish series.
// Canvas-based renderers read active theme tokens and use these values without a DOM.
export const PERO_CHART_SERIES = Object.freeze([
  Object.freeze({ stroke: "#3B6FD8", dash: "0", dashName: "实线" }),
  Object.freeze({ stroke: "#D9535F", dash: "7 4", dashName: "长虚线" }),
  Object.freeze({ stroke: "#2F9564", dash: "2 3", dashName: "点线" }),
  Object.freeze({ stroke: "#845EC2", dash: "11 4 2 4", dashName: "点划线" }),
  Object.freeze({ stroke: "#B86A18", dash: "4 3 1 3", dashName: "疏点线" }),
  Object.freeze({ stroke: "#9C7A14", dash: "9 3", dashName: "疏虚线" }),
]);

/** uPlot takes a dash as numbers; "0" is a solid line. */
export function dashArray(dash) {
  const values = String(dash).trim().split(/\s+/).map(Number).filter(value => Number.isFinite(value) && value > 0);
  return values.length ? values : undefined;
}

/** The same six series on a dark chart surface (design tokens chart-1..6, dark). */
export const PERO_CHART_SERIES_DARK = Object.freeze(PERO_CHART_SERIES.map((style, index) =>
  Object.freeze({ ...style, stroke: ["#3B6FD8", "#D9535F", "#2F9564", "#845EC2", "#EB9234", "#F2C94C"][index] })));

/**
 * The active theme's value of a token, read from the document; the constant above is the
 * fallback (no DOM, or a host without tokens.css). uPlot draws on canvas, so callers re-read
 * this when the theme changes (LaneChart.setTheme) instead of relying on CSS inheritance.
 */
export function themeToken(name, fallback) {
  try {
    const node = globalThis.document?.body ?? globalThis.document?.documentElement;
    const value = node && getComputedStyle(node).getPropertyValue(`--pero-${name}`).trim();
    return value || fallback;
  } catch { return fallback; }
}

export function seriesStyle(index, dark = false) {
  const table = dark ? PERO_CHART_SERIES_DARK : PERO_CHART_SERIES;
  const i = ((index % table.length) + table.length) % table.length;
  const stroke = themeToken(`chart-${i + 1}`, table[i].stroke);
  return stroke === table[i].stroke ? table[i] : Object.freeze({ ...table[i], stroke });
}

/**
 * The host palette (light/dark) plus the few roles a time-series lane needs
 * that a categorical chart does not: event markers, shaded gaps, the shared
 * cursor and a drag selection.
 */
export function appChartTheme(dark) {
  return Object.freeze({
    dark: !!dark,
    bg: { elevated: themeToken("chart-surface", dark ? "#1d2e43" : "#ffffff") },
    text: { primary: themeToken("text", dark ? "#ecf3f6" : "#24354b"), secondary: themeToken("text-secondary", dark ? "#a3b4c5" : "#5f6e80"), tertiary: themeToken("text-secondary", dark ? "#a3b4c5" : "#5f6e80") },
    stroke: { primary: themeToken("border-control", dark ? "#6b8098" : "#7d8da0"), secondary: themeToken("border-subtle", dark ? "#40536a" : "#d8e1e8") },
    accent: { primary: themeToken("link", dark ? "#ecf3f6" : "#24354b") },
    marker: themeToken("danger", dark ? "#f58b92" : "#a62f41"),
    band: dark ? "rgba(245,139,146,.14)" : "rgba(166,47,65,.10)",
    cursor: themeToken("link", dark ? "#ecf3f6" : "#24354b"),
    select: dark ? "rgba(88,211,192,.18)" : "rgba(88,211,192,.12)",
  });
}
