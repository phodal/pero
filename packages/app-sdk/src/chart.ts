import themes from '../../../web/src/theme.generated.json';

// Scientific series follow DESIGN.md's data palette, independent of status colors.
const light = ['#3B6FD8', '#D9535F', '#2F9564', '#845EC2', '#B86A18', '#9C7A14'];
const dark = ['#3B6FD8', '#D9535F', '#2F9564', '#845EC2', '#EB9234', '#F2C94C'];
export function seriesStyle(index: number, isDark = false) {
  return { stroke: (isDark ? dark : light)[index % light.length] };
}
export function appChartTheme(isDark = false) {
  const p = isDark ? themes.dark : themes.light;
  return { bg: { elevated: p.surface }, text: { primary: p.text, secondary: p['text-muted'] }, stroke: { secondary: p.border }, accent: { primary: p.action } };
}
