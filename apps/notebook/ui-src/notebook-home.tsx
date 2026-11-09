import { NotebookProjectAssociations } from './notebook-projects';
import { useEffect, useRef, useState } from 'react';
import { useAppApi } from '@pero/app-sdk';
import { Badge, Button, Dialog, Disclosure, Feedback, Field, Input, NativeSelect } from '@pero/app-sdk/ui';
import { scientificReferenceState, type NotebookDocument, type NotebookEntry, type ScientificReference } from '@pero/notebook';
import { notebookContentRoots, type NotebookMetadata } from '@pero/notebook/workspace';
import type { TemplateOrigin } from '@pero/notebook/templates';
import type { AttachmentAttributes } from '@pero/notebook/attachment';

interface HomeEntry { entryId: string; title: string; revision: number; project: string; author: string }
interface HomeLibrary { scope: 'local-display-labels'; entries: HomeEntry[]; limited: boolean }
export interface NotebookHomeProps {
  entry: NotebookEntry; document: NotebookDocument; dirty: boolean; readonly: boolean;
  onOpenEntry(id: string): void; onMetadata?(metadata: NotebookMetadata): void;
}

export function NotebookHomeTools(props: NotebookHomeProps) {
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" onClick={() => setOpen(true)}>Notebook home / 笔记主页</Button>{open && <NotebookHome {...props} onClose={() => setOpen(false)} />}</>;
}

