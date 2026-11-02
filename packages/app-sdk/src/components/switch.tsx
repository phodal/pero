// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { forwardRef } from 'react';
import * as Primitive from '@radix-ui/react-switch';
import { ensureUiStyles } from './ui-styles';

export type SwitchProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.Root>, 'checked' | 'defaultChecked' | 'onCheckedChange' | 'asChild' | 'children'> & {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Compatibility consumers can keep their current switch skin. */
  unstyled?: boolean;
};

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch({ checked, onCheckedChange, unstyled, className, ...props }, forwardedRef) {
  return <Primitive.Root {...props} checked={checked} onCheckedChange={onCheckedChange} className={['pero-ui-switch', className].filter(Boolean).join(' ')} data-unstyled={unstyled || undefined}
    ref={node => {
      if (node) ensureUiStyles(node.ownerDocument);
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }}>
    <Primitive.Thumb className="pero-ui-switch-thumb" aria-hidden="true" />
  </Primitive.Root>;
});
