/*
 * `@pero/app-sdk/chart`: the native Pero chart for App panels.
 *
 * The host registers this module in `globalThis.__pero_modules` next to React
 * and `@pero/app-sdk` (see ../client.tsx), and the App builder resolves the
 * specifier to that registry entry, so every App panel draws with the same
 * chart — one uPlot, the Pero palette, the host's light/dark mode — instead
 * of vendoring its own.
 *
 * Two shapes share this module:
 *  - `TimeSeriesLanes` / `LaneChart`: high-frequency time series (uPlot).
 *  - `DocumentChart`: declarative chart documents from `@pero/data-chart`
 *    (bounded SVG subset; same contract as Canvas / inline answers).
 */
import React, { useEffect, useRef } from "react";
import { useTheme } from "../index";
import { LaneChart as LaneChartImpl, alignLane, countRuns, ensureChartStyles } from "./lanes.mjs";
import { PERO_CHART_SERIES, PERO_CHART_SERIES_DARK, dashArray, appChartTheme, seriesStyle } from "./palette.mjs";
import {
  APP_DOCUMENT_CHART_TYPES,
  DocumentChart,
  ensureDocumentChartStyles,
  projectAppChartDocument,
} from "./document";

export {
  alignLane, countRuns, ensureChartStyles, PERO_CHART_SERIES, PERO_CHART_SERIES_DARK, dashArray, appChartTheme, seriesStyle,
  APP_DOCUMENT_CHART_TYPES, DocumentChart, ensureDocumentChartStyles, projectAppChartDocument,
};
export type { DocumentChartProps } from "./document";

/** `[x, y | null, identity?]`, or `null` for a break drawn as a gap. */
export type LanePoint = [number, number | null, number?] | null;

export interface LaneInput {
  key: string;
  label?: string;
  unit?: string;
  points: LanePoint[];
  /** A second, dashed series on the same lane (e.g. a baseline recording). */
  baseline?: LanePoint[] | null;
  /** Shown in the readout when the cursor is not over the chart (e.g. the latest value). */
  value?: string;
  note?: string;
  /** The lane cannot be drawn; the reason is shown instead of a plot. */
  error?: string;
  primary?: boolean;
  height?: number;
  /** Extra `data-*` attributes on the lane element, for the App's own checks. */
  attributes?: Record<string, string | number | boolean>;
}

export interface LaneDecorations {
  /** x positions of events, drawn as short ticks at the top of every lane. */
  markers?: number[];
  /** x intervals to shade, e.g. gaps in a recording. */
  bands?: [number, number][];
  /** A highlighted x position (the selected sample), or null. */
  cursorMs?: number | null;
}

export interface LaneCallbacks {
  /** Click on a lane: the identity of the nearest real point, its x, and the lane key. */
  onPick?(identity: number, x: number, lane: string): void;
  /** Drag across lanes to select an x interval. Enabled only when given. */
  onSelect?(from: number, to: number): void;
  /** Double click. */
  onReset?(): void;
}

export interface LaneChartOptions {
  /** Lanes with the same key share one cursor. */
  syncKey?: string;
  laneHeight?: number | ((lane: LaneInput) => number);
  /** Show the x axis on every lane, or only on the last one. */
  xAxis?: "every" | "last";
  formatX?: (value: number) => string;
  formatReadout?: (sample: { lane: string; x: number; value: number | null; baseline?: number | null }) => string;
  /** Draw sample markers when a lane has fewer samples than this. */
  markPointsBelow?: number;
  dark?: boolean;
}

export interface LaneChart {
  render(lanes: LaneInput[], window: [number, number], decorations?: LaneDecorations): void;
  setDecorations(decorations: LaneDecorations): void;
  setTheme(dark: boolean, themeId?: string): void;
  resize(): void;
  destroy(): void;
}

export const LaneChart = LaneChartImpl as unknown as new (root: HTMLElement, callbacks?: LaneCallbacks, options?: LaneChartOptions) => LaneChart;

export interface TimeSeriesLanesProps extends LaneCallbacks, Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect" | "onReset"> {
  lanes: LaneInput[];
  range: [number, number];
  decorations?: LaneDecorations;
  options?: LaneChartOptions;
  /** Follow the host's light/dark mode (default), or match a panel that is always one of them. */
  appearance?: "auto" | "dark" | "light";
}

/**
 * Lanes as a React component. Options and which callbacks exist are read once,
 * at mount; lanes, range and decorations are applied on every render, and the
 * host's light/dark mode is followed unless `appearance` pins one.
 */
export function TimeSeriesLanes({ lanes, range, decorations, options, appearance = "auto", onPick, onSelect, onReset, ...rest }: TimeSeriesLanesProps) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<LaneChart | null>(null);
  const callbacks = useRef<LaneCallbacks>({});
  callbacks.current = { onPick, onSelect, onReset };
  const theme = useTheme();
  const dark = appearance === "auto" ? theme.mode === "dark" : appearance === "dark";

  useEffect(() => {
    if (!host.current) return;
    const wired: LaneCallbacks = {};
    if (onPick) wired.onPick = (...args) => callbacks.current.onPick?.(...args);
    if (onSelect) wired.onSelect = (...args) => callbacks.current.onSelect?.(...args);
    if (onReset) wired.onReset = () => callbacks.current.onReset?.();
    const instance = new LaneChart(host.current, wired, { ...options, dark });
    chart.current = instance;
    return () => { instance.destroy(); chart.current = null; };
  }, []);

  useEffect(() => { chart.current?.setTheme(dark, theme.id); }, [dark, theme.id]);
  useEffect(() => { chart.current?.render(lanes, range, decorations); });

  return <div ref={host} {...rest} />;
}
