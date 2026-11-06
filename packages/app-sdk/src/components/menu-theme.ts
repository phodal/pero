import { useLayoutEffect, type CSSProperties } from 'react';

/** Tokens the shared dropdown skin reads. Resolved from the trigger when content portals to body. */
const THEME_TOKENS = [
  '--pero-border', '--pero-border-subtle', '--pero-surface', '--pero-text', '--pero-text-muted',
  '--pero-hover', '--pero-surface-hover', '--pero-surface-pressed', '--pero-danger', '--pero-focus', '--pero-action', '--pero-accent-soft', '--pero-accent-text',
  '--pero-font-body', '--pero-font-caption', '--pero-font-size-md', '--pero-font-size-sm',
  '--pero-font-size-xs', '--pero-font-family-sans', '--pero-control-height', '--pero-row-menu',
  '--pero-radius-button', '--pero-spacing-1', '--pero-spacing-2',
  '--pero-accent-color',
  '--pero-muted',
  '--dsw-alias-border-primary',
  '--dsw-alias-bg-base',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-brand-primary',
  '--dsw-alias-button-info-fill',
  '--dsw-alias-button-info-label',
] as const;

function readToken(trigger: HTMLElement, token: string) {
  const view = trigger.ownerDocument.defaultView;
  const resolved = view?.getComputedStyle(trigger).getPropertyValue(token).trim();
  if (resolved) return resolved;
  let node: HTMLElement | null = trigger;
  while (node) {
    const inline = node.style.getPropertyValue(token).trim();
    if (inline) return inline;
    node = node.parentElement;
  }
  return '';
}

export function menuThemeStyle(trigger: HTMLElement | null, container: HTMLElement | undefined): CSSProperties {
  if (!trigger || container !== trigger.ownerDocument.body) return {};
  const view = trigger.ownerDocument.defaultView;
  const computed = view?.getComputedStyle(trigger);
  const style: Record<string, string> = {};
  for (const token of THEME_TOKENS) {
    const value = readToken(trigger, token);
    if (value) style[token] = value;
  }
  if (computed?.fontFamily) style.fontFamily = computed.fontFamily;
  if (computed?.color) style.color = computed.color;
  return style;
}

export function useMenuTheme(content: HTMLElement | null, trigger: HTMLElement | null, container: HTMLElement | null | undefined, style?: CSSProperties) {
  useLayoutEffect(() => {
    if (!content || !trigger || container !== trigger.ownerDocument.body) return;
    const view = trigger.ownerDocument.defaultView;
    if (!view) return;
    const updateTheme = () => {
      const resolved = menuThemeStyle(trigger, container);
      for (const token of THEME_TOKENS) {
        if (!(token in (style ?? {}))) content.style.setProperty(token, (resolved as Record<string, string>)[token] ?? '');
      }
      if (style?.font === undefined && style?.fontFamily === undefined) content.style.fontFamily = resolved.fontFamily ?? '';
      if (style?.color === undefined) content.style.color = resolved.color ?? '';
    };
    updateTheme();
    const observer = new view.MutationObserver(updateTheme);
    for (let scope: HTMLElement | null = trigger; scope; scope = scope.parentElement) {
      observer.observe(scope, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    }
    const scheme = view.matchMedia?.('(prefers-color-scheme: dark)');
    scheme?.addEventListener('change', updateTheme);
    return () => { observer.disconnect(); scheme?.removeEventListener('change', updateTheme); };
  }, [content, trigger, container, style]);
}
