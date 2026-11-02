// Adapted from Point App SDK d95f9118e (Apache-2.0).
import React, { forwardRef, useState } from 'react';
import * as Primitive from '@radix-ui/react-tabs';
import { ensureUiStyles } from './ui-styles';

const SelectionContext = React.createContext<string | undefined>(undefined);

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

export type TabsProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.Root>, 'asChild'> & {
  /** Compatibility consumers can keep their current tab skin. */
  unstyled?: boolean;
};

/** Radix tabs root. Value, activation, orientation and direction stay on the primitive. */
export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs({ unstyled, className, value, defaultValue, onValueChange, ...props }, forwardedRef) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? '');
  const selected = value !== undefined ? value : uncontrolled;
  return <SelectionContext.Provider value={selected}>
    <Primitive.Root {...props} asChild={false} value={selected} onValueChange={next => { if (value === undefined) setUncontrolled(next); onValueChange?.(next); }}
      className={classes('pero-ui-tabs', className)} data-unstyled={unstyled || undefined} ref={useUiRef(forwardedRef)} />
  </SelectionContext.Provider>;
});

export type TabsListProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.List>, 'asChild'> & {
  unstyled?: boolean;
};

export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(function TabsList({ unstyled, className, ...props }, forwardedRef) {
  return <Primitive.List {...props} asChild={false} className={classes('pero-ui-tabs-list', className)} data-unstyled={unstyled || undefined} ref={useUiRef(forwardedRef)} />;
});

export type TabsTriggerProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.Trigger>, 'asChild' | 'type' | 'id' | 'aria-controls'> & {
  unstyled?: boolean;
};

/** Trigger id and aria-controls stay on Radix so the panel association is the one Radix renders. */
export const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(function TabsTrigger({ unstyled, className, ...props }, forwardedRef) {
  return <Primitive.Trigger {...props} asChild={false} type="button" className={classes('pero-ui-tabs-trigger', className)} data-unstyled={unstyled || undefined} ref={useUiRef(forwardedRef)} />;
});

export type TabsContentProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.Content>, 'asChild' | 'id' | 'aria-labelledby'> & {
  unstyled?: boolean;
};

/** forceMount keeps inactive content mounted; the hidden attribute keeps it undisplayed. */
export const TabsContent = forwardRef<HTMLDivElement, TabsContentProps>(function TabsContent({ unstyled, className, forceMount, hidden, value, ...props }, forwardedRef) {
  const selected = React.useContext(SelectionContext);
  const isSelected = selected === value;
  return <Primitive.Content {...props} asChild={false} value={value} forceMount={forceMount ? true : undefined} hidden={!!hidden || !isSelected}
    className={classes('pero-ui-tabs-content', className)} data-unstyled={unstyled || undefined} ref={useUiRef(forwardedRef)} />;
});
