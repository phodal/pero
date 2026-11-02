// Adapted from Point App SDK d95f9118e (Apache-2.0).
import React, { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { ensureUiStyles } from './ui-styles';

export type ButtonProps = React.ComponentPropsWithoutRef<'button'> & {
  asChild?: boolean;
  busy?: boolean;
  variant?: 'secondary' | 'primary' | 'danger' | 'ghost' | 'unstyled';
};

/** A leaf control: callers own execution, translated content and busy state. */
export const Button = forwardRef<HTMLElement, ButtonProps>(function Button({ asChild, busy, disabled, variant = 'secondary', className, type, onClick, ...props }, forwardedRef) {
  const blocked = disabled || busy;
  const Control = asChild ? Slot : 'button';
  // Slot composes child handlers first. Suppress the child's action as well
  // when disabled/busy, including links which have no native disabled state.
  const children = asChild && blocked && React.isValidElement(props.children)
    ? React.cloneElement(props.children as React.ReactElement<{ onClick?: React.MouseEventHandler }>, {
      onClick: event => { event.preventDefault(); event.stopPropagation(); },
    }) : props.children;
  return <Control {...props} type={asChild ? type : type ?? 'button'} className={['pero-ui-button', className].filter(Boolean).join(' ')} data-variant={variant}
    disabled={blocked} aria-disabled={blocked || props['aria-disabled']} aria-busy={busy || props['aria-busy']}
    ref={node => {
      if (node) ensureUiStyles(node.ownerDocument);
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }}
    onClick={event => { if (blocked) { event.preventDefault(); event.stopPropagation(); return; } onClick?.(event); }}>{children}</Control>;
});
