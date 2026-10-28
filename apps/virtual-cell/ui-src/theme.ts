import type { CSSProperties } from 'react';
import { appChartTheme, seriesStyle } from '@pero/app-sdk/chart';

/** Scope missing legacy-Host colour roles to this App, using its shared SDK palette. */
export function legacyThemeStyle(dark: boolean): CSSProperties {
  const theme = appChartTheme(dark);
  const roles: Record<string, string> = {
    surface: theme.bg.elevated,
    'surface-muted': theme.bg.elevated,
    text: theme.text.primary,
    'text-secondary': theme.text.secondary,
    'border-subtle': theme.stroke.secondary,
    'chart-grid': theme.stroke.secondary,
    link: theme.accent.primary,
    focus: theme.accent.primary,
    ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`chart-${i + 1}`, seriesStyle(i, dark).stroke])),
  };
  const host = getComputedStyle(document.body);
  return Object.fromEntries(Object.entries(roles)
    .filter(([name]) => !host.getPropertyValue(`--pero-${name}`).trim())
    .map(([name, value]) => [`--pero-${name}`, value])) as CSSProperties;
}
