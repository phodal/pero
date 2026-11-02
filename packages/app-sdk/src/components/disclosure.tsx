// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { forwardRef, useLayoutEffect, useRef } from 'react';
import { Icon } from './icon';
import { ensureUiStyles } from './ui-styles';

export type DisclosureProps = Omit<React.ComponentPropsWithoutRef<'details'>, 'open' | 'onToggle'> & {
  /** Controlled open state. Omit so the details element keeps the native state. */
  open?: boolean;
  /** Uncontrolled initial open state. Updates after mount are ignored. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onToggle?: React.ReactEventHandler<HTMLDetailsElement>;
  summary: React.ReactNode;
  summaryProps?: React.ComponentPropsWithoutRef<'summary'> & { ref?: React.Ref<HTMLElement> };
  /**
   * Marker before the summary label. Omit for the default chevron.
   * `null` or `false` hides the marker.
   */
  indicator?: React.ReactNode;
  unstyled?: boolean;
};

/**
 * Native details/summary. Children stay mounted while closed so draft fields survive.
 * A controlled toggle reports the desired state once, then puts the DOM back when the owner does not accept it.
 */
export const Disclosure = forwardRef<HTMLDetailsElement, DisclosureProps>(function Disclosure({
  open,
  defaultOpen = false,
  onOpenChange,
  onToggle,
  summary,
  summaryProps,
  indicator,
  unstyled,
  className,
  children,
  ...rest
}, forwardedRef) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  const controlledRef = useRef(open !== undefined);
  const uncontrolledOpen = useRef(defaultOpen);
  const appliedInitial = useRef(false);
  // element.open assignment queues a toggle. Hold the written value until that event arrives.
  const pendingWrite = useRef<boolean | null>(null);
  // beforetoggle already reported this desired value; the following toggle must not report again.
  const reported = useRef<boolean | null>(null);
  openRef.current = open;
  onOpenChangeRef.current = onOpenChange;
  controlledRef.current = open !== undefined;

  const assignOpen = (node: HTMLDetailsElement, next: boolean) => {
    if (node.open === next) return;
    pendingWrite.current = next;
    node.open = next;
  };

  useLayoutEffect(() => {
    const node = detailsRef.current;
    if (!node) return;
    const onBeforeToggle = (event: Event) => {
      if (!controlledRef.current || pendingWrite.current !== null) return;
      const nextState = (event as Event & { newState?: string }).newState;
      if (nextState !== 'open' && nextState !== 'closed') return;
      if (event.cancelable) event.preventDefault();
      const next = nextState === 'open';
      reported.current = next;
      if (next !== !!openRef.current) onOpenChangeRef.current?.(next);
    };
    const onToggleEvent = (event: Event) => {
      const desired = node.open;
      if (pendingWrite.current !== null) {
        const written = pendingWrite.current;
        pendingWrite.current = null;
        if (desired === written) {
          reported.current = null;
          return;
        }
      }
      if (controlledRef.current && reported.current !== null) {
        const already = reported.current;
        reported.current = null;
        if (desired === already) {
          if (node.open !== !!openRef.current) assignOpen(node, !!openRef.current);
          return;
        }
      }
      if (controlledRef.current) {
        const current = !!openRef.current;
        if (desired === current) return;
        onOpenChangeRef.current?.(desired);
        if (node.open !== current) assignOpen(node, current);
        return;
      }
      if (desired === uncontrolledOpen.current) return;
      uncontrolledOpen.current = desired;
      onOpenChangeRef.current?.(desired);
    };
    node.addEventListener('beforetoggle', onBeforeToggle);
    node.addEventListener('toggle', onToggleEvent);
    return () => {
      node.removeEventListener('beforetoggle', onBeforeToggle);
      node.removeEventListener('toggle', onToggleEvent);
    };
  }, []);

  useLayoutEffect(() => {
    const node = detailsRef.current;
    if (!node) return;
    if (open === undefined) {
      if (appliedInitial.current) return;
      appliedInitial.current = true;
      assignOpen(node, uncontrolledOpen.current);
      return;
    }
    assignOpen(node, open);
  }, [open]);

  const setDetailsRef = (node: HTMLDetailsElement | null) => {
    detailsRef.current = node;
    if (node) ensureUiStyles(node.ownerDocument);
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };
  const { ref: summaryRef, ...summaryRest } = summaryProps ?? {};
  const showIndicator = indicator === undefined ? true : Boolean(indicator);
  const indicatorNode = indicator === undefined
    ? <Icon name="chevron-right" size={14} />
    : indicator;
  return <details {...rest} onToggle={onToggle} ref={setDetailsRef} className={['pero-ui-disclosure', className].filter(Boolean).join(' ')} data-unstyled={unstyled || undefined} >
    <summary
      ref={summaryRef as React.Ref<HTMLElement>}
      {...summaryRest}
      data-no-indicator={showIndicator ? undefined : ''}
    >
      {showIndicator ? (
        <span className="pero-ui-disclosure-indicator" aria-hidden="true">{indicatorNode}</span>
      ) : null}
      {summary}
    </summary>
    {children}
  </details>;
});
