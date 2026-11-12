import { useId, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Card, Dialog, Disclosure, Feedback, Field, FilePicker, Input, Select } from '@pero/app-sdk/ui';
import { DataForm, SubmitButton } from './submit-button';
import { formatBytes, type CatalogState, type Dataset } from './model';
import { messages } from './i18n';

export type ImportDetails = { kind: 'dataset' | 'model'; source: string; license: string; projectRef: string };
export function ImportDialog({ state, target, busy, error, onClose, onImport, onDownload }: {
  state: CatalogState; target: Dataset | null; busy: boolean; error: string; onClose(): void;
  onImport(file: File, details: ImportDetails): void; onDownload(sourceId: string): void;
}) {
  const { t } = useAppI18n(messages), formId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState(target?.kind ?? 'dataset');
  const fileError = file && (!file.size || file.size > state.limits.importBytes) ? t('fileError', { limit: formatBytes(state.limits.importBytes) }) : '';
  return <Dialog className="data-add" title={t(target ? 'addVersion' : 'addData')} closeLabel={t('close')}
    initialFocus=".pero-ui-file-picker button" onClose={() => { if (!busy) onClose(); }}
    footer={<><Button disabled={busy} onClick={onClose}>{t('cancel')}</Button>
      <SubmitButton form={formId} variant="primary" disabled={busy || !file || Boolean(fileError)}>{t(busy ? 'saving' : 'import')}</SubmitButton></>}
    onKeyDown={event => { if (busy && event.key === 'Escape') event.preventDefault(); }} onCancel={event => { if (busy) event.preventDefault(); }}>
    {target ? <p>{t('versionHelp', { name: target.name })}</p> : <p>{t('separateDataset')}</p>}
    <DataForm id={formId} onSubmit={event => {
      event.preventDefault(); if (!file || fileError) return;
      const values = new FormData(event.currentTarget);
      onImport(file, { kind: target?.kind ?? (values.get('kind') === 'model' ? 'model' : 'dataset'),
        source: String(values.get('source') || 'Local files'), license: String(values.get('license') || 'Unknown'),
        projectRef: target?.projectRef ?? String(values.get('projectRef') || '') });
    }}>
      <Card tone="blue" variant="soft" className="data-import-file">
        <h3>{t('file')}</h3>
        <FilePicker label={t('chooseFile')} emptyLabel={t('noFile')} accept="" disabled={busy} onFile={setFile} />
        <p>{t('fileHelp', { limit: formatBytes(state.limits.importBytes) })}</p>
      </Card>
      {!target ? <Field label={t('type')} description={t(kind === 'model' ? 'modelHelp' : 'datasetHelp')}>
        {control => <Select {...control} name="kind" label={t('type')} value={kind} onChange={value => setKind(value === 'model' ? 'model' : 'dataset')} disabled={busy}
          options={[{ value: 'dataset', label: t('dataset') }, { value: 'model', label: t('model') }]} />}
      </Field> : <p>{t(kind === 'model' ? 'modelHelp' : 'datasetHelp')}</p>}
      <Disclosure summary={t('metadata')} className="data-import-metadata">
        <p>{t('metadataHelp')}</p>
        <Field label={t('source')}>{control => <Input {...control} name="source" placeholder={t('localFiles')} maxLength={300} disabled={busy} />}</Field>
        <Field label={t('license')}>{control => <Input {...control} name="license" placeholder={t('unknownLicense')} maxLength={300} disabled={busy} />}</Field>
        {!target ? <Field label={t('projectRef')} description={t('projectHelp')}>{control => <Input {...control} name="projectRef" maxLength={200} disabled={busy} />}</Field> : null}
      </Disclosure>
      {fileError || error ? <Feedback kind="error">{fileError || <>{t('requestFailed')}<Disclosure variant="inline" summary={<>{t('errorDetails')}</>}>{error}</Disclosure></>}</Feedback> : null}
    </DataForm>
    {!target && state.sources.length ? <Disclosure className="data-sources" summary={t('publicSources')}>
      {state.sources.map(source => <section key={source.id}><h3>{source.name}</h3>
        <p>{formatBytes(source.size)} / {source.license}</p><p>{source.sourceUrl}</p><code>{source.revision}</code>
        <Button onClick={() => onDownload(source.id)} disabled={busy || state.download?.status === 'running'}>{t('downloadSource', { name: source.name })}</Button>
      </section>)}
    </Disclosure> : null}
  </Dialog>;
}