export function NotebookHome({ entry, document, dirty, readonly, onOpenEntry, onMetadata, onClose }: NotebookHomeProps & { onClose(): void }) {
  const api = useAppApi(), initial = useRef(document.metadata ?? { project: '', author: '', tags: [] });
  const [project, setProject] = useState(initial.current.project), [author, setAuthor] = useState(initial.current.author), [filter, setFilter] = useState('');
  const [library, setLibrary] = useState<HomeLibrary | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const live = useRef(true), request = useRef(0);
  useEffect(() => () => { live.current = false; request.current++; }, []);
  const load = async () => {
    const generation = ++request.current; setBusy(true); setError('');
    try {
      const result = await api.get<HomeLibrary>('/api/notebook-home');
      if (live.current && generation === request.current) setLibrary(result);
    } catch (cause) { if (live.current && generation === request.current) setError(String(cause)); }
    finally { if (live.current && generation === request.current) setBusy(false); }
  };
  useEffect(() => { void load(); }, [api]);
  const origins = new Map<string, TemplateOrigin>(), sources: { blockId: string; source: ScientificReference }[] = [], files: { blockId: string; file: AttachmentAttributes }[] = [];
  if (document.templateOrigin) origins.set(document.templateOrigin.instanceId, document.templateOrigin);
  const walk = (node: NotebookDocument['content'] | NotebookDocument['content']['content'][number]) => {
    const attrs = node.attrs ?? {}, origin = attrs.templateOrigin as TemplateOrigin | null;
    if (origin) origins.set(origin.instanceId, origin);
    if (['evidence', 'experiment', 'referenceMention'].includes(node.type) && attrs.source) sources.push({ blockId: String(attrs.blockId ?? ''), source: attrs.source as ScientificReference });
    if (node.type === 'attachment') files.push({ blockId: String(attrs.blockId ?? ''), file: attrs as unknown as AttachmentAttributes });
    node.content?.forEach(walk);
  };
  notebookContentRoots(document).forEach(walk);
  const choices = (field: 'project' | 'author') => [...new Set((library?.entries ?? []).map(item => item[field]).filter(Boolean))].sort();
  const shown = library?.entries.filter(item => !filter || item.project === filter) ?? [];
  const changed = project !== initial.current.project || author !== initial.current.author;
  return <Dialog title="Notebook home and provenance / 笔记主页与来源" closeLabel="Close / 关闭" size="lg" onClose={onClose}>
    <h3>{document.title}</h3><p>{entry.id} · v{entry.revision} · schema {document.schemaVersion}</p><p>{entry.updatedAt} {dirty && <Badge tone="warning">Unsaved draft / 未发布草稿</Badge>}</p>
    <p>Notebook owns local drafts and immutable published revisions. Scientific objects, Host projects, accounts and execution remain with their owners. / Notebook 管理本地草稿与不可变已发布版本；科学对象、Host 项目、账号和执行由原应用管理。</p>
    <NotebookProjectAssociations entryId={entry.id} revision={entry.revision} readonly={readonly} dirty={dirty} onOpenEntry={id => { onOpenEntry(id); onClose(); }} />
    <section aria-label="Project and author labels / 项目与作者标签"><h4>Project and author labels / 项目与作者标签</h4>
      <p>Choose saved display labels or enter new ones. This does not change project membership, object ownership, or authenticated identity. / 选择已保存显示标签或输入新标签，不会变更项目成员、对象所有权或认证身份。</p>
      {(['project', 'author'] as const).map(field => <div key={field}>
        <Field label={field === 'project' ? 'Saved project label / 已保存项目标签' : 'Saved author label / 已保存作者标签'}>{control => <NativeSelect {...control} disabled={readonly || busy} value="" onChange={event => { if (event.target.value) (field === 'project' ? setProject : setAuthor)(event.target.value); }}><option value="">Choose / 选择</option>{choices(field).map(value => <option key={value} value={value}>{value}</option>)}</NativeSelect>}</Field>
        <Field label={field === 'project' ? 'Project label / 项目标签' : 'Author label / 作者标签'}>{control => <Input {...control} disabled={readonly} maxLength={200} value={field === 'project' ? project : author} onChange={event => (field === 'project' ? setProject : setAuthor)(event.target.value)} />}</Field>
      </div>)}
      {!readonly && <Button variant="primary" disabled={!changed || !onMetadata} onClick={() => {
        if (JSON.stringify(document.metadata ?? { project: '', author: '', tags: [] }) !== JSON.stringify(initial.current)) { setError('Metadata changed while this dialog was open. Close and reopen to review it. / 对话框打开期间元数据已更改，请重新打开。'); return; }
        onMetadata?.({ ...initial.current, project, author }); onClose();
      }}>Apply labels to draft / 应用标签到草稿</Button>}
    </section>
    <Disclosure summary={`Template provenance / 模板来源 (${origins.size})`}><ul>{[...origins.values()].map(origin => <li key={origin.instanceId}>{origin.templateId} · v{origin.revision} · instance {origin.instanceId}<pre className="notebook-science-json">{JSON.stringify({ parameters: origin.parameterValues, identities: origin.idMap }, null, 2)}</pre></li>)}</ul>{!origins.size && <p>No template origin recorded. / 未记录模板来源。</p>}</Disclosure>
    <Disclosure summary={`Scientific source identities / 科学来源身份 (${sources.length})`}><ul>{sources.map(({ blockId, source }, index) => <li key={index}>{blockId} · {source.app} / {source.kind} / {source.id} · {source.version || 'Unpinned / 未固定版本'} <Badge>{scientificReferenceState(source)}</Badge><p>{source.locator}</p></li>)}</ul><p>Recorded identities are not an owner verification. / 已记录身份不等于来源方验证。</p></Disclosure>
    <Disclosure summary={`Embedded file provenance / 内嵌文件来源 (${files.length})`}><ul>{files.map(({ blockId, file }) => <li key={blockId}>{file.filename} · {file.mime}<p style={{ overflowWrap: 'anywhere' }}>SHA-256: {file.sha256}</p><p>{file.derivation?.steps.length ?? 0} recorded image edits / 已记录图片编辑</p></li>)}</ul></Disclosure>
    <section aria-label="Saved entries / 已保存条目"><h4>Saved entries / 已保存条目</h4><Field label="Filter saved project / 筛选已保存项目">{control => <NativeSelect {...control} value={filter} onChange={event => setFilter(event.target.value)}><option value="">All projects / 全部项目</option>{choices('project').map(value => <option key={value} value={value}>{value}</option>)}</NativeSelect>}</Field>
      <Button busy={busy} disabled={busy} onClick={() => void load()}>Reload saved entries / 重新载入条目</Button>
      {library?.limited && <Feedback kind="info">Showing the 500 most recently saved entries. / 显示最近保存的 500 条记录。</Feedback>}
      {!library && busy && <p role="status">Loading saved entries / 正在加载已保存条目</p>}
      {library && !shown.length && <p>No matching entries. / 无匹配条目。</p>}
      <ul>{shown.map(item => <li key={item.entryId}><Button variant="link" onClick={() => { onOpenEntry(item.entryId); onClose(); }}>{item.title} · v{item.revision}</Button> · {item.project} · {item.author}</li>)}</ul>
    </section>
    {error && <Feedback kind="error">{error}</Feedback>}
  </Dialog>;
}
