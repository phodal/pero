import { useEffect, useRef, useState } from 'react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Field, Input, NativeSelect, Textarea } from '@pero/app-sdk/ui';
import type { PlateLayout } from '@pero/notebook/science-plate';
import { parsePlateDesign, type PlateDesignRecord, type PlateMetadata, type RecordPin } from '../../../packages/notebook/src/scientific-designs';
import { scientificError, scientificMessages } from './scientific-ui-shared';

export function PlateDesignLibrary({ layout, metadata, origin, onMetadata, onLoad, onOrigin }: {
  layout: PlateLayout; metadata: PlateMetadata; origin: RecordPin | null;
  onMetadata(value: PlateMetadata): void; onLoad(layout: PlateLayout, metadata: PlateMetadata, origin: RecordPin): void; onOrigin(origin: RecordPin): void;
}) {
  const api = useAppApi(), { t } = useAppI18n(scientificMessages);
  const [name, setName] = useState(''), [description, setDescription] = useState('');
  const [records, setRecords] = useState<PlateDesignRecord[] | null>(null), [choice, setChoice] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(true), pending = useRef(false), current = useRef('');
  const definition = { name, description, metadata, layout, origin };
  current.current = JSON.stringify(definition);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { if (alive.current) setError(scientificError(cause)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const refresh = async () => { const result = await api.get<{ records: PlateDesignRecord[] }>('/api/scientific/plates'); if (alive.current) setRecords(result.records); };
  const save = (revise: boolean) => run(async () => {
    const frozen = current.current, parsed = parsePlateDesign(definition);
    const record = await api.post<PlateDesignRecord>(revise && origin ? `/api/scientific/plates/${origin.id}/revisions` : '/api/scientific/plates', revise && origin ? { definition: parsed, expectedRevision: origin.revision } : { definition: parsed });
    if (!alive.current) return;
    if (current.current === frozen) onOrigin({ id: record.id, revision: record.revision });
    setRecords(previous => [record, ...(previous ?? []).filter(item => item.id !== record.id)]); setChoice(record.id);
    setNotice(`${t('savedDesign')}: ${record.definition.name} · ${record.id} · v${record.revision}`);
  });
  const load = () => run(async () => {
    const frozen = current.current;
    const record = await api.get<PlateDesignRecord>(`/api/scientific/plates/${choice}`);
    if (!alive.current) return;
    if (current.current !== frozen) throw new Error('Working plate changed during loading. Review it before loading again.');
    const design = parsePlateDesign(record.definition);
    onLoad(structuredClone(design.layout), structuredClone(design.metadata), { id: record.id, revision: record.revision });
    setName(design.name); setDescription(design.description); setConfirm(false);
  });
  return <details>
    <summary>{t('plateLibrary')}</summary>
    <p className="notebook-note">{t('plateScope')}</p>
    {origin && <p>{origin.id} · v{origin.revision}</p>}
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
      <div className="notebook-science-fields">
        <Field label={t('designName')}>{control => <Input {...control} value={name} maxLength={200} onChange={e => setName(e.target.value)} />}</Field>
        <Field label={t('barcode')}>{control => <Input {...control} value={metadata.barcode} maxLength={200} onChange={e => onMetadata({ ...metadata, barcode: e.target.value })} />}</Field>
        <Field label={t('plateType')}>{control => <Input {...control} value={metadata.plateType} maxLength={200} onChange={e => onMetadata({ ...metadata, plateType: e.target.value })} />}</Field>
        <Field label={t('capacity')}>{control => <Input {...control} type="number" min={0} max={1000000} value={metadata.wellVolumeMicroliters ?? ''} onChange={e => onMetadata({ ...metadata, wellVolumeMicroliters: e.target.value === '' ? null : Number(e.target.value) })} />}</Field>
      </div>
      <Field label={t('description')}>{control => <Textarea {...control} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} />}</Field>
      <fieldset style={{ border: '1px solid var(--pero-border)' }}><legend>{t('metadata')}</legend>
        {metadata.fields.map((field, index) => <div className="notebook-science-fields" key={index}>
          <Field label={`${t('key')} ${index + 1}`}>{control => <Input {...control} maxLength={64} value={field.key} onChange={e => onMetadata({ ...metadata, fields: metadata.fields.map((value, i) => i === index ? { ...value, key: e.target.value } : value) })} />}</Field>
          <Field label={`${t('value')} ${index + 1}`}>{control => <Input {...control} maxLength={500} value={field.value} onChange={e => onMetadata({ ...metadata, fields: metadata.fields.map((value, i) => i === index ? { ...value, value: e.target.value } : value) })} />}</Field>
          <Button onClick={() => onMetadata({ ...metadata, fields: metadata.fields.filter((_, i) => i !== index) })}>{t('removeField')} {index + 1}</Button>
        </div>)}
        <Button disabled={metadata.fields.length >= 24} onClick={() => onMetadata({ ...metadata, fields: [...metadata.fields, { key: '', value: '' }] })}>{t('addField')}</Button>
      </fieldset>
      <div className="notebook-science-actions">
        <Button disabled={!name.trim()} onClick={() => void save(false)}>{t('saveDesign')}</Button>
        <Button disabled={!origin || !name.trim()} onClick={() => void save(true)}>{t('updateDesign')}</Button>
        <Button onClick={() => void run(refresh)}>{t('loadDesigns')}</Button>
      </div>
      {records?.length === 0 && <p>{t('emptyLibrary')}</p>}
      {!!records?.length && <div className="notebook-science-actions">
        <Field label={t('selectDesign')}>{control => <NativeSelect {...control} value={choice} onChange={e => { setChoice(e.target.value); setConfirm(false); }}><option value="">{t('none')}</option>{records.map(record => <option key={record.id} value={record.id}>{record.definition.name} · v{record.revision}</option>)}</NativeSelect>}</Field>
        <Button disabled={!choice} onClick={() => setConfirm(true)}>{t('loadDesign')}</Button>
      </div>}
    </fieldset>
    {confirm && <div><p>{t('loadWarning')}</p><Button disabled={busy} onClick={() => void load()}>{t('confirmLoad')}</Button><Button disabled={busy} onClick={() => setConfirm(false)}>{t('cancel')}</Button></div>}
    {error && <Feedback kind="error">{error}</Feedback>}{notice && <Feedback kind="success">{notice}</Feedback>}
  </details>;
}
