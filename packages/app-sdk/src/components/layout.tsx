import React from 'react';
import { useHostColumnHeader } from '../host';
export { Toolbar, type ToolbarProps } from './toolbar';

function present(node: React.ReactNode) {
  return node != null && node !== false && node !== '';
}

export type AppBarProps = Omit<React.HTMLAttributes<HTMLElement>, 'title'> & {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  tools?: React.ReactNode;
  actions?: React.ReactNode;
  /** Leading scope: in-page tabs or selects. Not a page heading. */
  scope?: React.ReactNode;
  /** Icon utilities such as refresh. Each control needs an accessible name. */
  utilities?: React.ReactNode;
  /** Overflow menu first, then ghost text commands. */
  commands?: React.ReactNode;
  /** The single filled primary at the trailing edge. */
  primary?: React.ReactNode;
  /** This bar repeats `contributes.columnHeader` actions. The host column header is the owner, so it is not painted. */
  columnHeader?: boolean;
};

/** Secondary action bar: scope, then utilities, commands, and one primary.
 * `tools` and `actions` stay for callers that have not moved onto those slots.
 * `title` is a context label, not a second page heading. */
export function AppBar({ title, subtitle, tools, actions, scope, utilities, commands, primary, columnHeader = false, className = '', ...props }: AppBarProps) {
  const hostOwnsColumnHeader = useHostColumnHeader();
  if (columnHeader && hostOwnsColumnHeader) return null;
  const named = present(title);
  const caption = present(subtitle);
  const leading = present(scope) || present(tools) || named || caption;
  const trailing = present(utilities) || present(commands) || present(actions) || present(primary);
  return <header {...props} className={`pero-app-bar ${className}`}>
    {leading && <div className="pero-app-bar-tools">
      {present(scope) && <div className="pero-app-bar-scope" data-slot="scope">{scope}</div>}
      {tools}
      {(named || caption) && <div className="pero-app-bar-title" data-slot="title">{named && <span className="pero-app-bar-context">{title}</span>}{caption && <p>{subtitle}</p>}</div>}
    </div>}
    {trailing && <div className="pero-app-bar-actions">
      {present(utilities) && <div className="pero-app-bar-utilities" data-slot="utilities">{utilities}</div>}
      {present(commands) && <div className="pero-app-bar-commands" data-slot="commands">{commands}</div>}
      {actions}
      {present(primary) && <div className="pero-app-bar-primary" data-slot="primary">{primary}</div>}
    </div>}
  </header>;
}

/** The App shell. `label` is the accessible name; render it only when the tab does not already show that screen. */
export function AppFrame({ label, title, subtitle, tools, actions, scope, utilities, commands, primary, columnHeader, children, className = '', ...props }: AppBarProps & { label: string; children?: React.ReactNode }) {
  const bar = present(title) || present(subtitle) || present(tools) || present(actions) || present(scope) || present(utilities) || present(commands) || present(primary);
  return <main {...props} aria-label={label} className={`pero-app ${className}`}>
    {bar ? <AppBar columnHeader={columnHeader} title={title} subtitle={subtitle} tools={tools} actions={actions} scope={scope} utilities={utilities} commands={commands} primary={primary} /> : null}
    {children}
  </main>;
}

/** A titled screen inside an App. Same bar as `AppFrame`; the title is the screen, not the App. */
export function PageHeader({ title, subtitle, navigation, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; navigation?: React.ReactNode; actions?: React.ReactNode }) {
  return <AppBar className="pero-ui-page-header" title={title} subtitle={subtitle} tools={navigation} actions={actions} />;
}
