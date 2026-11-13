import {applyHostStyleVariables, type McpUiHostContext, type McpUiStyleVariableKey, type McpUiStyles}
  from '@modelcontextprotocol/ext-apps';

// Purpose-equivalent roles only. Action/selection colours remain in the existing
// design system because MCP's inverse roles do not describe those interactions.
const themeTokens = {
  '--color-background-primary': '--pero-surface',
  '--color-background-secondary': '--pero-surface-muted',
  '--color-background-info': '--pero-info-bg',
  '--color-background-danger': '--pero-error-bg',
  '--color-background-success': '--pero-success-bg',
  '--color-background-warning': '--pero-warning-bg',
  '--color-background-disabled': '--pero-disabled',
  '--color-text-primary': '--pero-text',
  '--color-text-secondary': '--pero-text-muted',
  '--color-text-info': '--pero-info',
  '--color-text-danger': '--pero-error',
  '--color-text-success': '--pero-success',
  '--color-text-warning': '--pero-warning',
  '--color-text-disabled': '--pero-disabled-text',
  '--color-border-primary': '--pero-input-border',
  '--color-border-secondary': '--pero-border',
  '--color-ring-primary': '--pero-focus',
  '--font-sans': '--pero-font-family-sans',
  '--font-mono': '--pero-font-family-mono',
  '--font-weight-normal': '--pero-font-weight-regular',
  '--font-weight-medium': '--pero-font-weight-medium',
  '--font-weight-semibold': '--pero-font-weight-semibold',
  '--font-weight-bold': '--pero-font-weight-bold',
  '--font-text-sm-size': '--pero-font-caption',
  '--font-text-md-size': '--pero-font-body',
  '--font-heading-md-size': '--pero-font-heading',
  '--font-heading-lg-size': '--pero-font-title',
  '--border-radius-xs': '--pero-radius-xs',
  '--border-radius-sm': '--pero-radius-sm',
  '--border-radius-md': '--pero-radius-md',
  '--border-radius-lg': '--pero-radius-lg',
  '--border-radius-xl': '--pero-radius-xl',
  '--border-radius-full': '--pero-radius-full',
  '--border-width-regular': '--pero-border-width-thin',
  '--shadow-sm': '--pero-elevation-sm',
  '--shadow-md': '--pero-elevation-md',
  '--shadow-lg': '--pero-elevation-lg',
} as const satisfies Partial<Record<McpUiStyleVariableKey, string>>;

/** Project the Host's actual shared tokens into the standard MCP style contract. */
export function mcpAppHostContext(context: McpUiHostContext,
  element: HTMLElement = document.documentElement): McpUiHostContext {
  const computed = element.ownerDocument.defaultView!.getComputedStyle(element);
  const variables: Partial<McpUiStyles> = {};
  for (const [standard, token] of Object.entries(themeTokens)) {
    const value = computed.getPropertyValue(token).trim();
    if (value) variables[standard as McpUiStyleVariableKey] = value;
  }
  for (const [name, value] of Object.entries(context.styles?.variables ?? {})) {
    if (value !== undefined) variables[name as McpUiStyleVariableKey] = value;
  }
  return {...context, styles: {...context.styles, variables: variables as McpUiStyles}};
}

/** Apply a standard partial Host context to existing controls in this View. */
export function applyMcpAppTheme(context: McpUiHostContext, doc: Document = document): void {
  const root = doc.documentElement;
  if (context.theme !== undefined) {
    root.dataset.theme = context.theme;
    root.dataset.colorScheme = context.theme;
    root.style.colorScheme = context.theme;
  }
  if (context.locale !== undefined) root.lang = context.locale;
  if (context.styles?.variables) {
    applyHostStyleVariables(context.styles.variables, root);
    for (const [standard, token] of Object.entries(themeTokens)) {
      const value = context.styles.variables[standard as McpUiStyleVariableKey];
      if (value !== undefined) root.style.setProperty(token, value);
    }
  }
  if (context.styles?.css?.fonts !== undefined) {
    // The official fonts helper targets global document. This adapter is also
    // used with an explicit View document, so bind its one style to that owner.
    let fonts = doc.head.querySelector<HTMLStyleElement>('style[data-mcp-app-fonts]');
    if (!fonts) {
      fonts = doc.createElement('style');
      fonts.dataset.mcpAppFonts = '';
      doc.head.append(fonts);
    }
    fonts.textContent = context.styles.css.fonts;
  }
}
