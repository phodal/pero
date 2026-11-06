// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { ensureUiStyles } from './ui-styles';

export type CardProps = React.ComponentPropsWithoutRef<'div'> & {
  asChild?: boolean;
  unstyled?: boolean;
  tone?: 'neutral' | 'blue' | 'apricot';
  variant?: 'outline' | 'soft';
};

/** Decorative frame. Callers keep the native tag, title, and actions.
 * Compositions may set --pero-card-padding / --pero-card-background / --pero-card-border-color; the frame stays shared. */
export const Card = forwardRef<HTMLElement, CardProps>(function Card({ asChild, unstyled, tone = 'neutral', variant = 'outline', className, ...props }, ref) {
  const Surface = asChild ? Slot : 'div';
  return <Surface {...props} className={['pero-ui-card', className].filter(Boolean).join(' ')} data-unstyled={unstyled || undefined} data-tone={tone} data-variant={variant}
    ref={node => {
      if (node) ensureUiStyles(node.ownerDocument);
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }} />;
});

export type CardHeaderProps = React.ComponentPropsWithoutRef<'div'> & {
  tone?: 'neutral' | 'blue' | 'apricot';
  actions?: React.ReactNode;
  unstyled?: boolean;
};

/** Heading row with an optional actions slot. No title level, region, or busy state. */
export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(function CardHeader({ actions, tone = 'neutral', unstyled, className, children, ...props }, ref) {
  return <div {...props} data-tone={tone} className={['pero-ui-card-header', className].filter(Boolean).join(' ')} data-unstyled={unstyled || undefined}
    ref={node => {
      if (node) ensureUiStyles(node.ownerDocument);
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }}>
    {children}
    {actions != null && actions !== false && <div className="pero-ui-card-actions" data-unstyled={unstyled || undefined}>{actions}</div>}
  </div>;
});
