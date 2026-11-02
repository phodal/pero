// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { forwardRef } from 'react';
import { ensureUiStyles } from './ui-styles';

export type ProgressProps = Omit<React.ComponentPropsWithoutRef<'progress'>, 'children'> & {
  /** Accessible name for the determinate bar. Required. */
  label: string;
  /** Compatibility consumers can keep their current progress skin. */
  unstyled?: boolean;
};

/** Determinate progress. Callers own value/max meaning and when the bar is shown. */
export const Progress = forwardRef<HTMLProgressElement, ProgressProps>(function Progress({ label, unstyled, className, max = 1, ...props }, forwardedRef) {
  return <progress {...props} max={max} aria-label={label} className={['pero-ui-progress', className].filter(Boolean).join(' ')} data-unstyled={unstyled || undefined}
    ref={node => {
      if (node) ensureUiStyles(node.ownerDocument);
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }} />;
});
