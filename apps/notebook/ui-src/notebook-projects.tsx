import { useEffect, useRef, useState } from 'react';
import { useAppI18n, cancelNotebookProjectLink, listNotebookProjects, setNotebookProjectLink, type NotebookProjectCatalog } from '@pero/app-sdk';
import { Badge, Button, Feedback, Field, NativeSelect } from '@pero/app-sdk/ui';

const messages = {
  region: { en: 'Host project associations', zh: 'Host 项目关联' },
  scope: { en: 'Link this saved Notebook revision to a real Host project. This does not change project members, permissions, or Notebook display labels.', zh: '将已保存笔记版本关联到真实 Host 项目，不改变项目成员、权限或笔记显示标签。' },
  reload: { en: 'Reload Host projects', zh: '重新载入 Host 项目' },
  loading: { en: 'Loading Host projects…', zh: '正在载入 Host 项目…' },
  staleList: { en: 'Previous project list is not verified as current.', zh: '上次项目列表尚未确认是最新状态。' },
  empty: { en: 'No Host projects. Create a research project in the workbench first.', zh: '暂无 Host 项目，请先在工作台创建研究项目。' },
  project: { en: 'Host project', zh: 'Host 项目' },
  choose: { en: 'Choose a Host project', zh: '选择 Host 项目' },
  linkedProjects: { en: 'Linked projects: {names}', zh: '已关联项目：{names}' },
  none: { en: 'None', zh: '无' },
  readonly: { en: 'Read-only Notebook view. Project changes are unavailable.', zh: '只读笔记视图，不可变更项目关联。' },
  dirty: { en: 'Publish the current draft before associating its saved revision.', zh: '请先发布当前草稿，再关联已保存版本。' },
  loadRevision: { en: 'Load the current saved Notebook revision before changing associations.', zh: '请先载入当前已保存笔记版本再修改关联。' },
  linkedRevision: { en: 'Linked v{revision}', zh: '已关联版本 {revision}' },
  update: { en: 'Update linked revision', zh: '更新关联版本' },
  link: { en: 'Link saved entry', zh: '关联已保存条目' },
  unlink: { en: 'Unlink entry', zh: '解除条目关联' },
  linkedVersion: { en: 'linked v{revision}', zh: '关联版本 {revision}' },
  unavailable: { en: 'Entry unavailable', zh: '条目不可用' },
  current: { en: 'Current v{revision}', zh: '当前版本 {revision}' },
  noEntries: { en: 'No Notebook entries linked to this project.', zh: '此项目尚未关联笔记条目。' },
  waiting: { en: 'Waiting for trusted Host confirmation…', zh: '等待可信 Host 确认…' },
  cancel: { en: 'Cancel pending project change', zh: '取消待确认项目变更' },
  saved: { en: 'Host project reference saved.', zh: 'Host 项目引用已保存。' },
  cancelled: { en: 'Project change cancelled.', zh: '项目变更已取消。' },
  retry: { en: '{cause} Reload Host projects to inspect the current association before trying again.', zh: '{cause} 请重新载入 Host 项目，核对当前关联后再试。' },
} as const;

