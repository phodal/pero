import { useState } from 'react';
import { Button, Field, Input } from './ui';

/** A bounded owner-declared form, never arbitrary App HTML, URLs or execution. */
export interface CanvasAction {
  name: string;
  label: string;
  params: Record<string, unknown>;
  inputs?: { name: string; label: string; maxLength: number }[];
}
export function CanvasActionForm({ action, disabled, primary = false, onSubmit }: {
  action: CanvasAction; disabled: boolean; primary?: boolean; onSubmit(action: CanvasAction): void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  return <div className="pero-app-canvas-action">{action.inputs?.map(input => <Field key={input.name} label={input.label}>{control =>
    <Input {...control} value={Object.hasOwn(draft, input.name) ? draft[input.name] : String(action.params[input.name] ?? '')}
      maxLength={input.maxLength} disabled={disabled} onChange={event => setDraft(current => ({ ...current, [input.name]: event.target.value }))} />
  }</Field>)}<Button variant={primary ? 'primary' : 'secondary'} disabled={disabled} onClick={() => onSubmit({ ...action, params: { ...action.params, ...draft } })}>{action.label}</Button></div>;
}
