// Toolbar adapted from Point App SDK components/toolbar.tsx.
import React, { forwardRef } from 'react';

export type ToolbarProps = React.ComponentPropsWithoutRef<'div'> & { actions?: React.ReactNode };

/** A wrapping layout row; callers own controls and translated group labels. */
export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(function Toolbar({ actions, className = '', children, ...props }, ref) {
  return <div {...props} className={`pero-ui-toolbar ${className}`} ref={ref}>{children}
    {actions && <div className="pero-ui-toolbar-actions">{actions}</div>}
  </div>;
});

export function PageHeader({ title, navigation, actions }: { title: React.ReactNode; navigation?: React.ReactNode; actions?: React.ReactNode }) {
  return <header className="pero-ui-page-header">{navigation}<h1>{title}</h1>{actions && <Toolbar>{actions}</Toolbar>}</header>;
}
