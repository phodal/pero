// Adapted from Point App SDK d95f9118e (Apache-2.0).
import React, { forwardRef } from 'react';
import { ensureUiStyles } from './ui-styles';

export type EmptyStateProps = React.HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'p' | 'section';
  unstyled?: boolean;
  icon?: React.ReactNode;
  heading?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
};

function slotProvided(node: React.ReactNode): boolean {
  return node != null && node !== false;
}

/** Layout shell only. Callers own copy, semantics, and actions. */
export const EmptyState = forwardRef<HTMLElement, EmptyStateProps>(function EmptyState({
  as = 'div',
  unstyled,
  className,
  icon,
  heading,
  description,
  actions,
  children,
  ...props
}, ref) {
  if (as === 'p' && [icon, heading, description, actions].some(slotProvided)) {
    throw new Error('EmptyState slots are not supported when as="p"; pass content as children so a paragraph does not nest block wrappers.');
  }
  const Tag = as;
  return (
    <Tag
      {...props}
      className={['pero-ui-empty-state', className].filter(Boolean).join(' ')}
      data-unstyled={unstyled || undefined}
      ref={node => {
        if (node) ensureUiStyles(node.ownerDocument);
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
    >
      {slotProvided(icon) ? <span className="pero-ui-empty-icon" aria-hidden="true">{icon}</span> : null}
      {slotProvided(heading) ? <div className="pero-ui-empty-heading">{heading}</div> : null}
      {slotProvided(description) ? <div className="pero-ui-empty-description">{description}</div> : null}
      {children}
      {slotProvided(actions) ? <div className="pero-ui-empty-actions">{actions}</div> : null}
    </Tag>
  );
});
