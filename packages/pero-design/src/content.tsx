import type { ReactNode } from 'react';

/** Shared pane widths. Callers use this preset instead of copying the numbers. */
export const contentLayout = {
  collapseBelow: 860,
  listSize: 336,
  listMin: 280,
  inspectorWidth: 360,
  inspectorMin: 320,
  mainMin: 360,
} as const;

export type ContentInset = 'none' | 'compact' | 'regular';
export type ContentSurface = 'workspace' | 'list' | 'reading';
export type ContentScroll = 'pane' | 'content';

export type ContentPaneProps = {
  id: string;
  label: string;
  as?: 'section' | 'aside' | 'div';
  surface?: ContentSurface;
  inset?: ContentInset;
  scroll?: ContentScroll;
  header?: ReactNode;
  toolbar?: ReactNode;
  feedback?: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  children: ReactNode;
};

export type InspectorHeaderProps = {
  title: string;
  identity?: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  dismiss?: { label: string; onDismiss(): void };
};

export type ContentSectionProps = {
  id: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
};

export type MetadataItem = {
  id: string;
  label: string;
  value: ReactNode;
  format?: 'text' | 'code';
  action?: ReactNode;
};

export type MetadataListProps = {
  items: readonly MetadataItem[];
  layout?: 'auto' | 'stacked';
};

function present(node: ReactNode) {
  return node != null && node !== false && node !== '';
}

function CloseGlyph() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}

/** Pane structure, surface, inset, and which region scrolls. It does not fetch or decide emptiness. */
export function ContentPane({ id, label, as = 'section', surface = 'workspace', inset = 'compact', scroll = 'pane', header, toolbar, feedback, footer, busy = false, children }: ContentPaneProps) {
  const Tag = as;
  return <Tag id={id} aria-label={label} aria-busy={busy ? true : undefined} className="pero-content-pane" data-surface={surface} data-inset={inset} data-scroll={scroll}>
    {present(header) ? <div className="pero-content-header" data-slot="header">{header}</div> : null}
    {present(toolbar) ? <div className="pero-content-toolbar" data-slot="toolbar">{toolbar}</div> : null}
    {present(feedback) ? <div className="pero-content-feedback" data-slot="feedback">{feedback}</div> : null}
    <div className="pero-content-body" data-slot="body">{children}</div>
    {present(footer) ? <div className="pero-content-footer" data-slot="footer">{footer}</div> : null}
  </Tag>;
}

/** Object title, identity, status, and actions. It does not look up the object or persist width. */
export function InspectorHeader({ title, identity, subtitle, status, actions, dismiss }: InspectorHeaderProps) {
  return <div className="pero-inspector-header">
    <div className="pero-inspector-main">
      {present(identity) ? <div className="pero-inspector-identity">{identity}</div> : null}
      <h2 className="pero-inspector-title">{title}</h2>
      {present(subtitle) ? <p className="pero-inspector-subtitle">{subtitle}</p> : null}
      {present(status) ? <div className="pero-inspector-status">{status}</div> : null}
    </div>
    {present(actions) || dismiss ? <div className="pero-inspector-actions">
      {actions}
      {dismiss ? <button type="button" className="pero-inspector-dismiss" aria-label={dismiss.label} onClick={dismiss.onDismiss}><CloseGlyph /></button> : null}
    </div> : null}
  </div>;
}

/** A titled group. It does not decide which business sections exist. */
export function ContentSection({ id, title, actions, children }: ContentSectionProps) {
  const headingId = `${id}-title`;
  return <section className="pero-content-section" id={id} aria-labelledby={headingId}>
    <div className="pero-content-section-head">
      <h3 id={headingId}>{title}</h3>
      {present(actions) ? <div className="pero-content-section-actions">{actions}</div> : null}
    </div>
    {children}
  </section>;
}

/** Label and value rows. It does not infer formats or fetch values. */
export function MetadataList({ items, layout = 'auto' }: MetadataListProps) {
  return <div className="pero-metadata-frame">
    <dl className="pero-metadata" data-layout={layout}>
      {items.map(item => <div className="pero-metadata-item" key={item.id}>
        <dt>{item.label}</dt>
        <dd>{item.format === 'code' ? <code>{item.value}</code> : item.value}</dd>
        <div className="pero-metadata-action">{item.action}</div>
      </div>)}
    </dl>
  </div>;
}
