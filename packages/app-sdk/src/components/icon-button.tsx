// Adapted from Point App SDK d95f9118e (Apache-2.0).
import React, { forwardRef } from 'react';
import { Button, type ButtonProps } from './button';

export type IconButtonProps = Omit<ButtonProps, 'asChild' | 'aria-label' | 'children'> & {
  /** Accessible name. Children are the icon, not the visible label. */
  label: string;
  children: React.ReactNode;
};

/** Always a <button>. Busy and disabled behavior stay on Button; asChild is not available. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, children, variant = 'ghost', className, ...props }, ref) {
  return <Button {...props} asChild={false} variant={variant} aria-label={label}
    className={['pero-ui-icon-button', className].filter(Boolean).join(' ')}
    ref={ref as React.Ref<HTMLElement>}>{children}</Button>;
});
