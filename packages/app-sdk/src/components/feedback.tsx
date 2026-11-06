// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { forwardRef } from 'react';
import { ensureUiStyles } from './ui-styles';

export type FeedbackProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'role'> & {
  kind?: 'error' | 'warning' | 'success' | 'info' | 'status' | 'empty';
  /** Inline beside a field; a tinted block for page-level feedback. */
  variant?: 'inline' | 'block';
  unstyled?: boolean;
};

/** Features provide the message; only actionable errors use an assertive role. */
export const Feedback = forwardRef<HTMLDivElement, FeedbackProps>(function Feedback({ kind = 'status', variant = 'inline', unstyled, className, ...props }, ref) {
  return <div {...props} role={kind === 'error' ? 'alert' : kind === 'empty' ? undefined : 'status'}
    className={['pero-ui-feedback', className].filter(Boolean).join(' ')} data-kind={kind} data-variant={variant} data-unstyled={unstyled || undefined}
    ref={node => {
      if (node) ensureUiStyles(node.ownerDocument);
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }} />;
});
