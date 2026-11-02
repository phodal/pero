// Adapted from Point App SDK d95f9118e (Apache-2.0).
import React, { forwardRef } from 'react';
import { ensureUiStyles } from './ui-styles';

export type FeedbackProps = Omit<React.ComponentPropsWithoutRef<'p'>, 'role'> & {
  kind?: 'error' | 'status' | 'empty';
  unstyled?: boolean;
};

/** Features provide the message; only actionable errors use an assertive role. */
export const Feedback = forwardRef<HTMLParagraphElement, FeedbackProps>(function Feedback({ kind = 'status', unstyled, className, ...props }, ref) {
  return <p {...props} role={kind === 'error' ? 'alert' : kind === 'status' ? 'status' : undefined}
    className={['pero-ui-feedback', className].filter(Boolean).join(' ')} data-kind={kind} data-unstyled={unstyled || undefined}
    ref={node => {
      if (node) ensureUiStyles(node.ownerDocument);
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }} />;
});
