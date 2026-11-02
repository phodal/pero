// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { useRef } from 'react';
import { ensureUiStyles } from './ui-styles';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Signed travel for a pane on `side` of the handle. Rightward (or downward) pointer/arrow is positive. */
function resizeDelta(side: 'left' | 'right', pointerDx: number) {
  return (side === 'left' ? 1 : -1) * pointerDx;
}

export type SplitPaneHandleProps = {
  label: string;
  /** `horizontal` is a row-resize grip between stacked panes; keys and pointer use the Y axis. */
  orientation?: 'vertical' | 'horizontal';
  value: number;
  min: number;
  max: number;
  valueText: string;
  /** Pane sitting on this side of the handle; flips drag and arrow deltas. Default left. */
  side?: 'left' | 'right';
  step?: number;
  /** When Shift is held with arrows (Architecture). Ignored when homeEnd is false and unused. */
  largeStep?: number;
  className?: string;
  hidden?: boolean;
  unstyled?: boolean;
  title?: string;
  /** Double-click resets to this width when set. */
  defaultValue?: number;
  /** Enable Home/End to jump to min/max. */
  homeEnd?: boolean;
  onValueChange: (value: number) => void;
  onDragging?: (dragging: boolean) => void;
  /** After keyboard nudge or pointer release/cancel. */
  onCommit?: () => void;
  /** Enter key (Workbench surface swap). */
  onEnter?: () => void;
};

/**
 * Vertical resize separator. Positioning and pane layout stay with the consumer;
 * this owns pointer capture, keyboard nudges and separator ARIA.
 */
export function SplitPaneHandle({
  label, orientation = 'vertical', value, min, max, valueText, side = 'left', step = 20, largeStep, className, hidden = false, unstyled,
  title, defaultValue, homeEnd = false, onValueChange, onDragging, onCommit, onEnter,
}: SplitPaneHandleProps) {
  const drag = useRef({ x: 0, width: 0 });
  const horizontal = orientation === 'horizontal';
  const [less, more] = horizontal ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
  const axis = (event: { clientX: number; clientY: number }) => horizontal ? event.clientY : event.clientX;
  const apply = (next: number) => onValueChange(clamp(next, min, max));
  return <div
    ref={node => { if (node) ensureUiStyles(node.ownerDocument); }}
    className={[unstyled ? '' : 'pero-ui-split-pane-handle', className].filter(Boolean).join(' ')}
    data-unstyled={unstyled || undefined}
    role="separator"
    aria-label={label}
    aria-orientation={orientation}
    data-orientation={orientation}
    aria-valuemin={Math.round(min)}
    aria-valuemax={Math.round(max)}
    aria-valuenow={Math.round(value)}
    aria-valuetext={valueText}
    aria-keyshortcuts={onEnter ? `Enter ${less} ${more}` : homeEnd ? `${less} ${more} Home End` : `${less} ${more}`}
    tabIndex={hidden ? -1 : 0}
    hidden={hidden}
    title={title}
    onDoubleClick={defaultValue === undefined ? undefined : () => { apply(defaultValue); onCommit?.(); }}
    onKeyDown={event => {
      if (event.key === 'Enter' && onEnter) { event.preventDefault(); onEnter(); return; }
      const keys = homeEnd ? [less, more, 'Home', 'End'] : [less, more];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Home') { apply(min); onCommit?.(); return; }
      if (event.key === 'End') { apply(max); onCommit?.(); return; }
      const unit = event.shiftKey && largeStep !== undefined ? largeStep : step;
      const amount = unit * (event.key === more ? 1 : -1);
      apply(value + resizeDelta(side, amount));
      onCommit?.();
    }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: axis(event), width: value };
      onDragging?.(true);
    }}
    onPointerMove={event => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      apply(drag.current.width + resizeDelta(side, axis(event) - drag.current.x));
    }}
    onPointerUp={event => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      onDragging?.(false);
      onCommit?.();
    }}
    onPointerCancel={event => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      onDragging?.(false);
      onCommit?.();
    }}
    onLostPointerCapture={() => onDragging?.(false)}
  />;
}
