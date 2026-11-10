import React from 'react';
import { useHostColumnHeader } from '../host';
export { Toolbar, type ToolbarProps } from './toolbar';

export type AppBarProps = Omit<React.HTMLAttributes<HTMLElement>, 'title'> & {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  tools?: React.ReactNode;
  actions?: React.ReactNode;
  /** This bar repeats `contributes.columnHeader` actions. The host column header is the owner, so it is not painted. */
  columnHeader?: boolean;
};

/** One compact workbench row. The tab already names the App, so this row does not repeat it. */
export function AppBar({ title, subtitle, tools, actions, columnHeader = false, className = '', ...props }: AppBarProps) {
  const hostOwnsColumnHeader = useHostColumnHeader();
  if (columnHeader && hostOwnsColumnHeader) return null;
  const named = title != null && title !== '';
  const caption = subtitle != null && subtitle !== '';
  return <header {...props} className={`pero-app-bar ${className}`}>
    {(tools || named || caption) && <div className="pero-app-bar-tools">
      {tools}
      {(named || caption) && <div className="pero-app-bar-title">{named && <h1>{title}</h1>}{caption && <p>{subtitle}</p>}</div>}
    </div>}
    {actions && <div className="pero-app-bar-actions">{actions}</div>}
  </header>;
}

/** The App shell. `label` is the accessible name; render it only when the tab does not already show that screen. */
export function AppFrame({ label, title, subtitle, tools, actions, columnHeader, children, className = '', ...props }: AppBarProps & { label: string; children?: React.ReactNode }) {
  const bar = (title != null && title !== '') || (subtitle != null && subtitle !== '') || tools || actions;
  return <main {...props} aria-label={label} className={`pero-app ${className}`}>
    {bar ? <AppBar columnHeader={columnHeader} title={title} subtitle={subtitle} tools={tools} actions={actions} /> : null}
    {children}
  </main>;
}

/** A titled screen inside an App. Same bar as `AppFrame`; the title is the screen, not the App. */
export function PageHeader({ title, subtitle, navigation, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; navigation?: React.ReactNode; actions?: React.ReactNode }) {
  return <AppBar className="pero-ui-page-header" title={title} subtitle={subtitle} tools={navigation} actions={actions} />;
}
