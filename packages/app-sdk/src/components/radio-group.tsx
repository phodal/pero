// Adapted from Point App SDK d95f9118e (Apache-2.0).
import React, { forwardRef } from 'react';
import * as Primitive from '@radix-ui/react-radio-group';
import { ensureUiStyles } from './ui-styles';
import { Icon } from './icon';

export type RadioGroupProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.Root>, 'asChild'> & {
  /** Compatibility consumers can keep their current group skin. */
  unstyled?: boolean;
};

export type RadioGroupItemProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.Item>, 'asChild' | 'type'> & {
  /** Compatibility consumers can keep their current item skin. */
  unstyled?: boolean;
};

/** One choice among several. Callers own the value, translated names and what the choice means. */
export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(function RadioGroup({ unstyled, className, orientation, dir, loop = true, onKeyDownCapture, onClickCapture, ...props }, forwardedRef) {
  const moving = React.useRef<{ item: HTMLButtonElement; clicked: boolean } | null>(null);
  const { asChild: _asChild, ...groupProps } = props as RadioGroupProps & { asChild?: boolean };
  return <Primitive.Root {...groupProps} orientation={orientation} dir={dir} loop={loop}
    onClickCapture={event => {
      if (moving.current?.item === event.target) moving.current.clicked = true;
      onClickCapture?.(event);
    }}
    onKeyDownCapture={event => {
      onKeyDownCapture?.(event);
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
      if ((!horizontal && !vertical) || (orientation === 'horizontal' && vertical) || (orientation === 'vertical' && horizontal)) return;
      const group = event.currentTarget;
      const items = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
        .filter(item => item.closest('[role="radiogroup"]') === group && !item.disabled && item.getAttribute('aria-disabled') !== 'true');
      const current = items.indexOf(event.target as HTMLButtonElement);
      if (current < 0) return;
      const rtl = (dir ?? group.ownerDocument.defaultView?.getComputedStyle(group).direction) === 'rtl';
      const forward = horizontal ? (event.key === 'ArrowRight') !== rtl : event.key === 'ArrowDown';
      let next = current + (forward ? 1 : -1);
      if (loop) next = (next + items.length) % items.length;
      // Radix roving focus is deferred. A fast keyup can clear its arrow flag
      // before focus moves, leaving focus and selection on different items.
      // Own only arrow navigation: focus and check synchronously via Radix.
      event.preventDefault();
      event.stopPropagation();
      if (next < 0 || next >= items.length) return;
      const movement = { item: items[next], clicked: false };
      moving.current = movement;
      try {
        movement.item.focus();
        // A previous arrow can still have armed Radix's focus-click flag.
        // Preserve that click rather than emitting a second controlled intent.
        if (!movement.clicked) movement.item.click();
      } finally {
        moving.current = null;
      }
    }} className={['pero-ui-radio-group', className].filter(Boolean).join(' ')} data-unstyled={unstyled || undefined}
    ref={node => {
      if (node) ensureUiStyles(node.ownerDocument);
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }} />;
});

/** Radix keeps this a button. Custom children replace the decorative dot, as Pulse cards do. */
export const RadioGroupItem = forwardRef<HTMLButtonElement, RadioGroupItemProps>(function RadioGroupItem({ unstyled, className, children, ...props }, forwardedRef) {
  const { asChild: _asChild, type: _type, ...itemProps } = props as RadioGroupItemProps & { asChild?: boolean; type?: string };
  return <Primitive.Item {...itemProps} className={['pero-ui-radio-item', className].filter(Boolean).join(' ')} data-unstyled={unstyled || undefined}
    ref={node => {
      if (node) ensureUiStyles(node.ownerDocument);
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }}>
    {children ?? <Primitive.Indicator className="pero-ui-radio-indicator" aria-hidden="true"><Icon name="dot" size={16} /></Primitive.Indicator>}
  </Primitive.Item>;
});
