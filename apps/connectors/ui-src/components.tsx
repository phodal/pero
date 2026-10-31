import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@pero/app-sdk/ui';

export function ActionPortal({ target, children }: { target?: HTMLElement | null; children: React.ReactNode }) { return target === undefined ? children : target ? createPortal(children, target) : null; }

/** Browser modal behavior owns focus trapping and Escape; feature code owns actions. */
export function Dialog({ title, children, footer, footerStart, onClose, closeLabel = 'Close', className = '', size = 'md', initialFocus }: {
  title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; footerStart?: React.ReactNode; onClose(): void;
  closeLabel?: string; className?: string; size?: 'sm' | 'md' | 'lg'; initialFocus?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    if (initialFocus) dialog.current?.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => { dialog.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className={`point-dialog ${className}`} data-size={size} aria-labelledby={id}
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="point-dialog-frame"><header className="point-dialog-head"><h2 id={id}>{title}</h2><Button variant="ghost" className="point-dialog-close" aria-label={closeLabel} onClick={onClose}>×</Button></header>
      <div className="point-dialog-body">{children}</div>{(footer || footerStart) && <footer className="point-dialog-foot">{footerStart && <div style={{ marginRight: 'auto' }}>{footerStart}</div>}{footer}</footer>}
    </div>
  </dialog>, document.body);
}

export type MenuEntry = { label: string; disabled?: boolean; danger?: boolean; onSelect(): void };
export function Menu({ label, items }: { label: string; items: MenuEntry[]; triggerVariant?: string }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div className="connector-menu" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && open) {
      event.preventDefault(); const entries = [...root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
      const current = entries.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : current < 0 ? (event.key === 'ArrowUp' ? entries.length - 1 : 0) : (current + (event.key === 'ArrowUp' ? -1 : 1) + entries.length) % entries.length;
      entries[next]?.focus();
    }
  }}><Button ref={button} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>{label}</Button>
    {open && <div role="menu">{items.map((item, index) => <button key={index} role="menuitem" type="button" disabled={item.disabled} data-danger={item.danger} onClick={() => { setOpen(false); button.current?.focus(); item.onSelect(); }}>{item.label}</button>)}</div>}
  </div>;
}
export function StatusBadge({ state, children, className = '', dotClassName = '' }: { state: string; children: React.ReactNode; className?: string; dotClassName?: string }) {
  return <span className={className} data-state={state}><span className={dotClassName} aria-hidden="true"/>{children}</span>;
}
