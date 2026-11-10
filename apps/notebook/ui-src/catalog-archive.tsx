import { useEffect, useRef, useState } from 'react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Disclosure, Feedback, Field, Select, Textarea } from '@pero/app-sdk/ui';
import type { RegistrationReceipt } from '@pero/notebook/structured-table';
import type { CatalogArchiveState } from '@pero/notebook/table-workflows';

const messages = {
  record: { en: 'Registered record', zh: '已登记记录' }, empty: { en: 'This table has no local registration receipts.', zh: '此表尚无本地登记回执。' },
  foreign: { en: 'This receipt belongs to another local catalog. Its record cannot be archived here.', zh: '此回执属于另一个本地目录，无法在此归档其记录。' },
  scope: { en: 'Archive removes the current local record from catalog queries. Prior record versions, saved snapshots and registration receipts remain unchanged. Restore makes it available again.', zh: '归档会从目录查询中隐藏当前本地记录。历史版本、已保存快照和登记回执不变；恢复后可再次查询。' },
  load: { en: 'Load record status', zh: '加载记录状态' }, archived: { en: 'Archived', zh: '已归档' }, active: { en: 'Active', zh: '有效' },
  reason: { en: 'Reason for this change', zh: '更改原因' }, archive: { en: 'Confirm archive', zh: '确认归档' }, restore: { en: 'Confirm restore', zh: '确认恢复' },
  history: { en: 'Archive history', zh: '归档历史' }, version: { en: 'Current record version {version}', zh: '当前记录版本 {version}' },
};

export function CatalogArchivePanel({ receipts, editable }: { receipts: RegistrationReceipt[]; editable: boolean }) {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const targets = [...new Map(receipts.flatMap(receipt => receipt.records.map(record => [`${receipt.catalogId}:${record.recordId}`, { catalogId: receipt.catalogId, recordId: record.recordId }] as const))).entries()];
  const ids = targets.map(([key]) => key);
  const [selected, setSelected] = useState<string>(ids[0] ?? ''), [record, setRecord] = useState<CatalogArchiveState | null>(null);
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), alive = useRef(true), pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const load = async (archive = false) => {
    if (pending.current || !selected) return;
    const target = targets.find(([key]) => key === selected)![1];
    const request = ++generation.current;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = archive && record ? await api.post<CatalogArchiveState>(`/api/catalog/records/${target.recordId}/archive`, {
        expectedVersion: record.record.version, expectedArchiveRevision: record.archiveRevision, archived: !record.archived, reason,
      }) : await api.get<CatalogArchiveState>(`/api/catalog/records/${target.recordId}`);
      if (result.catalogId !== target.catalogId) throw new Error(t('foreign'));
      if (alive.current && request === generation.current) { setRecord(result); if (archive) setReason(''); }
    } catch (cause) { if (alive.current && request === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; if (alive.current && request === generation.current) setBusy(false); }
  };
  return <section>
    <p>{t('scope')}</p>
    {!ids.length ? <p>{t('empty')}</p> : <>
      <Select label={t('record')} value={selected} disabled={busy} options={targets.map(([key, target]) => ({ value: key, label: `${target.recordId} · ${target.catalogId}` }))} onChange={id => { setSelected(id); setRecord(null); setReason(''); setError(''); generation.current++; }} />
      <Button busy={busy} onClick={() => void load()}>{t('load')}</Button>
      {record && <>
        <p><strong>{record.record.name}</strong> · {t('version', { version: record.record.version })} <Badge>{t(record.archived ? 'archived' : 'active')}</Badge></p>
        <Field label={t('reason')}>{control => <Textarea {...control} disabled={busy || !editable} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />}</Field>
        <Button variant="primary" disabled={!editable || !reason.trim()} busy={busy} onClick={() => void load(true)}>{t(record.archived ? 'restore' : 'archive')}</Button>
        {!!record.history.length && <Disclosure summary={t('history')}><ol>{record.history.map(event => <li key={event.revision}>{event.occurredAt} · {t(event.archived ? 'archived' : 'active')} · {event.reason}</li>)}</ol></Disclosure>}
      </>}
    </>}
    {error && <Feedback kind="error">{error}</Feedback>}
  </section>;
}
