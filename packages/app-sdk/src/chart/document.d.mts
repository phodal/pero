export type ChartRow = Readonly<{ x: string; y: number | null; series: string }>;
export type ProjectedChart = Readonly<{ type: string; title: string; ariaLabel: string; summary: string; xLabel: string; yLabel: string; y: string; bins?: number; seriesNames: readonly string[]; rows: readonly ChartRow[] }>;
export type DocumentPlot = { type: string; title: string; ariaLabel: string; summary: string; xLabel: string; yLabel: string; categories: string[]; series: { name: string; index: number; points: { x: string; y: number | null }[] }[]; lo: number; hi: number; span: number; empty: boolean };
export const APP_DOCUMENT_CHART_TYPES: readonly string[];
export function ensureDocumentChartStyles(doc?: Document): void;
export function projectAppChartDocument(input: unknown): { ok: true; data: ProjectedChart } | { ok: false; error: string };
export function buildDocumentPlot(data: ProjectedChart): DocumentPlot;
export function appHistogramBins(rows: readonly ChartRow[], bins?: number): ChartRow[];
export function formatChartTick(value: number): string;
export class ChartDocumentError extends Error {}
export function projectChartDocument(input: unknown): ProjectedChart;
