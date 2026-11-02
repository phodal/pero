// Adapted from Point App SDK d95f9118e (Apache-2.0).
import React, { forwardRef, useEffect, useRef } from 'react';
import { ensureUiStyles } from './ui-styles';

export type StepperStatus = 'idle' | 'active' | 'waiting' | 'blocked' | 'done' | 'failed';

export interface StepperItem {
  id: string;
  title: React.ReactNode;
  /** Small line above the title, e.g. who carries the step out. */
  eyebrow?: React.ReactNode;
  /** Mark before the eyebrow, e.g. an icon or glyph. */
  leading?: React.ReactNode;
  /** Right end of the head row, e.g. the step number. */
  trailing?: React.ReactNode;
  badge?: React.ReactNode;
  /** Plain text shown on hover; the only name a collapsed step has on screen. */
  hint?: string;
  /** Below a divider, e.g. the checks that guard the step. */
  footer?: React.ReactNode;
  status?: StepperStatus;
  /** Exposed as `data-tone`, so the consumer can colour the step. */
  tone?: string;
  dimmed?: boolean;
}

export interface StepperEnd {
  /** Short marker such as IN or OUT. */
  tag: React.ReactNode;
  /** Names the group for assistive technology. */
  label: string;
  children: React.ReactNode;
}

/** `detail` is full cards; `fit` is one compact row meant to show the whole flow; `focus` collapses all but the chosen step. */
export type StepperView = 'detail' | 'fit' | 'focus';

export type StepperProps = Omit<React.ComponentPropsWithoutRef<'ol'>, 'onChange' | 'children'> & {
  label: string;
  items: StepperItem[];
  value?: string;
  view?: StepperView;
  onValueChange?: (id: string) => void;
  /** Where the flow comes from; drawn before the first step. */
  start?: StepperEnd;
  /** Where the flow arrives; drawn after the last step. */
  end?: StepperEnd;
};

/**
 * Left-to-right steps joined by arrows. Selecting a step is the caller's:
 * it controls `value` and draws whatever the step opens (details, results)
 * below. Wider than its container, the row scrolls; it never reflows.
 */
export const Stepper = forwardRef<HTMLOListElement, StepperProps>(function Stepper({ label, items, value, view = 'detail', onValueChange, start, end, className, ...props }, forwardedRef) {
  const list = useRef<HTMLOListElement | null>(null);
  useEffect(() => { list.current?.querySelector<HTMLElement>('[aria-pressed=true]')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' }); }, [value, view]);
  const ends = (kind: 'start' | 'end', part: StepperEnd) => <li className="pero-ui-stepper-end" data-end={kind}>
    <div role="group" aria-label={part.label}><span className="pero-ui-stepper-tag">{part.tag}</span><ul>{part.children}</ul></div>
  </li>;
  return <ol {...props} aria-label={label} data-view={view} className={['pero-ui-stepper', className].filter(Boolean).join(' ')}
    ref={node => {
      list.current = node;
      if (node) ensureUiStyles(node.ownerDocument);
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }}>
    {start && ends('start', start)}
    {items.map(item => <li key={item.id} className="pero-ui-stepper-item" data-dimmed={item.dimmed || undefined}>
      <button type="button" className="pero-ui-stepper-node" aria-pressed={item.id === value} aria-current={item.id === value ? 'step' : undefined}
        data-status={item.status ?? 'idle'} data-tone={item.tone} title={item.hint} onClick={() => onValueChange?.(item.id)}>
        <span className="pero-ui-stepper-head">{item.leading}{item.eyebrow != null && <span className="pero-ui-stepper-eyebrow">{item.eyebrow}</span>}{item.trailing != null && <span className="pero-ui-stepper-trailing">{item.trailing}</span>}</span>
        <strong>{item.title}</strong>
        {item.badge != null && <span className="pero-ui-stepper-badge">{item.badge}</span>}
        {item.footer != null && <span className="pero-ui-stepper-footer">{item.footer}</span>}
      </button>
    </li>)}
    {end && ends('end', end)}
  </ol>;
});
