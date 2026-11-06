import React from 'react';
import { Icon } from './icon';
import { ensureUiStyles } from './ui-styles';

export type EmptyIllustrationKind = 'documents' | 'data' | 'environment' | 'connections' | 'brief' | 'search' | 'compute';
export type EmptyIllustrationProps = {
  kind: EmptyIllustrationKind;
  size?: 'regular' | 'compact';
  className?: string;
};

const symbols: Record<EmptyIllustrationKind, string> = {
  documents: 'skill', data: 'table', environment: 'server', connections: 'connector',
  brief: 'list', search: 'search', compute: 'nodes',
};

/** Decorative artwork for loaded-empty content. Loading and recovery belong to the caller. */
export function EmptyIllustration({ kind, size = 'regular', className }: EmptyIllustrationProps) {
  return <svg viewBox="0 0 144 104" width={size === 'compact' ? 72 : 144} height={size === 'compact' ? 52 : 104}
    className={['pero-ui-empty-illustration', className].filter(Boolean).join(' ')}
    aria-hidden="true" focusable="false" fill="none"
    ref={node => { if (node) ensureUiStyles(node.ownerDocument); }}>
    <ellipse cx="72" cy="54" rx="65" ry="44" fill="var(--pero-tint-blue-surface)" />
    <rect x="26" y="15" width="91" height="65" rx="10" transform="rotate(8 72 48)" fill="var(--pero-tint-blue-soft)" />
    <rect x="18" y="26" width="108" height="64" rx="10" fill="var(--pero-surface)" stroke="var(--pero-border)" />
    <rect x="29" y="38" width="39" height="39" rx="10" fill="var(--pero-accent-soft)" />
    <Icon name={symbols[kind]} x="37" y="46" width="23" height="23" color="var(--pero-accent-text)" />
    <path d="M80 45h31M80 57h23M80 69h16" stroke="var(--pero-tint-blue-soft)" strokeWidth="5" strokeLinecap="round" />
    <circle cx="121" cy="22" r="4" fill="var(--pero-tint-blue-text)" opacity=".35" />
    <path d="M16 17v8m-4-4h8" stroke="var(--pero-accent-text)" strokeWidth="2" strokeLinecap="round" opacity=".5" />
  </svg>;
}
