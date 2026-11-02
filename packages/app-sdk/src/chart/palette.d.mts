export type SeriesStyle = Readonly<{ stroke: string; dash: string; dashName: string }>;
export const POINT_CHART_SERIES: readonly SeriesStyle[];
export const POINT_CHART_SERIES_DARK: readonly SeriesStyle[];
export function dashArray(dash: string): number[] | undefined;
export function seriesStyle(index: number, dark?: boolean): SeriesStyle;
export function themeToken(name: string, fallback: string): string;
export function pointChartTheme(dark?: boolean): Readonly<{ dark: boolean; bg: { elevated: string }; text: { primary: string; secondary: string; tertiary: string }; stroke: { primary: string; secondary: string }; accent: { primary: string }; marker: string; band: string; cursor: string; select: string }>;
