// Adapted from Point App SDK d95f9118e (Apache-2.0).
import React, { cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolvePopupContainer } from './popup-container';
import { ensureUiStyles } from './ui-styles';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';
export type TooltipAlign = 'start' | 'center' | 'end';
export type TooltipLabel = string | (() => string);

type AnchorHandler<E> = ((event: E) => void) | undefined;

export type TooltipProps = {
  /** Bubble text, or a resolver read only while the bubble is visible. */
  label: TooltipLabel;
  /** Preferred side. The bubble flips when that side cannot fit. */
  side?: TooltipSide;
  /** Hover delay. Keyboard focus shows immediately. */
  delayMs?: number;
  /** Suppress the bubble without remounting the anchor. */
  disabled?: boolean;
  /** Width cap in pixels, still clamped to the viewport. */
  maxWidth?: number;
  /** Cross-axis alignment against the anchor. */
  align?: TooltipAlign;
  /** One native or ref-forwarding element. No layout wrapper is added. */
  children: React.ReactElement;
  /** Controlled visibility for a pinned HelpTip. Hover and focus still report changes. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  container?: HTMLElement | null;
  className?: string;
};

const GAP = 8;
const MARGIN = 8;
const OPPOSITE: Record<TooltipSide, TooltipSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function classes(...names: Array<string | undefined>) {
  return names.filter(Boolean).join(' ');
}

function assignRef(ref: React.Ref<HTMLElement> | null | undefined, node: HTMLElement | null) {
  if (typeof ref === 'function') ref(node);
  else if (ref) (ref as React.MutableRefObject<HTMLElement | null>).current = node;
}

function childRef(element: React.ReactElement): React.Ref<HTMLElement> | null {
  // React 19 moved ref to props; avoid either version's warning getter.
  return Number.parseInt(React.version, 10) >= 19
    ? (element.props as { ref?: React.Ref<HTMLElement> }).ref ?? null
    : (element as unknown as { ref?: React.Ref<HTMLElement> }).ref ?? null;
}

function chain<E extends { defaultPrevented: boolean }>(child: AnchorHandler<E>, own: (event: E) => void) {
  if (!child) return own;
  return (event: E) => {
    child(event);
    if (!event.defaultPrevented) own(event);
  };
}

function applyTheme(trigger: HTMLElement, panel: HTMLElement) {
  const computed = trigger.ownerDocument.defaultView?.getComputedStyle(trigger);
  const tokens = new Map<string, string>();
  if (computed) for (const name of computed) {
    if (name.startsWith('--')) tokens.set(name, computed.getPropertyValue(name).trim());
  }
  let font = computed?.fontFamily;
  for (let node: HTMLElement | null = trigger; node; node = node.parentElement) {
    if (!font && node.style.fontFamily) font = node.style.fontFamily;
    for (const name of node.style) if (name.startsWith('--') && !tokens.has(name)) tokens.set(name, node.style.getPropertyValue(name).trim());
  }
  for (const name of [...panel.style]) if (name.startsWith('--') && !tokens.has(name)) panel.style.removeProperty(name);
  for (const [name, value] of tokens) panel.style.setProperty(name, value);
  if (font) panel.style.fontFamily = font;
}

/**
 * Text-only hover and focus tip. The anchor stays the only DOM child so existing
 * layout, refs, and events are preserved. A pinned owner controls `open`.
 */
export function Tooltip({
  label, side = 'right', delayMs = 0, disabled = false, maxWidth, align = 'center', children, open, onOpenChange, container, className,
}: TooltipProps) {
  const controlled = open !== undefined;
  const [uncontrolled, setUncontrolled] = useState(false);
  const displayed = !disabled && (controlled ? open : uncontrolled);
  const tipId = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const triggers = useRef({ hover: false, focus: false, bubble: false });
  const block = useRef(false);
  const cancelTimer = useRef<(() => void) | null>(null);
  const hideTimer = useRef<(() => void) | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const displayedRef = useRef(displayed);
  displayedRef.current = displayed;

  const cancel = useCallback(() => {
    cancelTimer.current?.();
    cancelTimer.current = null;
    hideTimer.current?.(); hideTimer.current = null;
  }, []);

  const commit = useCallback((next: boolean) => {
    if (displayedRef.current === next) return;
    // Record the request before the owner re-renders: a focus that is moved away
    // within the same batch (a dialog placing initial focus) must still hide it.
    displayedRef.current = next;
    if (!controlled) setUncontrolled(next);
    onOpenChangeRef.current?.(next);
  }, [controlled]);

  const dismiss = useCallback(() => {
    cancel();
    block.current = triggers.current.hover || triggers.current.focus || triggers.current.bubble;
    commit(false);
  }, [cancel, commit]);

  const show = useCallback((immediate: boolean) => {
    if (disabled || block.current) return;
    const node = anchorRef.current;
    if (!node) return;
    if (!immediate && delayMs > 0) {
      cancel();
      const view = node.ownerDocument.defaultView ?? globalThis;
      const id = view.setTimeout(() => {
        cancelTimer.current = null;
        if (!disabled && !block.current && triggers.current.hover) commit(true);
      }, delayMs);
      cancelTimer.current = () => view.clearTimeout(id);
      return;
    }
    cancel();
    commit(true);
  }, [cancel, commit, delayMs, disabled]);

  const leave = useCallback(() => {
    cancel();
    if (triggers.current.hover || triggers.current.focus || triggers.current.bubble) return;
    block.current = false;
    const view = anchorRef.current?.ownerDocument.defaultView;
    if (!displayedRef.current || !view) { commit(false); return; }
    // Let the pointer cross the gap into the text, where it can scroll long tips.
    const id = view.setTimeout(() => { hideTimer.current = null; commit(false); }, 100);
    hideTimer.current = () => view.clearTimeout(id);
  }, [cancel, commit]);

  useEffect(() => {
    if (!displayed || !anchor) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || anchor.contains(event.target as Node)) return;
      event.preventDefault(); event.stopPropagation(); dismiss();
    };
    anchor.ownerDocument.addEventListener('keydown', escape, true);
    return () => anchor.ownerDocument.removeEventListener('keydown', escape, true);
  }, [displayed, anchor, dismiss]);

  useEffect(() => cancel, [cancel]);

  useEffect(() => {
    if (!disabled) return;
    cancel();
    block.current = triggers.current.hover || triggers.current.focus || triggers.current.bubble;
    if (!controlled) setUncontrolled(false);
  }, [disabled, cancel, controlled]);

  const portal = anchor ? resolvePopupContainer(anchor, container) : null;

  useLayoutEffect(() => {
    if (!displayed || !anchor || !tipRef.current || !portal) return;
    const element = tipRef.current;
    const doc = anchor.ownerDocument;
    const view = doc.defaultView;
    if (!view) return;
    const viewport = view.visualViewport;
    const copyTheme = portal === doc.body;
    const place = () => {
      if (copyTheme) applyTheme(anchor, element);
      const rect = anchor.getBoundingClientRect();
      const leftEdge = (viewport?.offsetLeft ?? 0) + MARGIN;
      const topEdge = (viewport?.offsetTop ?? 0) + MARGIN;
      const rightEdge = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? view.innerWidth) - MARGIN;
      const bottomEdge = (viewport?.offsetTop ?? 0) + (viewport?.height ?? view.innerHeight) - MARGIN;
      const cap = Math.max(0, rightEdge - leftEdge);
      element.style.maxWidth = `${Math.min(maxWidth ?? 320, cap)}px`;
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const space: Record<TooltipSide, number> = {
        top: rect.top - topEdge,
        bottom: bottomEdge - rect.bottom,
        left: rect.left - leftEdge,
        right: rightEdge - rect.right,
      };
      const need = (side === 'left' || side === 'right' ? width : height) + GAP;
      const used = space[side] < need && space[OPPOSITE[side]] > space[side] ? OPPOSITE[side] : side;
      element.dataset.side = used;
      const along = (start: number, size: number, span: number, min: number, max: number) => {
        const preferred = align === 'start' ? start : align === 'end' ? start + size - span : start + size / 2 - span / 2;
        return Math.max(min, Math.min(preferred, Math.max(min, max - span)));
      };
      let left: number;
      let top: number;
      if (used === 'top' || used === 'bottom') {
        left = along(rect.left, rect.width, width, leftEdge, rightEdge);
        const raw = used === 'top' ? rect.top - height - GAP : rect.bottom + GAP;
        top = Math.max(topEdge, Math.min(raw, Math.max(topEdge, bottomEdge - height)));
      } else {
        top = along(rect.top, rect.height, height, topEdge, bottomEdge);
        const raw = used === 'left' ? rect.left - width - GAP : rect.right + GAP;
        left = Math.max(leftEdge, Math.min(raw, Math.max(leftEdge, rightEdge - width)));
      }
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
      element.style.maxHeight = `${Math.max(0, bottomEdge - topEdge)}px`;
      element.style.overflowY = 'auto';
      element.style.visibility = 'visible';
    };
    place();
    const SizeObserver = view.ResizeObserver;
    const size = SizeObserver ? new SizeObserver(place) : null;
    size?.observe(anchor);
    size?.observe(element);
    const themeObserver = copyTheme ? new view.MutationObserver(place) : null;
    if (themeObserver) for (let node: HTMLElement | null = anchor; node; node = node.parentElement) themeObserver.observe(node, { attributes: true });
    view.addEventListener('resize', place);
    view.addEventListener('scroll', place, true);
    viewport?.addEventListener('resize', place);
    viewport?.addEventListener('scroll', place);
    return () => {
      size?.disconnect();
      themeObserver?.disconnect();
      view.removeEventListener('resize', place);
      view.removeEventListener('scroll', place, true);
      viewport?.removeEventListener('resize', place);
      viewport?.removeEventListener('scroll', place);
    };
  }, [displayed, anchor, portal, side, align, maxWidth, label]);

  const inherited = isValidElement(children) ? childRef(children) : null;
  const mergedRef = useCallback((node: HTMLElement | null) => {
    anchorRef.current = node;
    assignRef(inherited, node);
    setAnchor(current => current === node ? current : node);
    if (node) ensureUiStyles(node.ownerDocument);
  }, [inherited]);

  if (!isValidElement(children)) return children;
  const existing = (children.props as { 'aria-describedby'?: string })['aria-describedby'];
  const describedBy = displayed ? [existing, tipId].filter(Boolean).join(' ') : existing;
  const text = displayed ? (typeof label === 'function' ? label() : label) : null;
  const anchorProps = children.props as {
    onMouseEnter?: AnchorHandler<React.MouseEvent<HTMLElement>>;
    onMouseLeave?: AnchorHandler<React.MouseEvent<HTMLElement>>;
    onFocus?: AnchorHandler<React.FocusEvent<HTMLElement>>;
    onBlur?: AnchorHandler<React.FocusEvent<HTMLElement>>;
    onClick?: AnchorHandler<React.MouseEvent<HTMLElement>>;
    onKeyDown?: AnchorHandler<React.KeyboardEvent<HTMLElement>>;
  };

  return <>
    {cloneElement(children, {
      ref: mergedRef,
      'aria-describedby': describedBy,
      onMouseEnter: chain(anchorProps.onMouseEnter, () => {
        triggers.current.hover = true;
        show(triggers.current.focus);
      }),
      onMouseLeave: chain(anchorProps.onMouseLeave, () => {
        triggers.current.hover = false;
        leave();
      }),
      onFocus: chain(anchorProps.onFocus, () => {
        triggers.current.focus = true;
        show(true);
      }),
      onBlur: chain(anchorProps.onBlur, () => {
        triggers.current.focus = false;
        if (!triggers.current.hover && !triggers.current.bubble) {
          cancel();
          block.current = false;
          commit(false);
        }
      }),
      onClick: chain(anchorProps.onClick, () => {
        if (!controlled && displayedRef.current) dismiss();
      }),
      onKeyDown: chain(anchorProps.onKeyDown, event => {
        if (event.key !== 'Escape' || !displayedRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }),
    } as Partial<unknown>)}
    {displayed && portal && text != null && createPortal(
      <span ref={tipRef} id={tipId} role="tooltip" data-side={side} data-align={align} style={{ position: 'fixed', visibility: 'hidden' }} onMouseEnter={() => { triggers.current.bubble = true; cancel(); }} onMouseLeave={() => { triggers.current.bubble = false; leave(); }} className={classes('pero-ui-tooltip', className)}>{text}</span>,
      portal,
    )}
  </>;
}
