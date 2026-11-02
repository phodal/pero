// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { type ReactNode } from 'react';
import { ensureUiStyles } from './ui-styles';

/** Callers own the loading/error decision. Decorative placeholders never take focus. */
export function LoadingSkeleton({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <div className={['pero-ui-loading', 'pero-loading', className].filter(Boolean).join(' ')} ref={node => { if (node) ensureUiStyles(node.ownerDocument); }}>
    <p className="pero-ui-loading-label pero-loading-label" role="status">{label}</p>
    <div className="pero-ui-loading-shapes pero-loading-shapes" aria-hidden="true" aria-busy="true">{children}</div>
  </div>;
}

export type SkeletonBlockShape = 'line' | 'title' | 'icon' | 'surface';

export function SkeletonBlock({ width = '100%', shape = 'line' }: { width?: string; shape?: SkeletonBlockShape }) {
  return <span className={`pero-ui-skeleton-block pero-skeleton-block pero-skeleton-block--${shape} pero-ui-skeleton-block--${shape}`} style={{ width }} />;
}

export function SkeletonText() {
  return <div className="pero-ui-skeleton-text pero-skeleton-text"><SkeletonBlock width="86%" /><SkeletonBlock /><SkeletonBlock width="63%" /></div>;
}

export function SkeletonCards({ count = 2 }: { count?: number }) {
  return <div className="pero-ui-skeleton-cards pero-skeleton-cards">{Array.from({ length: count }, (_, i) => <div className="pero-ui-skeleton-card pero-skeleton-card" key={i}>
    <SkeletonBlock width="24%" /><SkeletonBlock shape="title" width={i % 2 ? '60%' : '76%'} /><SkeletonText />
    <div className="pero-ui-skeleton-footer pero-skeleton-footer"><SkeletonBlock width="32%" /><SkeletonBlock width="18%" /></div>
  </div>)}</div>;
}
