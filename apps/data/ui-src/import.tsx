import { useEffect, useRef, useState } from 'react';
import { Button, Feedback, FilePicker, Input } from '@pero/app-sdk/ui';
import { FormSelect } from './form-select';
import { SubmitButton } from './submit-button';
import { formatBytes, type CatalogState, type Dataset } from './model';

export type ImportDetails = { kind: 'dataset' | 'model'; source: string; license: string; projectRef: string };
export function ImportDialog({ state, target, busy, error, onClose, onImport, onDownload }: {
  state: CatalogState; target: Dataset | null; busy: boolean; error: string; onClose(): void;
  onImport(file: File, details: ImportDetails): void; onDownload(sourceId: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const fileError = file && (!file.size || file.size > state.limits.importBytes) ? `Choose a file between 1 byte and ${formatBytes(state.limits.importBytes)}.` : '';
  return <dialog ref={dialog} className="data-add" aria-labelledby="data-add-title" onClose={onClose} onCancel={event => { if (busy) event.preventDefault(); }}>
    <header><h2 id="data-add-title">{target ? 'Add version' : 'Add data'}</h2><Button onClick={onClose} disabled={busy}>Close</Button></header>
    {target ? <p>New version of {target.name}. Existing versions stay unchanged.</p> : null}
    <form onSubmit={event => {
      event.preventDefault(); if (!file || fileError) return;
      const values = new FormData(event.currentTarget);
      onImport(file, { kind: target?.kind ?? (values.get('kind') === 'model' ? 'model' : 'dataset'),
        source: String(values.get('source') || 'Local files'), license: String(values.get('license') || 'Unknown'),
        projectRef: target?.projectRef ?? String(values.get('projectRef') || '') });
    }}>
      <FilePicker label="Choose file" emptyLabel="No file chosen" accept="" disabled={busy} onFile={setFile} />
      <p>Files up to {formatBytes(state.limits.importBytes)}. CSV, TSV, JSON and JSONL support preview; other formats remain opaque.</p>
      {!target ? <label>Type<FormSelect name="kind" label="Type" defaultValue="dataset" disabled={busy}
        options={[{ value: 'dataset', label: 'Dataset' }, { value: 'model', label: 'Model' }]} /></label> : null}
      <label>Source<Input name="source" defaultValue="Local files" maxLength={300} disabled={busy} /></label>
      <label>License<Input name="license" defaultValue="Unknown" maxLength={300} disabled={busy} /></label>
      {!target ? <label>Project reference<Input name="projectRef" maxLength={200} disabled={busy} /></label> : null}
      {fileError || error ? <Feedback kind="error">{fileError || error}</Feedback> : null}
      <SubmitButton variant="primary" disabled={busy || !file || Boolean(fileError)}>{busy ? 'Saving…' : 'Import'}</SubmitButton>
    </form>
    {!target && state.sources.length ? <details className="data-sources"><summary>Public sources</summary>
      {state.sources.map(source => <section key={source.id}><h3>{source.name}</h3>
        <p>{formatBytes(source.size)} / {source.license}</p><p>{source.sourceUrl}</p><code>{source.revision}</code>
        <Button onClick={() => onDownload(source.id)} disabled={busy || state.download?.status === 'running'}>Download {source.name}</Button>
      </section>)}
    </details> : null}
  </dialog>;
}
