// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { ensureUiStyles } from './ui-styles';

export type ToolbarProps = React.ComponentPropsWithoutRef<'div'> & {
  asChild?: boolean;
  unstyled?: boolean;
  actions?: React.ReactNode;
};

/**
 * Layout row. Callers own controls, search, filter state, and any translated group label.
 * No default role and no roving focus. asChild merges onto exactly one native child.
 * actions with asChild is rejected: Slot cannot take a second child, so place actions inside that child.
 */
export const Toolbar = forwardRef<HTMLElement, ToolbarProps>(function Toolbar({ asChild, unstyled, actions, className, children, ...props }, ref) {
  const hasActions = actions != null && actions !== false;
  if (asChild && hasActions) {
    throw new Error('Toolbar: actions cannot be used with asChild; include them inside the single child.');
  }
  const Surface = asChild ? Slot : 'div';
  const content = asChild ? children : <>{children}{hasActions ? <div className="pero-ui-toolbar-actions" data-unstyled={unstyled || undefined}>{actions}</div> : null}</>;
  return <Surface {...props} className={['pero-ui-toolbar', className].filter(Boolean).join(' ')} data-unstyled={unstyled || undefined}
    ref={node => {
      if (node) ensureUiStyles(node.ownerDocument);
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }}>
    {content}
  </Surface>;
});
