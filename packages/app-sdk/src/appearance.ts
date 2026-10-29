import themes from '../../../web/src/theme.generated.json';

export type AppearanceSnapshot = {
  dark: boolean;
  accent: 'teal' | 'blue' | 'neutral';
  typography: { ui: number; chat: number; code: number };
  palette: typeof themes.light;
};

/** Validate once when a snapshot crosses an iframe boundary. */
export function readAppearance(value: unknown): AppearanceSnapshot | undefined {
  if (!value || typeof value !== 'object') return;
  const candidate = value as AppearanceSnapshot;
  if (typeof candidate.dark !== 'boolean' || !['teal','blue','neutral'].includes(candidate.accent)) return;
  if (!candidate.typography || !['ui','chat','code'].every(key => {
    const size = candidate.typography[key as keyof AppearanceSnapshot['typography']];
    return Number.isInteger(size) && size >= 12 && size <= 24;
  })) return;
  if (!candidate.palette || !Object.keys(themes.light).every(key => /^#[0-9a-f]{6}$/i.test(candidate.palette[key as keyof typeof themes.light]))) return;
  return candidate;
}

/** Project the resolved Rust appearance; web surfaces do not resolve accents. */
export function applyAppearance(appearance: AppearanceSnapshot, element: HTMLElement = document.documentElement) {
  for (const [key,value] of Object.entries(appearance.palette)) element.style.setProperty(`--pero-${key}`,value);
  element.style.colorScheme = appearance.dark ? 'dark' : 'light';
  element.style.setProperty('--pero-font-ui', `${appearance.typography.ui}px`);
  element.style.setProperty('--pero-font-chat', `${appearance.typography.chat}px`);
  element.style.setProperty('--pero-font-code', `${appearance.typography.code}px`);
  element.style.setProperty('--pero-font-caption', `${Math.max(12,appearance.typography.ui*12/14)}px`);
  element.style.setProperty('--pero-font-scale', String(appearance.typography.ui/14));
  element.style.fontSize = `${appearance.typography.ui}px`;
  element.style.setProperty('--pero-text-secondary', appearance.palette['text-muted']);
  element.style.setProperty('--pero-border-subtle', appearance.palette.border);
}
