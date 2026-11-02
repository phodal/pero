// Adapted from Point App SDK d95f9118e (Apache-2.0).
import React, { forwardRef, useRef, useState } from 'react';
import { Button } from './button';
import { ensureUiStyles } from './ui-styles';

export type InputProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'type'> & {
  type?: 'text' | 'search' | 'url' | 'tel' | 'email' | 'password' | 'number' | 'date' | 'datetime-local' | 'month' | 'week' | 'time';
  unstyled?: boolean;
};
export type TextareaProps = React.ComponentPropsWithoutRef<'textarea'> & { unstyled?: boolean };

/** Native multi-selection retains selectedOptions, form validation and platform keyboard semantics. */
export type MultiSelectProps = Omit<React.ComponentPropsWithoutRef<'select'>, 'multiple'>;
export const MultiSelect = forwardRef<HTMLSelectElement, MultiSelectProps>(function MultiSelect({ className, ...props }, ref) {
  return <select {...props} multiple className={['pero-ui-input', className].filter(Boolean).join(' ')}
    ref={node => {
      if (node) ensureUiStyles(node.ownerDocument);
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }} />;
});

/** Text-like native inputs; checkbox, radio and other control families keep their own semantics. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ unstyled, className, ...props }, ref) {
  return <input {...props} className={['pero-ui-input', className].filter(Boolean).join(' ')} data-unstyled={unstyled || undefined}
    ref={node => {
      if (node) ensureUiStyles(node.ownerDocument);
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ unstyled, className, ...props }, ref) {
  return <textarea {...props} className={['pero-ui-textarea', className].filter(Boolean).join(' ')} data-unstyled={unstyled || undefined}
    ref={node => {
      if (node) ensureUiStyles(node.ownerDocument);
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }} />;
});

export type FilePickerProps = {
  label: string;
  emptyLabel: string;
  accept: string;
  disabled?: boolean;
  busy?: boolean;
  onFile(file: File): void;
};

/** A translated native file choice. File validation and import belong to the App. */
export function FilePicker({ label, emptyLabel, accept, disabled, busy, onFile }: FilePickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  return <div className="pero-ui-file-picker">
    <input ref={input} type="file" aria-label={label} accept={accept} disabled={disabled || busy} hidden onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) { setName(file.name); onFile(file); }
    }}/>
    <Button disabled={disabled} busy={busy} onClick={() => input.current?.click()}>{label}</Button>
    <span className="pero-ui-file-name" role="status">{name || emptyLabel}</span>
  </div>;
}
