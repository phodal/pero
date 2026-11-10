import { useEffect, useRef, useState } from 'react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Disclosure, Feedback, Field, Input, Select } from '@pero/app-sdk/ui';
import { collectionDestinations, collectionPath, type TemplateCollectionLibrary, type TemplateCollectionChange, type TemplateCollectionHistory } from '@pero/notebook/template-collections';

const messages = {
  collections: { en: 'Template collections', zh: '模板集合' }, all: { en: 'All templates', zh: '全部模板' }, root: { en: 'Library root', zh: '模板库根目录' },
  create: { en: 'Create collection', zh: '创建集合' }, rename: { en: 'Rename collection', zh: '重命名集合' }, move: { en: 'Move collection', zh: '移动集合' },
  assign: { en: 'Move selected template', zh: '移动所选模板' }, name: { en: 'Collection name', zh: '集合名称' }, destination: { en: 'Destination', zh: '目标位置' },
  confirm: { en: 'Confirm organization change', zh: '确认调整组织结构' }, cancel: { en: 'Cancel', zh: '取消' }, close: { en: 'Close', zh: '关闭' },
  history: { en: 'Collection history', zh: '集合历史' }, loading: { en: 'Loading collections…', zh: '正在加载集合…' }, reload: { en: 'Reload collections', zh: '重新加载集合' },
  scope: { en: 'Moves keep template identities and published revisions unchanged.', zh: '移动操作保留模板身份及已发布版本。' },
  emptyHistory: { en: 'No organization changes yet.', zh: '尚未调整组织结构。' }, revision: { en: 'Revision {revision}', zh: '版本 {revision}' },
};

export function TemplateCollections({ templateId, selected, onSelect, onLibrary }: {
  templateId?: string; selected: string; onSelect(id: string): void; onLibrary(library: TemplateCollectionLibrary): void;
}) {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const [library, setLibrary] = useState<TemplateCollectionLibrary | null>(null), [history, setHistory] = useState<TemplateCollectionHistory[] | null>(null);
  const [form, setForm] = useState<TemplateCollectionChange | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const receive = (value: TemplateCollectionLibrary) => { setLibrary(value); onLibrary(value); };
  const run = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await work(); } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const reload = () => run(async () => { const result = await api.get<TemplateCollectionLibrary>('/api/template-collections'); if (alive.current) receive(result); });
  useEffect(() => { void reload(); }, [api]);
  const path = (id: string) => collectionPath(library?.collections ?? [], id).map(item => item.name).join(' / ');
  const current = library?.collections.find(item => item.id === selected);
  const apply = () => run(async () => {
    if (!library || !form) return;
    const result = await api.post<TemplateCollectionLibrary>('/api/template-collections', { expectedRevision: library.revision, change: form });
    if (alive.current) { receive(result); setForm(null); setHistory(null); }
  });
  return <section aria-label={t('collections')}>
    {error && !form && <Feedback kind="error">{error}<Button disabled={busy} onClick={() => void reload()}>{t('reload')}</Button></Feedback>}
    {!library && !error && <p role="status">{t('loading')}</p>}
    {library && <>
      <Select label={t('collections')} value={selected} disabled={busy} options={[{ value: '', label: t('all') }, ...collectionDestinations(library.collections).map(item => ({ value: item.id, label: path(item.id) }))]} onChange={onSelect} />
      <div className="notebook-template-actions">
        <Button disabled={busy} onClick={() => setForm({ type: 'create', name: '', parentId: selected || null })}>{t('create')}</Button>
        {current && <><Button disabled={busy} onClick={() => setForm({ type: 'rename', id: current.id, name: current.name })}>{t('rename')}</Button>
          <Button disabled={busy} onClick={() => setForm({ type: 'move', id: current.id, parentId: current.parentId })}>{t('move')}</Button></>}
        {templateId && <Button disabled={busy} onClick={() => setForm({ type: 'assign-template', templateId, collectionId: library.memberships[templateId] ?? null })}>{t('assign')}</Button>}
        <Button disabled={busy} onClick={() => void run(async () => { const response = await api.get<{ history: TemplateCollectionHistory[] }>('/api/template-collections/history'); if (alive.current) setHistory(response.history); })}>{t('history')}</Button>
      </div>
      {history && <Disclosure summary={t('history')} defaultOpen>{!history.length ? <p>{t('emptyHistory')}</p> : <ol>{history.map(item => <li key={item.revision}>{t('revision', { revision: item.revision })} · {item.occurredAt} · {t(item.change.type === 'assign-template' ? 'assign' : item.change.type)} · {item.subject}{item.change.type !== 'rename' ? ` → ${item.destination.join(' / ') || t('root')}` : ''}</li>)}</ol>}</Disclosure>}
    </>}
    {form && library && <Dialog title={t(form.type === 'assign-template' ? 'assign' : form.type)} closeLabel={t('close')} onClose={() => setForm(null)}>
      <p>{t('scope')}</p>
      {error && <Feedback kind="error">{error}<Button disabled={busy} onClick={() => void reload()}>{t('reload')}</Button></Feedback>}
      {'name' in form && <Field label={t('name')}>{control => <Input {...control} value={form.name} disabled={busy} maxLength={100} onChange={event => setForm({ ...form, name: event.target.value })} />}</Field>}
      {form.type !== 'rename' && <Select label={t('destination')} value={(form.type === 'assign-template' ? form.collectionId : form.parentId) ?? ''} disabled={busy}
        options={[{ value: '', label: t('root') }, ...collectionDestinations(library.collections, form.type === 'move' ? form.id : undefined).map(item => ({ value: item.id, label: path(item.id) }))]}
        onChange={value => setForm(form.type === 'assign-template' ? { ...form, collectionId: value || null } : { ...form, parentId: value || null })} />}
      <Button disabled={busy} onClick={() => setForm(null)}>{t('cancel')}</Button><Button variant="primary" busy={busy} disabled={'name' in form && !form.name.trim()} onClick={() => void apply()}>{t('confirm')}</Button>
    </Dialog>}
  </section>;
}
