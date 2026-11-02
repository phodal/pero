// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icon';
import { IconButton, type IconButtonProps } from './icon-button';
import { Tooltip } from './tooltip';

export type InfoTipProps = Omit<IconButtonProps, 'label' | 'children' | 'className' | 'aria-expanded'> & {
  text: string;
  label?: string;
  align?: 'start' | 'center' | 'end';
  className?: string;
  buttonClassName?: string;
  container?: HTMLElement | null;
};

/** Text-only help: hover/focus shows it, click pins it for touch or long reading. */
export const InfoTip = forwardRef<HTMLButtonElement, InfoTipProps>(function InfoTip({
  text, label, align = 'center', className, buttonClassName, container,
  onClick, variant = 'unstyled', ...props
}, forwardedRef) {
  const [shown, setShown] = useState(false);
  const [pinned, setPinned] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const ref = useCallback((node: HTMLButtonElement | null) => {
    setButton(node);
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
  useEffect(() => {
    if (!pinned || !button) return;
    const doc = button.ownerDocument;
    const close = () => { setPinned(false); setShown(false); };
    const outside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof doc.defaultView!.Node) || root.current?.contains(target)) return;
      const tooltip = doc.getElementById(button.getAttribute('aria-describedby')?.split(/\s+/).at(-1) ?? '');
      if (!tooltip?.contains(target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation(); close();
    };
    doc.addEventListener('pointerdown', outside);
    doc.addEventListener('keydown', escape, true);
    return () => { doc.removeEventListener('pointerdown', outside); doc.removeEventListener('keydown', escape, true); };
  }, [pinned, button]);
  return <span ref={root} className={['pero-ui-help-tip', className].filter(Boolean).join(' ')} data-align={align} data-open={pinned || undefined}>
    <Tooltip label={text} side="bottom" align={align} maxWidth={320} container={container}
      open={shown} onOpenChange={next => { if (!pinned) setShown(next); }}>
      <IconButton {...props} ref={ref} type="button" variant={variant} label={label ?? text}
        className={['pero-ui-help-tip-button', buttonClassName].filter(Boolean).join(' ')} aria-expanded={pinned}
        onClick={event => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          setPinned(!pinned); setShown(!pinned);
        }}><Icon name="info" size={15} /></IconButton>
    </Tooltip>
  </span>;
});
