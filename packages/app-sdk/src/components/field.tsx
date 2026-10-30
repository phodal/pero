// Adapted from Point App SDK components/field.tsx.
import React, { useId } from 'react';
import { Feedback } from './feedback';

export type FieldControlProps = { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true };
export type FieldProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> & {
  controlId?: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  /** Apply these attributes to exactly one labelable control (native or composed). */
  children: (control: FieldControlProps) => React.ReactNode;
};

export function Field({ controlId, label, description, error, className, children, ...props }: FieldProps) {
  const generatedId = useId();
  const id = controlId ?? generatedId;
  const hasDescription = description != null && description !== false && description !== '';
  const hasError = error != null && error !== false && error !== '';
  const descriptionId = `${id}-description`, errorId = `${id}-error`;
  return <div {...props} className={['pero-ui-field', className].filter(Boolean).join(' ')}>
    <label htmlFor={id}>{label}</label>
    {children({ id, 'aria-describedby': [hasDescription && descriptionId, hasError && errorId].filter(Boolean).join(' ') || undefined, 'aria-invalid': hasError ? true : undefined })}
    {hasDescription && <small id={descriptionId}>{description}</small>}
    {hasError && <Feedback id={errorId} kind="error">{error}</Feedback>}
  </div>;
}
