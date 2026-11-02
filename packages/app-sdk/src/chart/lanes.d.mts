import type { LanePoint, LaneInput, LaneCallbacks, LaneChartOptions, LaneDecorations, LaneChart as Chart } from './index';
export function alignLane(points: readonly LanePoint[]): { xs: number[]; ys: (number | null)[]; ids: (number | null)[] };
export function countRuns(values: readonly (number | null | undefined)[]): number;
export function ensureChartStyles(doc?: Document): void;
export const LaneChart: new (root: HTMLElement, callbacks?: LaneCallbacks, options?: LaneChartOptions) => Chart;
