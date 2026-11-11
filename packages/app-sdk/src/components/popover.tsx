// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, type ButtonProps } from './button';
import { resolvePopupContainer } from './popup-container';
import { ensureUiStyles } from './ui-styles';

export type PopoverProps = {
  label: string;
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  className?: string;
  contentClassName?: string;
  align?: 'start' | 'end';
  triggerClassName?: string;
  triggerVariant?: ButtonProps['variant'];
  triggerTitle?: string;
  /** `dialog` is non-modal rich content. `false` paints no popup role. `menu` is an action list. */
  popupRole?: true | false | React.AriaAttributes['aria-haspopup'];
  container?: HTMLElement | null;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  /** Keep stateful tools mounted while closed; the hidden panel leaves focus order. */
  keepMounted?: boolean;
};

const TAB_SELECTOR = 'button,input,select,textarea,a[href],summary,[tabindex]';

function classes(...names: Array<string | undefined>) {
  return names.filter(Boolean).join(' ');
}

function restoreTrigger(trigger: HTMLButtonElement | null, panel: HTMLElement | null) {
  if (!trigger?.isConnected) return;
  const doc = trigger.ownerDocument;
  const active = doc.activeElement;
  if (active && active !== doc.body && active !== doc.documentElement) {
    const onTrigger = active === trigger || trigger.contains(active);
    const onPanel = !!panel?.isConnected && (active === panel || panel.contains(active));
    if (!onTrigger && !onPanel) return;
  }
  trigger.focus();
}

