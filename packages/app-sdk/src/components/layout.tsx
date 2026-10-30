// Toolbar adapted from Point App SDK components/toolbar.tsx.
import React, { forwardRef } from 'react';
import { LibraryHeader } from '../../../pero-design/src/components';

export type ToolbarProps = React.ComponentPropsWithoutRef<'div'> & { actions?: React.ReactNode };

/** A wrapping layout row; callers own controls and translated group labels. */
export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(function Toolbar({ actions, className = '', children, ...props }, ref) {
  return <div {...props} className={`pero-ui-toolbar ${className}`} ref={ref}>{children}
    {actions && <div className="pero-ui-toolbar-actions">{actions}</div>}
  </div>;
});

export function PageHeader({ title, subtitle, navigation, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; navigation?: React.ReactNode; actions?: React.ReactNode }) {
  return <LibraryHeader className="pero-ui-page-header" title={title} subtitle={subtitle} navigation={navigation} actions={actions && <Toolbar>{actions}</Toolbar>}/>;
}
