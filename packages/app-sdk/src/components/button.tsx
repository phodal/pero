// Adapted from Point App SDK components/button.tsx.
import React, { forwardRef } from 'react';

export type ButtonProps = React.ComponentPropsWithoutRef<'button'> & {
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
};

function iconOnly(children: React.ReactNode) {
  const items = React.Children.toArray(children).filter(child => !(typeof child === 'string' && child.trim() === ''));
  return items.length === 1 && React.isValidElement(items[0]) && typeof items[0].type === 'function';
}

/** Callers own execution, translated content and busy state. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ busy, disabled, variant = 'secondary', className = '', type = 'button', children, ...props }, ref) {
  const icon = variant === 'ghost' && iconOnly(children);
  return <button {...props} type={type} className={['pero-ui-button', variant, icon ? 'pero-icon-button' : '', className].filter(Boolean).join(' ')}
    disabled={disabled || busy} aria-busy={busy || props['aria-busy']} ref={ref}>{children}</button>;
});