function enabledMenuItems(panel: HTMLElement) {
  return [...panel.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter(item =>
    !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true'
    && !item.closest('[hidden],[inert],dialog:not([open]),details:not([open]) > :not(summary)'));
}

function tabbables(root: ParentNode, skip: HTMLElement | null, doc: Document) {
  const view = doc.defaultView;
  return [...root.querySelectorAll<HTMLElement>(TAB_SELECTOR)].filter(node => {
    if (skip && (node === skip || skip.contains(node))) return false;
    if (node.tabIndex < 0 || node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true' || node.closest('[hidden],[inert],dialog:not([open])')) return false;
    for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
      const style = view?.getComputedStyle(ancestor);
      if (style?.display === 'none' || style?.visibility === 'hidden') return false;
      if (ancestor.localName === 'details' && !ancestor.hasAttribute('open') && !ancestor.querySelector('summary')?.contains(node)) return false;
    }
    return true;
  });
}

function applyTheme(trigger: HTMLElement, panel: HTMLElement) {
  const computed = trigger.ownerDocument.defaultView?.getComputedStyle(trigger);
  const tokens = new Map<string, string>();
  if (computed) for (const name of computed) {
    if (name.startsWith('--')) tokens.set(name, computed.getPropertyValue(name).trim());
  }
  let font = computed?.fontFamily;
  // The computed value wins in a browser; inline ancestors also support documents without layout.
  for (let node: HTMLElement | null = trigger; node; node = node.parentElement) {
    if (!font && node.style.fontFamily) font = node.style.fontFamily;
    for (const name of node.style) if (name.startsWith('--') && !tokens.has(name)) tokens.set(name, node.style.getPropertyValue(name).trim());
  }
  for (const name of [...panel.style]) if (name.startsWith('--') && !tokens.has(name)) panel.style.removeProperty(name);
  for (const [name, value] of tokens) panel.style.setProperty(name, value);
  if (font) panel.style.fontFamily = font;
}

/**
 * Disclosure anchored to its trigger. Content portals into an explicit container,
 * the nearest open dialog, the workbench, or the owning body.
 */
export const Popover = forwardRef<HTMLButtonElement, PopoverProps>(function Popover({
  label, trigger, children, className, contentClassName, align = 'end', triggerClassName, triggerVariant = 'unstyled', triggerTitle,
  popupRole = 'dialog', container, open, defaultOpen = false, onOpenChange, disabled = false, keepMounted = false,
}, forwardedRef) {
  const controlled = open !== undefined;
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const displayed = !disabled && (controlled ? open : uncontrolled);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [triggerNode, setTriggerNode] = useState<HTMLButtonElement | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const emitted = useRef<boolean | null>(null);

  const setTrigger = useCallback((node: HTMLButtonElement | null) => {
    triggerRef.current = node;
    setTriggerNode(current => current === node ? current : node);
    if (node) ensureUiStyles(node.ownerDocument);
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  const commit = useCallback((next: boolean, refocus = false) => {
    if (emitted.current === next || displayed === next) {
      if (!next && refocus) restoreTrigger(triggerRef.current, panelRef.current);
      return;
    }
    emitted.current = next;
    if (!controlled) setUncontrolled(next);
    onOpenChangeRef.current?.(next);
    if (!next && refocus) restoreTrigger(triggerRef.current, panelRef.current);
    queueMicrotask(() => { if (emitted.current === next) emitted.current = null; });
  }, [controlled, displayed]);

  const requestClose = useCallback(() => commit(false, true), [commit]);
  const portal = triggerNode ? resolvePopupContainer(triggerNode, container) : null;
  const role = popupRole === true || popupRole === 'true' ? 'menu' : popupRole === false || popupRole === 'false' ? undefined : popupRole;

  useLayoutEffect(() => {
    if (displayed && role === 'menu' && panelRef.current) enabledMenuItems(panelRef.current)[0]?.focus();
  }, [displayed, role, portal]);

  useLayoutEffect(() => {
    if (!displayed || !triggerNode || !panelRef.current || !portal) return;
    const anchor = triggerNode;
    const element = panelRef.current;
    const doc = anchor.ownerDocument;
    const view = doc.defaultView;
    if (!view) return;
    const viewport = view.visualViewport;
    const place = () => {
      applyTheme(anchor, element);
      const rect = anchor.getBoundingClientRect();
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? view.innerWidth) - 8;
      const bottomEdge = (viewport?.offsetTop ?? 0) + (viewport?.height ?? view.innerHeight) - 8;
      if (rect.bottom < topEdge || rect.top > bottomEdge || rect.right < leftEdge || rect.left > rightEdge) { commit(false); return; }
      // Keep the consumer's size limit; placement only adds a viewport ceiling.
      element.style.removeProperty('max-width');
      element.style.removeProperty('max-height');
      const authored = view.getComputedStyle(element);
      const widthLimit = authored.maxWidth, heightLimit = authored.maxHeight;
      const availableWidth = `${Math.max(0, rightEdge - leftEdge)}px`;
      element.style.maxWidth = widthLimit && widthLimit !== 'none' ? `min(${widthLimit}, ${availableWidth})` : availableWidth;
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const preferred = align === 'start' ? rect.left : rect.right - width;
      element.style.left = `${Math.max(leftEdge, Math.min(preferred, rightEdge - width))}px`;
      element.style.right = 'auto';
      const gap = 4;
      const below = Math.max(0, bottomEdge - rect.bottom - gap);
      const above = Math.max(0, rect.top - topEdge - gap);
      const upward = below < height && above > below;
      const maxHeight = Math.max(0, upward ? above : below);
      element.style.maxHeight = heightLimit && heightLimit !== 'none' ? `min(${heightLimit}, ${maxHeight}px)` : `${maxHeight}px`;
      const used = Math.min(height, maxHeight);
      const top = upward ? rect.top - used - gap : rect.bottom + gap;
      element.style.visibility = 'visible';
      element.style.top = `${Math.max(topEdge, Math.min(top, Math.max(topEdge, bottomEdge - used)))}px`;
    };
    place();
    const SizeObserver = view.ResizeObserver;
    const size = SizeObserver ? new SizeObserver(place) : null;
    size?.observe(anchor);
    size?.observe(element);
    const themeObserver = new view.MutationObserver(place);
    for (let ancestor: HTMLElement | null = anchor; ancestor; ancestor = ancestor.parentElement) {
      themeObserver.observe(ancestor, { attributes: true });
    }
    view.addEventListener('resize', place);
    view.addEventListener('scroll', place, true);
    viewport?.addEventListener('resize', place);
    viewport?.addEventListener('scroll', place);
    return () => {
      size?.disconnect();
      themeObserver.disconnect();
      view.removeEventListener('resize', place);
      view.removeEventListener('scroll', place, true);
      viewport?.removeEventListener('resize', place);
      viewport?.removeEventListener('scroll', place);
    };
  }, [displayed, align, portal, triggerNode, commit]);

  useEffect(() => {
    if (!displayed || !triggerNode || !portal) return;
    const doc = triggerNode.ownerDocument;
    const outside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof doc.defaultView!.Node)) return;
      if (triggerNode.contains(target) || panelRef.current?.contains(target)) return;
      commit(false, false);
    };
    doc.addEventListener('pointerdown', outside);
    doc.addEventListener('focusin', outside);
    return () => {
      doc.removeEventListener('pointerdown', outside);
      doc.removeEventListener('focusin', outside);
    };
  }, [displayed, portal, triggerNode, commit]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!displayed || event.defaultPrevented) return;
    const dialog = event.target instanceof Element ? event.target.closest('dialog[open]') : null;
    if (dialog && !dialog.contains(triggerRef.current)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      commit(false, true);
      return;
    }
    const triggerButton = triggerRef.current;
    const panel = panelRef.current;
    if (!triggerButton || !panel) return;
    if (event.key === 'Tab') {
      const doc = triggerButton.ownerDocument;
      const active = doc.activeElement instanceof doc.defaultView!.HTMLElement ? doc.activeElement : null;
      const items = tabbables(panel, null, doc);
      const onTrigger = active === triggerButton || (!!active && triggerButton.contains(active));
      if (!event.shiftKey && onTrigger && items[0]) {
        event.preventDefault();
        items[0].focus();
        return;
      }
      if (!active || (active !== panel && !panel.contains(active))) return;
      const index = items.indexOf(active);
      event.preventDefault();
      if (event.shiftKey) {
        if (index > 0) items[index - 1].focus();
        else triggerButton.focus();
        return;
      }
      if (index >= 0 && index < items.length - 1) {
        items[index + 1].focus();
        return;
      }
      const dialog = triggerButton.closest('dialog[open]');
      const order = tabbables(dialog ?? doc, panel, doc);
      const next = order[order.indexOf(triggerButton) + 1] ?? (dialog ? order[0] : triggerButton);
      commit(false, false);
      next?.focus();
      return;
    }
    if (role !== 'menu' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = enabledMenuItems(panel);
    if (!items.length) return;
    event.preventDefault();
    const doc = triggerButton.ownerDocument;
    const at = items.indexOf(doc.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : at < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1)
        : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
    items[next].scrollIntoView({ block: 'nearest' });
  };

  return <div className={classes('pero-ui-popover', className)} onKeyDown={onKeyDown}>
    <Button variant={triggerVariant} data-unstyled={triggerClassName ? true : undefined} ref={setTrigger} type="button" disabled={disabled} className={classes('pero-ui-popover-trigger', triggerClassName)} title={triggerTitle ?? label}
      aria-haspopup={popupRole === false ? false : popupRole} aria-expanded={!!displayed} aria-controls={displayed ? panelId : undefined} aria-label={label}
      onClick={event => { event.currentTarget.focus(); commit(!displayed, false); }}>{trigger}</Button>
    {(displayed || keepMounted) && portal && createPortal(<div ref={panelRef} id={panelId} hidden={!displayed} data-pero-popup-container="" role={role} aria-label={role ? label : undefined} data-align={align} style={{display:displayed ? undefined : 'none',visibility:displayed ? 'hidden' : undefined}} tabIndex={-1}
      className={classes('pero-ui-popover-panel', className, contentClassName)} onKeyDown={onKeyDown}>{children(requestClose)}</div>, portal)}
  </div>;
});
