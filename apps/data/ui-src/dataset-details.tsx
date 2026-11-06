import { useState } from 'react';
import { Dialog, Feedback, Input } from '@pero/app-sdk/ui';
import type { Dataset } from './model';
import { DataForm, SubmitButton } from './submit-button';

/** Metadata edits keep the sandbox-safe form submission owned by Data. */
export function DatasetDetails({ dataset, busy, error, onSave, onClose }: {
  dataset: Dataset; busy: boolean; error: string;
  onSave(value: { name: string; projectRef: string; archived: boolean }): Promise<boolean>;
  onClose(): void;
}) {
  const [saved, setSaved] = useState(false);
  return <Dialog title="Dataset details" closeLabel="Close details" onClose={() => { if (!busy) onClose(); }}
    onKeyDown={event => { if (busy && event.key === 'Escape') event.preventDefault(); }}>
    <DataForm className="data-form" onChange={() => setSaved(false)} onSubmit={event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      setSaved(false);
      void onSave({ name: String(values.get('name')), projectRef: String(values.get('projectRef')), archived: dataset.archived }).then(setSaved);
    }}>
      <label>Name<Input name="name" defaultValue={dataset.name} maxLength={200} required disabled={busy} /></label>
      <label>Project reference<Input name="projectRef" defaultValue={dataset.projectRef} maxLength={200} disabled={busy} /></label>
      <p className="data-note">A reference only, not a project permission boundary.</p>
      {saved ? <p role="status">Details saved.</p> : null}
      {error ? <Feedback kind="error">{error}</Feedback> : null}
      <SubmitButton disabled={busy}>{busy ? 'Saving…' : 'Save details'}</SubmitButton>
    </DataForm>
  </Dialog>;
}
