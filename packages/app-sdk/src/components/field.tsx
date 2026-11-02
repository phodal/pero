// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { useId } from 'react';
import { Feedback } from './feedback';
import { ensureUiStyles } from './ui-styles';

export type FieldControlProps = { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true };
export type FieldProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> & {
  controlId?: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  unstyled?: boolean;
  /** Apply these attributes to exactly one labelable control (native or composed). */
  children: (control: FieldControlProps) => React.ReactNode;
};

export function Field({ controlId, label, description, error, unstyled, className, children, ...props }: FieldProps) {
  const generatedId = useId();
  const id = controlId ?? generatedId;
  const hasDescription = description != null && description !== false && description !== '';
  const hasError = error != null && error !== false && error !== '';
  const descriptionId = `${id}-description`, errorId = `${id}-error`;
  return <div {...props} className={['pero-ui-field', className].filter(Boolean).join(' ')} data-unstyled={unstyled || undefined}
    ref={node => { if (node) ensureUiStyles(node.ownerDocument); }}>
    <label htmlFor={id}>{label}</label>
    {children({ id, 'aria-describedby': [hasDescription && descriptionId, hasError && errorId].filter(Boolean).join(' ') || undefined, 'aria-invalid': hasError ? true : undefined })}
    {hasDescription && <small id={descriptionId}>{description}</small>}
    {hasError && <Feedback id={errorId} kind="error">{error}</Feedback>}
  </div>;
}
