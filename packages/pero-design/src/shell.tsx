import React from 'react';

/** One native-height bar. The active content supplies its own title. */
export function WindowTitlebar({ leading, tabs, actions, className = '', ...props }: React.HTMLAttributes<HTMLElement> & {
  leading: React.ReactNode; tabs?: React.ReactNode; actions: React.ReactNode;
}) {
  return <header {...props} className={`pero-window-titlebar ${className}`}>
    <div className="pero-window-leading">{leading}</div>
    <div className="pero-window-tabs">{tabs}</div>
    <div className="pero-window-actions">{actions}</div>
  </header>;
}

/** Host owns width/resizing; groups own their contents, never a second panel. */
export function Sidebar({ label, collapsed = false, children, className = '', ...props }: React.HTMLAttributes<HTMLElement> & {
  label: string; collapsed?: boolean;
}) {
  return <nav {...props} aria-label={label} data-collapsed={collapsed || undefined} className={`pero-sidebar ${className}`}>{children}</nav>;
}

/** Labels are optional. Use one only when spacing cannot explain the grouping. */
export function SidebarGroup({ label, separated = false, children, className = '', ...props }: React.HTMLAttributes<HTMLDivElement> & { label?: string; separated?: boolean }) {
  return <div role={label ? 'group' : undefined} aria-label={label} {...props} data-separated={separated || undefined} className={`pero-sidebar-group ${className}`}>
    {label && <div className="pero-sidebar-group-label">{label}</div>}{children}
  </div>;
}
