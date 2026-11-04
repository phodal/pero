import React from 'react';
import { createPortal } from 'react-dom';

/** Renders into a dialog footer slot when that slot exists; otherwise inline. */
export function ActionPortal({ target, children }: { target?: HTMLElement | null; children: React.ReactNode }) {
  return target === undefined ? children : target ? createPortal(children, target) : null;
}

/** Connection state chip. The label is the accessible name; the dot is decorative. */
export function StatusBadge({ state, children, className = '', dotClassName = '' }: { state: string; children: React.ReactNode; className?: string; dotClassName?: string }) {
  return <span className={className} data-state={state}><span className={dotClassName} aria-hidden="true"/>{children}</span>;
}
