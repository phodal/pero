// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { forwardRef, useCallback, useContext, useMemo, useRef, useState } from 'react';
import * as Primitive from '@radix-ui/react-context-menu';
import { ensureUiStyles } from './ui-styles';
import { Icon } from './icon';
import { menuThemeStyle, useMenuTheme } from './menu-theme';
import { resolvePopupContainer, topLayerDialog } from './popup-container';

type AnchorValue = {
  trigger: HTMLElement | null;
  setTrigger: (node: HTMLElement | null) => void;
  close: () => void;
  tabDirection: React.MutableRefObject<number>;
};

const AnchorContext = React.createContext<AnchorValue | null>(null);

function classes(base: string, className?: string) {
  return [base, className].filter(Boolean).join(' ');
}

function useStableRef<T extends { ownerDocument: Document }>(forwardedRef: React.ForwardedRef<T>) {
  return useCallback((node: T | null) => {
    if (node) ensureUiStyles(node.ownerDocument);
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
}

function focusedOpenDialog(doc: Document) {
  const active = doc.activeElement;
  const dialog = active?.closest('dialog[open]');
  if (dialog) return dialog;
  const top = topLayerDialog(doc);
  return top && top.contains(active) ? top : null;
}

function continueTab(trigger: HTMLElement, direction: number) {
  const scope = trigger.closest('dialog[open]') ?? trigger.ownerDocument;
  const view = trigger.ownerDocument.defaultView;
  const visible = new Map<Element, boolean>();
  const candidates = [...scope.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex],[contenteditable=true]')].filter(node => {
    if (node.tabIndex < 0 || node.matches(':disabled') || node.closest('[hidden],[inert],[role=menu]')) return false;
    if (view?.getComputedStyle(node).visibility === 'hidden' || node.closest('details:not([open]) > :not(summary)')) return false;
    for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
      if (!visible.has(ancestor)) visible.set(ancestor, view?.getComputedStyle(ancestor).display !== 'none');
      if (!visible.get(ancestor)) return false;
    }
    return true;
  });
  candidates.sort((left, right) => {
    const a = left.tabIndex || Infinity, b = right.tabIndex || Infinity;
    return a === b ? 0 : a - b;
  });
  const index = candidates.indexOf(trigger);
  const target = candidates[index + direction] ?? (scope.nodeType === 9 ? trigger : candidates[(index + direction + candidates.length) % candidates.length]);
  (target ?? trigger).focus();
}

export type ContextMenuProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.Root>, 'modal'> & {
  /** Radix modal focus trap. Context menus dismiss without locking the page unless a caller opts in. */
  modal?: boolean;
  defaultOpen?: boolean;
};

/** Right-click / context menu root. Pointer position, keyboard and dismiss stay on Radix. */
export function ContextMenu({ open, defaultOpen = false, onOpenChange, modal = false, ...props }: ContextMenuProps) {
  const controlled = open !== undefined;
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const displayed = controlled ? open : uncontrolled;
  const [trigger, setTriggerNode] = useState<HTMLElement | null>(null);
  const setTrigger = useCallback((node: HTMLElement | null) => {
    setTriggerNode(current => current === node ? current : node);
  }, []);
  const tabDirection = useRef(0);
  const changeOpen = useCallback((next: boolean) => { if (!controlled) setUncontrolled(next); onOpenChange?.(next); }, [controlled, onOpenChange]);
  const close = useCallback(() => changeOpen(false), [changeOpen]);
  const anchor = useMemo(() => ({ trigger, setTrigger, close, tabDirection }), [trigger, setTrigger, close]);
  return <AnchorContext.Provider value={anchor}>
    <Primitive.Root {...props} modal={modal} open={displayed} onOpenChange={changeOpen} />
  </AnchorContext.Provider>;
}

export type ContextMenuTriggerProps = React.ComponentPropsWithoutRef<typeof Primitive.Trigger> & {
  unstyled?: boolean;
};

