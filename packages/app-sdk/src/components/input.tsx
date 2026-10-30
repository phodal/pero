// Adapted from Point App SDK components/input.tsx.
import React, { forwardRef, useRef, useState } from 'react';
import { Button } from './button';

export type InputProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'type'> & {
  type?: 'text' | 'search' | 'url' | 'tel' | 'email' | 'password' | 'number' | 'date' | 'datetime-local' | 'month' | 'week' | 'time';
};
export type TextareaProps = React.ComponentPropsWithoutRef<'textarea'>;

/** Text-like native inputs; checkbox, radio and other control families keep their own semantics. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...props }, ref) {
  return <input {...props} className={['pero-ui-input', className].filter(Boolean).join(' ')}
    ref={ref} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, ...props }, ref) {
  return <textarea {...props} className={['pero-ui-input', className].filter(Boolean).join(' ')}
    ref={ref} />;
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
