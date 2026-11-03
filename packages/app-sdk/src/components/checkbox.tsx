// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { forwardRef, useState } from 'react';
import * as Primitive from '@radix-ui/react-checkbox';
import { ensureUiStyles } from './ui-styles';
import { Icon } from './icon';

export type CheckedState = boolean | 'indeterminate';

export type CheckboxProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.Root>, 'checked' | 'defaultChecked' | 'onCheckedChange' | 'asChild' | 'children' | 'type'> & {
  checked?: CheckedState;
  defaultChecked?: CheckedState;
  onCheckedChange?: (checked: CheckedState) => void;
  /** Compatibility consumers can keep their current checkbox skin. */
  unstyled?: boolean;
};

/** A checkable button. Callers own the label, checked state and submit policy. */
export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox({ checked, defaultChecked, onCheckedChange, unstyled, className, ...props }, forwardedRef) {
  const controlled = checked !== undefined;
  const [uncontrolled, setUncontrolled] = useState<CheckedState>(defaultChecked ?? false);
  const displayed = controlled ? checked : uncontrolled;
  // Root fixes type="button". Dropping these keeps that control semantic if a caller spreads button props.
  const controlProps = { ...props } as typeof props & { type?: React.ComponentPropsWithoutRef<'button'>['type']; asChild?: boolean };
  delete controlProps.type;
  delete controlProps.asChild;
  return <Primitive.Root {...controlProps} checked={displayed}
    onCheckedChange={next => { if (!controlled) setUncontrolled(next); onCheckedChange?.(next); }}
    className={['pero-ui-checkbox', className].filter(Boolean).join(' ')} data-unstyled={unstyled || undefined}
    ref={node => {
      if (node) ensureUiStyles(node.ownerDocument);
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }}>
    <Primitive.Indicator className="pero-ui-checkbox-indicator" aria-hidden="true"><Icon name={displayed === 'indeterminate' ? 'minus' : 'check'} size={14} /></Primitive.Indicator>
  </Primitive.Root>;
});
