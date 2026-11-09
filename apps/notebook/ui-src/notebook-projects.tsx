import { useEffect, useRef, useState } from 'react';
import { cancelNotebookProjectLink, listNotebookProjects, setNotebookProjectLink, type NotebookProjectCatalog } from '@pero/app-sdk';
import { Badge, Button, Feedback, Field, NativeSelect } from '@pero/app-sdk/ui';

export function NotebookProjectAssociations({ entryId, revision, readonly, dirty, onOpenEntry }: {
  entryId: string; revision: number; readonly: boolean; dirty: boolean; onOpenEntry(id: string): void;
}) {
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
      if (live.current && epoch === generation.current) {
        if (result) { setCatalog(result); setNotice('Host project reference saved. / Host 项目引用已保存。'); }
        else setNotice('Project change cancelled. / 项目变更已取消。');
      }
    } catch (cause) {
      if (live.current && epoch === generation.current) { setVerified(false); setError(`${String(cause)} Reload Host projects to inspect the current association before trying again. / 请重新载入 Host 项目，核对当前关联后再试。`); }
    } finally { if (live.current && epoch === generation.current) { pending.current = null; setBusy(null); } }
  };
  const disabled = !!busy || !verified || readonly || dirty || !currentSaved;
  return <section aria-label="Host project associations / Host 项目关联"><h4>Host project associations / Host 项目关联</h4>
    <p>Link this saved Notebook revision to a real Host project. This does not change project members, permissions, or Notebook display labels. / 将已保存笔记版本关联到真实 Host 项目，不改变项目成员、权限或笔记显示标签。</p>
    <Button disabled={!!busy} busy={busy === 'read'} onClick={() => void load()}>Reload Host projects / 重新载入 Host 项目</Button>
    {!catalog && busy === 'read' && <p role="status">Loading Host projects… / 正在载入 Host 项目…</p>}
    {catalog && !verified && <Feedback kind="warning">Previous project list is not verified as current. / 上次项目列表尚未确认是最新状态。</Feedback>}
    {catalog && !catalog.projects.length && <p>No Host projects. Create a research project in the workbench first. / 暂无 Host 项目，请先在工作台创建研究项目。</p>}
    {catalog && <><Field label="Host project / Host 项目">{control => <NativeSelect {...control} value={selected} disabled={!!busy || !verified} onChange={event => { setSelected(event.target.value); setNotice(''); }}>
      <option value="">Choose a Host project / 选择 Host 项目</option>{catalog.projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
    </NativeSelect>}</Field><p>Linked projects / 已关联项目：{catalog.projects.filter(item => item.entries.some(entry => entry.id === entryId)).map(item => item.title).join(', ') || 'None / 无'}</p></>}
    {readonly && <p>Read-only Notebook view. Project changes are unavailable. / 只读笔记视图，不可变更项目关联。</p>}
    {dirty && <p>Publish the current draft before associating its saved revision. / 请先发布当前草稿，再关联已保存版本。</p>}
    {verified && !currentSaved && <Feedback kind="warning">Load the current saved Notebook revision before changing associations. / 请先载入当前已保存笔记版本再修改关联。</Feedback>}
    {project && <><p>{project.title} · {project.id}{association && <> · Linked v{association.revision} / 已关联版本 {association.revision}</>}</p>
      {!readonly && <><Button disabled={disabled || association?.revision === String(revision)} onClick={() => void change(true)}>{association ? 'Update linked revision / 更新关联版本' : 'Link saved entry / 关联已保存条目'}</Button>
        {association && <Button disabled={disabled} onClick={() => void change(false)}>Unlink entry / 解除条目关联</Button>}</>}
      <ul>{project.entries.map(reference => {
        const saved = catalog?.entries.find(item => item.id === reference.id);
        return <li key={reference.id}><Button variant="link" disabled={!saved || !!busy} onClick={() => onOpenEntry(reference.id)}>{saved?.title ?? reference.id}</Button> · linked v{reference.revision} / 关联版本 {reference.revision}
          {!saved ? <Badge tone="warning">Entry unavailable / 条目不可用</Badge> : saved.revision !== reference.revision && <Badge tone="warning">Current v{saved.revision} / 当前版本 {saved.revision}</Badge>}</li>;
      })}</ul>{!project.entries.length && <p>No Notebook entries linked to this project. / 此项目尚未关联笔记条目。</p>}</>}
    {busy === 'change' && <><p role="status">Waiting for trusted Host confirmation… / 等待可信 Host 确认…</p><Button onClick={() => void cancelNotebookProjectLink(entryId)}>Cancel pending project change / 取消待确认项目变更</Button></>}
    {notice && <Feedback kind="info">{notice}</Feedback>}{error && <Feedback kind="error">{error}</Feedback>}
  </section>;
}
