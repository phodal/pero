// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { forwardRef, useState } from 'react';
import * as Primitive from '@radix-ui/react-tabs';
import { ensureUiStyles } from './ui-styles';
import { IconButton } from './icon-button';
import { Icon } from './icon';

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
  variant?: 'page' | 'content' | 'navigation';
  unstyled?: boolean;
};

export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(function TabsList({ unstyled, variant = 'page', className, ...props }, forwardedRef) {
  return <Primitive.List {...props} asChild={false} className={classes('pero-ui-tabs-list', className)} data-variant={variant} data-unstyled={unstyled || undefined} ref={useUiRef(forwardedRef)} />;
});

export type TabsTriggerProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.Trigger>, 'asChild' | 'type' | 'id' | 'aria-controls'> & {
  unstyled?: boolean;
};

/** Trigger id and aria-controls stay on Radix so the panel association is the one Radix renders. */
export const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(function TabsTrigger({ unstyled, className, onPointerDown, onKeyDown, onBlur, ...props }, forwardedRef) {
  // WebKit can retain :focus-visible after Radix focuses a pointer-selected tab.
  // Keep the ring for keyboard navigation, independently of the selected state.
  const [pointerFocus, setPointerFocus] = useState(false);
  return <Primitive.Trigger {...props} data-pointer-focus={pointerFocus || undefined}
    onPointerDown={event => { setPointerFocus(true); onPointerDown?.(event); }}
    onKeyDown={event => { setPointerFocus(false); onKeyDown?.(event); }}
    onBlur={event => { setPointerFocus(false); onBlur?.(event); }} asChild={false} type="button" className={classes('pero-ui-tabs-trigger', className)} data-unstyled={unstyled || undefined} ref={useUiRef(forwardedRef)} />;
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

export type ContentTabProps = Omit<TabsTriggerProps, 'children'> & {
  label: string;
  leading?: React.ReactNode;
  pinned?: boolean;
  preview?: boolean;
  dirty?: boolean;
  /** Localized state description, for example “Preview, unsaved”. */
  stateLabel?: string;
  closeLabel: string;
  /** The workspace owns close confirmation and selection/focus after removal. */
  onClose?: () => void;
};

/** Workspace tabs use the existing roving-focus Tabs primitive. Close is never nested in a button. */
export function ContentTab({ label, leading, pinned, preview, dirty, stateLabel, closeLabel, onClose, onKeyDown, className, ...props }: ContentTabProps) {
  return <div className="pero-content-tab" role="presentation" data-pinned={pinned || undefined}>
    <TabsTrigger {...props} title={props.title ?? label} aria-label={label} aria-description={stateLabel}
      className={['pero-content-tab-title', className].filter(Boolean).join(' ')} data-preview={preview || undefined}
      onKeyDown={event => { onKeyDown?.(event); if (!event.defaultPrevented && event.key === 'Delete' && onClose) { event.preventDefault(); onClose(); } }}>
      {leading && <span aria-hidden="true" className="pero-content-tab-leading">{leading}</span>}
      <span className="pero-content-tab-label">{label}</span>
      {dirty && <span className="pero-content-tab-dirty" aria-hidden="true"/>}
      {pinned && <Icon name="pin" size={16} className="pero-content-tab-pin"/>}
    </TabsTrigger>
    {onClose && <IconButton className="pero-content-tab-close" label={`${closeLabel}: ${label}`} disabled={props.disabled} onClick={onClose}><Icon name="close" size={16}/></IconButton>}
  </div>;
}
