// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { forwardRef } from 'react';
import * as Primitive from '@radix-ui/react-toggle-group';
import { ensureUiStyles } from './ui-styles';
import { useSelectionFocus } from './selection-focus';

function useUiRef<T extends { ownerDocument: Document }>(forwardedRef: React.ForwardedRef<T>) {
  return React.useCallback((node: T | null) => {
    if (node) ensureUiStyles(node.ownerDocument);
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
}

function classes(base: string, className?: string) {
  return [base, className].filter(Boolean).join(' ');
}

type WithoutChild<T> = T extends unknown ? Omit<T, 'asChild'> : never;
export type ToggleGroupProps = WithoutChild<React.ComponentPropsWithoutRef<typeof Primitive.Root>> & {
  /** Compatibility consumers can keep their current filter skin. */
  unstyled?: boolean;
};

/** Exclusive or multi filter buttons. Not Tabs: no panels. Callers own value meaning and labels. */
export const ToggleGroup = forwardRef<HTMLDivElement, ToggleGroupProps>(function ToggleGroup({ unstyled, className, ...props }, forwardedRef) {
  const { asChild: _asChild, ...groupProps } = props as ToggleGroupProps & { asChild?: boolean };
  return <Primitive.Root {...groupProps} className={classes('pero-ui-toggle-group', className)} data-unstyled={unstyled || undefined} ref={useUiRef(forwardedRef)} />;
});

export type ToggleGroupItemProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.Item>, 'asChild'> & {
  unstyled?: boolean;
};

/** One option in a ToggleGroup. Renders a button with checked (single) or pressed (multiple) state; never submits a form. */
export const ToggleGroupItem = forwardRef<HTMLButtonElement, ToggleGroupItemProps>(function ToggleGroupItem({ unstyled, className, onPointerDown, onKeyDown, onBlur, ...props }, forwardedRef) {
  const { asChild: _asChild, ...itemProps } = props as ToggleGroupItemProps & { asChild?: boolean };
  const focus = useSelectionFocus({ onPointerDown, onKeyDown, onBlur });
  return <Primitive.Item {...itemProps} {...focus} className={classes('pero-ui-toggle-item', className)} data-unstyled={unstyled || undefined} ref={useUiRef(forwardedRef)} />;
});
