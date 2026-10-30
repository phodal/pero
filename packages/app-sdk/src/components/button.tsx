// Adapted from Point App SDK components/button.tsx.
import React, { forwardRef } from 'react';

export type ButtonProps = React.ComponentPropsWithoutRef<'button'> & {
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
};

/** Callers own execution, translated content and busy state. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ busy, disabled, variant = 'secondary', className = '', type = 'button', ...props }, ref) {
  return <button {...props} type={type} className={`pero-ui-button ${variant} ${className}`}
    disabled={disabled || busy} aria-busy={busy || props['aria-busy']} ref={ref}/>;
});
