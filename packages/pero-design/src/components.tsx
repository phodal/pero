import React from 'react';

type RowClick = { onClick?(event: React.MouseEvent<HTMLButtonElement>): void; disabled?: boolean };

/** Nav row: 18px lead, label, optional count. `sub` is 26px / caption with an extra indent. */
export function SidebarRow({ label, count, lead, level = 'nav', selected, className = '', ...props }: RowClick & React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: React.ReactNode; count?: React.ReactNode; lead?: React.ReactNode; level?: 'nav' | 'sub'; selected?: boolean;
}) {
  return <button {...props} type="button" data-level={level} aria-current={selected ? 'page' : undefined} className={`pero-sidebar-row ${className}`}>
    <span className="pero-lead">{lead}</span>
    <span className="pero-sidebar-label">{label}</span>
    {count != null && count !== '' && <Badge>{count}</Badge>}
  </button>;
}

/** Column or page title, label subtitle, actions on the end. */
export function LibraryHeader({ title, subtitle, actions, navigation, className = '', ...props }: Omit<React.HTMLAttributes<HTMLElement>, 'title'> & {
  title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; navigation?: React.ReactNode;
}) {
  return <header {...props} className={`pero-library-header ${className}`}>
    {navigation}
    <div className="pero-library-heading"><h1>{title}</h1>{subtitle != null && subtitle !== '' && <p>{subtitle}</p>}</div>
    {actions && <div className="pero-library-actions">{actions}</div>}
  </header>;
}

/** Single-line title plus a caption meta line. Trailing actions stay outside the title button. */
export function ListRow({ title, meta, icon, badge, time, trailing, current, className = '', onOpen }: {
  title: React.ReactNode; meta?: React.ReactNode; icon?: React.ReactNode; badge?: React.ReactNode; time?: React.ReactNode;
  trailing?: React.ReactNode; current?: boolean; className?: string; onOpen?(): void;
}) {
  return <div className={`pero-list-row ${className}`} data-current={current ? 'true' : undefined}>
    <button type="button" className="pero-list-open" onClick={onOpen}>
      <span className="pero-list-title">{title}</span>
      {(meta != null || icon || badge || time) && <span className="pero-list-meta">{icon}{badge}<span>{meta}</span>{time != null && <time>{time}</time>}</span>}
    </button>
    {trailing}
  </div>;
}

/** Header on the chrome surface, body on the reading surface, column centered at 720px. */
export function ReaderFrame({ header, children, className = '', ...props }: React.HTMLAttributes<HTMLElement> & { header: React.ReactNode }) {
  return <article {...props} className={`pero-reader ${className}`}>
    <header className="pero-reader-header">{header}</header>
    <div className="pero-reader-body"><div className="pero-reader-content">{children}</div></div>
  </article>;
}

export function Badge({ children, className = '', ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={`pero-badge ${className}`}>{children}</span>;
}
export function OutlineBadge({ children, className = '', ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={`pero-badge pero-badge-outline ${className}`}>{children}</span>;
}
export function Kbd({ children, className = '', ...props }: React.HTMLAttributes<HTMLElement>) {
  return <kbd {...props} className={`pero-kbd ${className}`}>{children}</kbd>;
}

/** State sentence and one caption. No dashed frame. */
export function EmptyState({ heading, description }: { heading: string; description?: string }) {
  return <div className="pero-ui-empty"><strong>{heading}</strong>{description ? <p>{description}</p> : null}</div>;
}

/** One reading-surface panel. Rows inside are separated by a hairline. */
export function SettingsGroup({ label, children, className = '', ...props }: React.HTMLAttributes<HTMLElement> & { label?: React.ReactNode }) {
  return <section {...props} className={`pero-settings ${className}`}>
    {label != null && label !== '' && <h2 className="pero-settings-label">{label}</h2>}
    <div className="pero-settings-panel">{children}</div>
  </section>;
}
export function SettingsRow({ children, className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`pero-settings-row ${className}`}>{children}</div>;
}

/** Primary action, or a ghost control. One primary; the rest stay ghost. */
export function ActionButton({ label, kind = 'primary', className = '', children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: React.ReactNode; kind?: 'primary' | 'ghost';
}) {
  return <button {...props} type="button" data-kind={kind} className={`pero-action ${className}`}>{children ?? label}</button>;
}

export function SearchField({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} type="search" className={`pero-search-field ${className}`} />;
}

/** Session markdown. Headings, lists, code, quotes, and tables use the chat contract. */
export function ChatMarkdown({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`pero-chat ${className}`} />;
}

/** The workbench chat field: one border, focus changes that border, actions sit on the toolbar. */
export function Composer({
  id, label, value, placeholder, disabled, maxLength, rows = 2, onChange, onKeyDown, attachments, toolbar, submit, className = '',
}: {
  id: string; label: string; value: string; placeholder?: string; disabled?: boolean; maxLength?: number; rows?: number;
  onChange(value: string): void; onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  attachments?: React.ReactNode; toolbar?: React.ReactNode; submit?: React.ReactNode; className?: string;
}) {
  return <div className={`pero-composer ${className}`} role="group" aria-label={label}>
    {attachments && <div className="pero-composer-attachments">{attachments}</div>}
    <div className="pero-composer-field">
      <label className="pero-visually-hidden" htmlFor={id}>{label}</label>
      <textarea id={id} className="pero-composer-input" rows={rows} value={value} placeholder={placeholder} disabled={disabled} maxLength={maxLength} onChange={event => onChange(event.target.value)} onKeyDown={onKeyDown}/>
      {(toolbar || submit) && <div className="pero-composer-bar">{toolbar}<span className="pero-composer-spacer"/>{submit}</div>}
    </div>
  </div>;
}