/** Usually used with asChild around the clickable region. */
export const ContextMenuTrigger = forwardRef<HTMLButtonElement, ContextMenuTriggerProps>(function ContextMenuTrigger({ unstyled, className, ...props }, forwardedRef) {
  const anchor = useContext(AnchorContext);
  const outer = useRef(forwardedRef);
  outer.current = forwardedRef;
  const setTrigger = anchor?.setTrigger;
  const ref = useCallback((node: HTMLButtonElement | null) => {
    if (node) ensureUiStyles(node.ownerDocument);
    setTrigger?.(node);
    const current = outer.current;
    if (typeof current === 'function') current(node);
    else if (current) current.current = node;
  }, [setTrigger]);
  return <Primitive.Trigger {...props} className={classes('pero-ui-context-trigger', className)} data-unstyled={unstyled || undefined} ref={ref} />;
});

export type ContextMenuContentProps = React.ComponentPropsWithoutRef<typeof Primitive.Content> & {
  unstyled?: boolean;
  /** Portal parent. Default is the nearest open dialog, then .pero-workbench, then document.body. */
  container?: HTMLElement | null;
};

export const ContextMenuContent = forwardRef<HTMLDivElement, ContextMenuContentProps>(function ContextMenuContent({
  unstyled, className, container: containerOverride, collisionPadding = 8, loop = true, style, onCloseAutoFocus, onEscapeKeyDown, onKeyDown, ...props
}, forwardedRef) {
  const anchor = useContext(AnchorContext);
  const trigger = anchor?.trigger ?? null;
  const container = trigger ? resolvePopupContainer(trigger, containerOverride) : containerOverride ?? undefined;
  const outerRef = useStableRef(forwardedRef);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => { setContent(node); outerRef(node); }, [outerRef]);
  useMenuTheme(content, trigger, container, style);
  return <Primitive.Portal container={container}>
    <Primitive.Content {...props} loop={loop} collisionPadding={collisionPadding}
      className={classes('pero-ui-dropdown-content pero-ui-context-content', className)} data-unstyled={unstyled || undefined}
      style={{ ...menuThemeStyle(trigger, container ?? undefined), ...style }}
      onKeyDown={event => {
        onKeyDown?.(event);
        if (event.key === 'Tab' && !event.defaultPrevented && anchor) {
          event.preventDefault(); event.stopPropagation();
          anchor.tabDirection.current = event.shiftKey ? -1 : 1; anchor.close();
        }
      }}
      onEscapeKeyDown={event => { event.stopPropagation(); onEscapeKeyDown?.(event); }}
      onCloseAutoFocus={event => {
        const doc = trigger?.ownerDocument ?? (event.currentTarget as HTMLElement | null)?.ownerDocument;
        onCloseAutoFocus?.(event);
        const activeDialog = doc && focusedOpenDialog(doc);
        if (activeDialog && !activeDialog.contains(trigger)) event.preventDefault();
        const direction = anchor?.tabDirection.current ?? 0;
        if (anchor) anchor.tabDirection.current = 0;
        if (direction && trigger && !event.defaultPrevented) { event.preventDefault(); continueTab(trigger, direction); }
      }} ref={ref} />
  </Primitive.Portal>;
});

export type ContextMenuItemProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.Item>, 'asChild'> & {
  unstyled?: boolean;
  danger?: boolean;
};

export const ContextMenuItem = forwardRef<HTMLDivElement, ContextMenuItemProps>(function ContextMenuItem({ unstyled, danger, className, ...props }, forwardedRef) {
  return <Primitive.Item {...props} className={classes('pero-ui-dropdown-item', className)} data-unstyled={unstyled || undefined} data-danger={danger || undefined} ref={useStableRef(forwardedRef)} />;
});

export type ContextMenuCheckboxItemProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.CheckboxItem>, 'asChild'> & {
  unstyled?: boolean;
  danger?: boolean;
};

export const ContextMenuCheckboxItem = forwardRef<HTMLDivElement, ContextMenuCheckboxItemProps>(function ContextMenuCheckboxItem({ unstyled, danger, className, children, ...props }, forwardedRef) {
  return <Primitive.CheckboxItem {...props} className={classes('pero-ui-dropdown-item', className)} data-unstyled={unstyled || undefined} data-danger={danger || undefined} ref={useStableRef(forwardedRef)}>
    {!unstyled && <span className="pero-ui-dropdown-indicator" aria-hidden="true"><Primitive.ItemIndicator><Icon name={props.checked === 'indeterminate' ? 'minus' : 'check'} size={12} /></Primitive.ItemIndicator></span>}
    {children}
  </Primitive.CheckboxItem>;
});

export type ContextMenuRadioGroupProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.RadioGroup>, 'asChild'>;

export const ContextMenuRadioGroup = forwardRef<HTMLDivElement, ContextMenuRadioGroupProps>(function ContextMenuRadioGroup(props, forwardedRef) {
  return <Primitive.RadioGroup {...props} ref={useStableRef(forwardedRef)} />;
});

export type ContextMenuRadioItemProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.RadioItem>, 'asChild'> & {
  unstyled?: boolean;
  danger?: boolean;
};

export const ContextMenuRadioItem = forwardRef<HTMLDivElement, ContextMenuRadioItemProps>(function ContextMenuRadioItem({ unstyled, danger, className, children, ...props }, forwardedRef) {
  return <Primitive.RadioItem {...props} className={classes('pero-ui-dropdown-item', className)} data-unstyled={unstyled || undefined} data-danger={danger || undefined} ref={useStableRef(forwardedRef)}>
    {!unstyled && <span className="pero-ui-dropdown-indicator" aria-hidden="true"><Primitive.ItemIndicator><Icon name="dot" size={12} /></Primitive.ItemIndicator></span>}
    {children}
  </Primitive.RadioItem>;
});

export type ContextMenuSeparatorProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.Separator>, 'asChild'> & {
  unstyled?: boolean;
};

export const ContextMenuSeparator = forwardRef<HTMLDivElement, ContextMenuSeparatorProps>(function ContextMenuSeparator({ unstyled, className, ...props }, forwardedRef) {
  return <Primitive.Separator {...props} className={classes('pero-ui-dropdown-separator', className)} data-unstyled={unstyled || undefined} ref={useStableRef(forwardedRef)} />;
});

export type ContextMenuSubProps = React.ComponentPropsWithoutRef<typeof Primitive.Sub>;

/** Nested context submenu. Open and dismiss stay on Radix. */
export function ContextMenuSub(props: ContextMenuSubProps) {
  return <Primitive.Sub {...props} />;
}

export type ContextMenuSubTriggerProps = Omit<React.ComponentPropsWithoutRef<typeof Primitive.SubTrigger>, 'asChild'> & {
  unstyled?: boolean;
};

export const ContextMenuSubTrigger = forwardRef<HTMLDivElement, ContextMenuSubTriggerProps>(function ContextMenuSubTrigger({ unstyled, className, children, ...props }, forwardedRef) {
  return <Primitive.SubTrigger {...props} className={classes('pero-ui-dropdown-item pero-ui-dropdown-sub-trigger', className)} data-unstyled={unstyled || undefined} ref={useStableRef(forwardedRef)}>
    {children}
    {!unstyled && <span className="pero-ui-dropdown-indicator pero-ui-dropdown-sub-chevron" aria-hidden="true"><Icon name="chevron-right" size={12} /></span>}
  </Primitive.SubTrigger>;
});

export type ContextMenuSubContentProps = React.ComponentPropsWithoutRef<typeof Primitive.SubContent> & {
  unstyled?: boolean;
  container?: HTMLElement | null;
};

export const ContextMenuSubContent = forwardRef<HTMLDivElement, ContextMenuSubContentProps>(function ContextMenuSubContent({
  unstyled, className, container: containerOverride, sideOffset = 4, collisionPadding = 8, style, onEscapeKeyDown, ...props
}, forwardedRef) {
  const anchor = useContext(AnchorContext);
  const trigger = anchor?.trigger ?? null;
  const container = trigger ? resolvePopupContainer(trigger, containerOverride) : containerOverride ?? undefined;
  const outerRef = useStableRef(forwardedRef);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => { setContent(node); outerRef(node); }, [outerRef]);
  useMenuTheme(content, trigger, container, style);
  return <Primitive.Portal container={container}>
    <Primitive.SubContent {...props} sideOffset={sideOffset} collisionPadding={collisionPadding}
      className={classes('pero-ui-dropdown-content pero-ui-dropdown-sub-content', className)} data-unstyled={unstyled || undefined}
      style={{ ...menuThemeStyle(trigger, container ?? undefined), ...style }}
      onEscapeKeyDown={event => { event.stopPropagation(); onEscapeKeyDown?.(event); }}
      ref={ref} />
  </Primitive.Portal>;
});