export function NotebookProjectAssociations({ entryId, revision, readonly, dirty, onOpenEntry }: {
  entryId: string; revision: number; readonly: boolean; dirty: boolean; onOpenEntry(id: string): void;
}) {
  const { t } = useAppI18n(messages);
  const [catalog, setCatalog] = useState<NotebookProjectCatalog | null>(null), [selected, setSelected] = useState('');
  const [busy, setBusy] = useState<'read' | 'change' | null>(null), [verified, setVerified] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const pending = useRef<AbortController | null>(null), generation = useRef(0), live = useRef(true);
  const load = async () => {
    if (pending.current) return;
    const controller = new AbortController(), epoch = ++generation.current; pending.current = controller;
    setBusy('read'); setVerified(false); setError(''); setNotice('');
    try {
      const result = await listNotebookProjects(controller.signal);
      if (live.current && epoch === generation.current) { setCatalog(result); setVerified(true); }
    } catch (cause) { if (live.current && !controller.signal.aborted) setError(String(cause)); }
    finally { if (live.current && epoch === generation.current) { pending.current = null; setBusy(null); } }
  };
  useEffect(() => {
    live.current = true; void load();
    return () => { live.current = false; generation.current++; pending.current?.abort(); pending.current = null; void cancelNotebookProjectLink(entryId).catch(() => {}); };
  }, [entryId]);
  const project = catalog?.projects.find(item => item.id === selected), association = project?.entries.find(item => item.id === entryId);
  const current = catalog?.entries.find(item => item.id === entryId), currentSaved = current?.revision === String(revision);
  const change = async (linked: boolean) => {
    if (!project || pending.current || !verified || readonly || dirty || !currentSaved) return;
    const controller = new AbortController(), epoch = ++generation.current; pending.current = controller;
    setBusy('change'); setError(''); setNotice('');
    try {
      const result = await setNotebookProjectLink({ projectId: project.id, entryId, revision,
        expectedRevision: association?.revision ?? null, linked, readOnly: readonly }, controller.signal);
      if (live.current && epoch === generation.current) setNotice(t(result ? 'saved' : 'cancelled'));
      if (live.current && epoch === generation.current && result) setCatalog(result);
    } catch (cause) {
      if (live.current && epoch === generation.current) { setVerified(false); setError(t('retry', { cause: String(cause) })); }
    } finally { if (live.current && epoch === generation.current) { pending.current = null; setBusy(null); } }
  };
  const disabled = !!busy || !verified || readonly || dirty || !currentSaved;
  const linkedNames = catalog?.projects.filter(item => item.entries.some(entry => entry.id === entryId)).map(item => item.title).join(', ') || t('none');
  return <section aria-label={t('region')}><h4>{t('region')}</h4>
    <p>{t('scope')}</p>
    <Button disabled={!!busy} busy={busy === 'read'} onClick={() => void load()}>{t('reload')}</Button>
    {!catalog && busy === 'read' && <p role="status">{t('loading')}</p>}
    {catalog && !verified && <Feedback kind="warning">{t('staleList')}</Feedback>}
    {catalog && !catalog.projects.length && <p>{t('empty')}</p>}
    {catalog && <><Field label={t('project')}>{control => <NativeSelect {...control} value={selected} disabled={!!busy || !verified} onChange={event => { setSelected(event.target.value); setNotice(''); }}>
      <option value="">{t('choose')}</option>{catalog.projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
    </NativeSelect>}</Field><p>{t('linkedProjects', { names: linkedNames })}</p></>}
    {readonly && <p>{t('readonly')}</p>}
    {dirty && <p>{t('dirty')}</p>}
    {verified && !currentSaved && <Feedback kind="warning">{t('loadRevision')}</Feedback>}
    {project && <><p>{project.title} · {project.id}{association && <> · {t('linkedRevision', { revision: association.revision })}</>}</p>
      {!readonly && <><Button disabled={disabled || association?.revision === String(revision)} onClick={() => void change(true)}>{association ? t('update') : t('link')}</Button>
        {association && <Button disabled={disabled} onClick={() => void change(false)}>{t('unlink')}</Button>}</>}
      <ul>{project.entries.map(reference => {
        const saved = catalog?.entries.find(item => item.id === reference.id);
        return <li key={reference.id}><Button variant="link" disabled={!saved || !!busy} onClick={() => onOpenEntry(reference.id)}>{saved?.title ?? reference.id}</Button> · {t('linkedVersion', { revision: reference.revision })}
          {!saved ? <Badge tone="warning">{t('unavailable')}</Badge> : saved.revision !== reference.revision && <Badge tone="warning">{t('current', { revision: saved.revision })}</Badge>}</li>;
      })}</ul>{!project.entries.length && <p>{t('noEntries')}</p>}</>}
    {busy === 'change' && <><p role="status">{t('waiting')}</p><Button onClick={() => void cancelNotebookProjectLink(entryId)}>{t('cancel')}</Button></>}
    {notice && <Feedback kind="info">{notice}</Feedback>}{error && <Feedback kind="error">{error}</Feedback>}
  </section>;
}
