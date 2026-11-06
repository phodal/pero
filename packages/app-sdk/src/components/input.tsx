// Upstream attribution and license: packages/app-sdk/NOTICE.md.
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

/** A compact native selector for short, form-bound choices; keeps the platform indicator. */
export const NativeSelect = forwardRef<HTMLSelectElement, React.ComponentPropsWithoutRef<'select'>>(function NativeSelect({className, ...props}, ref) {
  return <select {...props} className={['pero-ui-input', 'pero-ui-native-select', className].filter(Boolean).join(' ')} ref={node => {
    if (node) ensureUiStyles(node.ownerDocument);
    if (typeof ref === 'function') ref(node); else if (ref) ref.current = node;
  }}/>;
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
  accept?: string;
  /** Use in an AppBar when the current file already has its own selector. */
  compact?: boolean;
  variant?: React.ComponentProps<typeof Button>['variant'];
  title?: string;
  disabled?: boolean;
  busy?: boolean;
} & ({ multiple?: false; onFile(file: File): void } | { multiple: true; onFiles(files: File[]): void });

/** A translated native file choice. File validation and import belong to the App. */
export function FilePicker(props: FilePickerProps) {
  const {label, emptyLabel, accept, disabled, busy, compact, variant, title} = props;
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  return <div className="pero-ui-file-picker" data-compact={compact || undefined}>
    <input ref={input} type="file" multiple={props.multiple} aria-label={label} accept={accept} disabled={disabled || busy} hidden onChange={event => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (files.length) {
        setName(files.map(file => file.name).join(', '));
        if ('onFiles' in props) props.onFiles(files); else props.onFile(files[0]);
      }
    }}/>
    <Button variant={variant} title={title} disabled={disabled} busy={busy} onClick={() => input.current?.click()}>{label}</Button>
    <span className="pero-ui-file-name" role="status">{name || emptyLabel}</span>
  </div>;
}
