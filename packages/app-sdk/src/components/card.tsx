// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { Button } from './button';
import { ensureUiStyles } from './ui-styles';

export type CardProps = React.ComponentPropsWithoutRef<'div'> & {
  asChild?: boolean;
  unstyled?: boolean;
  tone?: 'neutral' | 'blue' | 'apricot';
  variant?: 'outline' | 'soft';
};

/** Decorative frame. Callers keep the native tag, title, and actions.
 * Compositions may set --pero-card-padding / --pero-card-background / --pero-card-border-color / --pero-card-radius; the frame stays shared. */
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

/** A directory entry keeps identity and prerequisites above the preview, with independent actions below. */
export function CatalogCard({ icon, title, subtitle, description, detail, metadata, status, action, onOpen, className }: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  detail?: React.ReactNode;
  metadata?: React.ReactNode;
  status?: React.ReactNode;
  action?: React.ReactNode;
  onOpen?: () => void;
  className?: string;
}) {
  return <Card asChild className={`pero-catalog-card ${className ?? ''}`}>
    <article>
      <header className="pero-catalog-identity">
        <span className="pero-catalog-icon" aria-hidden="true">{icon}</span>
        <div className="pero-catalog-heading">
          <div className="pero-catalog-title">
            <h3>{onOpen ? <Button variant="ghost" onClick={onOpen}>{title}</Button> : title}</h3>
            {detail}
          </div>
          <span className="pero-catalog-subtitle" title={subtitle}>{subtitle}</span>
        </div>
      </header>
      <p className="pero-catalog-description" title={description}>{description}</p>
      {metadata && <div className="pero-catalog-metadata">{metadata}</div>}
      <footer className="pero-catalog-actions">{status}{action}</footer>
    </article>
  </Card>;
}
