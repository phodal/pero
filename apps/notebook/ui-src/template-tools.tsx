import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { AppApiError, useAppApi, useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Checkbox, Dialog, Feedback, Field, Input, Select, Textarea } from '@pero/app-sdk/ui';
import type { NotebookDocument, NotebookNode } from '@pero/notebook';
import { instantiateTemplate, templateBindingChoices, validateTemplateParameters, type PublishedTemplate, type TemplateKind, type TemplateParameter, type TemplateSummary, type TemplateValue, type TemplateOrigin } from '@pero/notebook/templates';
import { activeNotebookBlock } from './block-order';
import { TemplateCollections } from './template-collections';
import { collectionPath, type TemplateCollectionLibrary } from '@pero/notebook/template-collections';

const messages = {
  library: { en: 'Templates', zh: '模板库' }, close: { en: 'Close', zh: '关闭' },
  local: { en: 'Local Notebook library. Published revisions never change existing instances.', zh: 'Notebook 本地模板库。发布新版本不会修改已有实例。' },
  loading: { en: 'Loading templates…', zh: '正在加载模板…' }, empty: { en: 'No templates. Publish this entry or its selected section to get started.', zh: '暂无模板。可以发布当前记录或选中章节。' },
  filter: { en: 'Search names or collections', zh: '搜索名称或集合标签' }, archived: { en: 'Include archived templates', zh: '包括已归档模板' },
  entry: { en: 'Whole entry', zh: '完整记录' }, fragment: { en: 'Selected section / block', zh: '所选章节 / 块' },
  publish: { en: 'Publish from current content', zh: '发布当前内容' }, name: { en: 'Name', zh: '名称' }, description: { en: 'Description', zh: '说明' },
  collections: { en: 'Collection labels (comma-separated)', zh: '集合标签（以逗号分隔）' }, kind: { en: 'Template scope', zh: '模板范围' },
  version: { en: 'Revision', zh: '版本' }, archive: { en: 'Archive', zh: '归档' }, restore: { en: 'Restore', zh: '恢复' },
  newRevision: { en: 'Publish current content as next revision', zh: '将当前内容发布为下一版本' },
  publishNow: { en: 'Publish immutable revision', zh: '发布不可变版本' }, cancel: { en: 'Back to library', zh: '返回模板库' },
  parameters: { en: 'Typed parameters', zh: '类型化参数' }, add: { en: 'Add parameter', zh: '添加参数' }, remove: { en: 'Remove', zh: '移除' },
  key: { en: 'Parameter key', zh: '参数键' }, label: { en: 'Parameter label', zh: '参数标签' }, target: { en: 'Bound field', zh: '绑定字段' },
  type: { en: 'Value type', zh: '值类型' }, text: { en: 'Text', zh: '文本' }, decimal: { en: 'Decimal', zh: '数值' }, boolean: { en: 'Boolean', zh: '布尔值' },
  required: { en: 'Required', zh: '必填' }, optional: { en: 'Optional', zh: '选填' }, unset: { en: 'Not provided', zh: '未提供' }, yes: { en: 'True', zh: '真' }, no: { en: 'False', zh: '假' },
  newEntry: { en: 'Create new entry', zh: '创建新记录' }, insert: { en: 'Insert independent fragment', zh: '插入独立片段' },
  entryHint: { en: 'Creates a separate entry. The current entry stays unchanged.', zh: '创建另一条记录，不会覆盖当前记录。' },
  fragmentHint: { en: 'Inserts after the selected block, or at the end of the selected section.', zh: '插入所选块之后，或所选章节末尾。' },
  archivedHint: { en: 'Archived. Restore this template to create new instances.', zh: '已归档。恢复模板后才能创建新实例。' },
  captured: { en: 'Publication uses the content captured when this dialog opened.', zh: '发布使用打开此对话框时捕获的内容。' },
  noFragment: { en: 'Select a section or block in the editor first.', zh: '请先在编辑器中选中章节或块。' },
  source: { en: 'Source template · v{revision}', zh: '来源模板 · v{revision}' },
  newer: { en: 'A newer revision is available. Existing content is unchanged.', zh: '有更新的模板版本，已有内容不会自动更改。' },
  retry: { en: 'Reload library', zh: '重新加载模板库' }, preview: { en: 'Published content preview', zh: '已发布内容预览' },
};

export function templateError(cause: unknown): string {
  if (cause instanceof AppApiError) { try { const value = JSON.parse(cause.body); if (typeof value.detail === 'string') return value.detail; } catch { /* Preserve non-JSON Host errors. */ } }
  return cause instanceof Error ? cause.message : String(cause);
}

function contentPreview(node: NotebookNode): string {
  if (node.text) return node.text;
  return [node.attrs?.label, node.attrs?.claim, node.attrs?.filename, ...(node.content ?? []).map(contentPreview)].filter(value => typeof value === 'string' && value).join('\n');
}

export interface NotebookTemplateToolsProps {
  editor: Editor; document: NotebookDocument;
  onCreateEntry?: (document: NotebookDocument) => Promise<void>;
}

export function NotebookTemplateTools(props: NotebookTemplateToolsProps) {
  const { t } = useAppI18n(messages);
  const [capture, setCapture] = useState<{ document: NotebookDocument; fragment: NotebookNode | null; origin?: TemplateOrigin } | null>(null);
  const selectedOrigin = useEditorState({ editor: props.editor, selector: ({ editor }) => {
    const block = activeNotebookBlock(editor);
    return block?.node.attrs.templateOrigin ?? block?.parent.attrs.templateOrigin ?? null;
  } }) as TemplateOrigin | null;
  const origin = selectedOrigin ?? (props.document as NotebookDocument & { templateOrigin?: TemplateOrigin }).templateOrigin;
  const open = (source?: TemplateOrigin) => {
    const block = activeNotebookBlock(props.editor);
    const fragment = block?.node.type.name === 'section' ? block.node : block?.parent.type.name === 'section' ? block.parent : block?.node;
    setCapture({ document: { ...structuredClone(props.document), content: props.editor.getJSON() as NotebookDocument['content'] }, fragment: fragment?.toJSON() as NotebookNode ?? null, origin: source });
  };
  return <>
    <Button variant="ghost" onMouseDown={event => event.preventDefault()} onClick={() => open()}>{t('library')}</Button>
    {origin && <Button variant="ghost" onMouseDown={event => event.preventDefault()} onClick={() => open(origin)}>{t('source', { revision: origin.revision })}</Button>}
    {capture && <TemplateLibrary {...props} capture={capture} onClose={() => setCapture(null)} />}
  </>;
}

function TemplateLibrary({ editor, onCreateEntry, capture, onClose }: NotebookTemplateToolsProps & {
  capture: { document: NotebookDocument; fragment: NotebookNode | null; origin?: TemplateOrigin }; onClose: () => void;
}) {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const [list, setList] = useState<TemplateSummary[] | null>(null), [selected, setSelected] = useState<PublishedTemplate | null>(null);
  const [collection, setCollection] = useState(''), [organization, setOrganization] = useState<TemplateCollectionLibrary | null>(null);
  const [filter, setFilter] = useState(''), [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false), [base, setBase] = useState<TemplateSummary | null>(null);
  const [kind, setKind] = useState<TemplateKind>('entry'), [name, setName] = useState(''), [description, setDescription] = useState(''), [collections, setCollections] = useState('');
  const [parameters, setParameters] = useState<TemplateParameter[]>([]), [values, setValues] = useState<Record<string, string>>({});
  const alive = useRef(true), generation = useRef(0);
  useEffect(() => () => { alive.current = false; generation.current++; }, []);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch (cause) { if (alive.current) setError(templateError(cause)); }
    finally { if (alive.current) setBusy(false); }
  };
  const refresh = async () => { const result = await api.get<{ templates: TemplateSummary[] }>('/api/templates'); if (alive.current) setList(result.templates); };
  useEffect(() => { void run(async () => {
    await refresh();
    if (capture.origin && alive.current) {
      const result = await api.get<PublishedTemplate>(`/api/templates/${capture.origin.templateId}?revision=${capture.origin.revision}`);
      if (alive.current) setSelected(result);
    }
  }); }, [api]);
  const choose = (id: string, revision?: number) => run(async () => {
    const request = ++generation.current;
    const result = await api.get<PublishedTemplate>(`/api/templates/${id}${revision ? `?revision=${revision}` : ''}`);
    if (!alive.current || request !== generation.current) return;
    setSelected(result); setValues({}); setPublishing(false);
  });
  const source: NotebookDocument = kind === 'entry' ? capture.document : { schemaVersion: 1, title: name || capture.document.title, content: { type: 'doc', content: capture.fragment ? [capture.fragment] : [] } };
  const bindings = templateBindingChoices(source, kind);
  const beginPublication = (existing: TemplateSummary | null = null) => {
    setBase(existing); setKind(existing?.kind ?? 'entry'); setName(existing?.name ?? capture.document.title);
    setDescription(existing?.description ?? ''); setCollections(existing?.collections.join(', ') ?? '');
    setParameters([]); setPublishing(true); setError('');
  };
  const publish = () => run(async () => {
    if (kind === 'fragment' && !capture.fragment) throw new Error(t('noFragment'));
    validateTemplateParameters(source, parameters, kind);
    const definition = { name, description, kind, collections: collections.split(',').map(item => item.trim()).filter(Boolean), document: source, parameters };
    const result = base ? await api.post<PublishedTemplate>(`/api/templates/${base.id}/revisions`, { expectedRevision: base.revision, definition })
      : await api.post<PublishedTemplate>('/api/templates', definition);
    if (!alive.current) return;
    setSelected(result); setPublishing(false); setValues({}); await refresh();
  });
  const instantiate = () => run(async () => {
    if (!selected) return;
    // Re-read archive status before using this fixed revision. No automatic revision upgrade.
    const current = await api.get<PublishedTemplate>(`/api/templates/${selected.id}?revision=${selected.revision}`);
    if (!alive.current || editor.isDestroyed) return;
    const supplied: Record<string, TemplateValue> = {};
    for (const parameter of current.parameters) {
      const raw = values[parameter.key];
      if (raw === undefined || (raw === '' && parameter.type !== 'text')) continue;
      supplied[parameter.key] = parameter.type === 'decimal' ? Number(raw) : parameter.type === 'boolean' ? raw === 'true' : raw;
    }
    const instance = instantiateTemplate(current, supplied, () => crypto.randomUUID());
    if (current.kind === 'entry') {
      if (!onCreateEntry) throw new Error('Entry creation is unavailable.');
      await onCreateEntry(instance.document);
    } else {
      if (!editor.isEditable) throw new Error('This revision is read-only.');
      const block = activeNotebookBlock(editor);
      const end = block ? block.start + block.node.nodeSize - (block.node.type.name === 'section' ? 1 : 0) : editor.state.doc.content.size;
      if (!editor.commands.insertContentAt(end, instance.document.content.content)) throw new Error('The fragment cannot be inserted here.');
    }
    if (alive.current) onClose();
  });
  const shown = list?.filter(item => (!collection || collectionPath(organization?.collections ?? [], organization?.memberships[item.id] ?? '').some(parent => parent.id === collection)) && (archived || !item.archived) && `${item.name} ${item.collections.join(' ')}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const updateParameter = (index: number, patch: Partial<TemplateParameter>) => setParameters(previous => previous.map((item, offset) => offset === index ? { ...item, ...patch } : item));
  return <Dialog title={t('library')} closeLabel={t('close')} size="lg" onClose={onClose}>
    <p>{t('local')}</p>
    {error && <Feedback kind="error">{error} <Button disabled={busy} onClick={() => void run(refresh)}>{t('retry')}</Button></Feedback>}
    {publishing ? <div className="notebook-template-form">
      <p>{t('captured')}</p>
      <Select label={t('kind')} value={kind} disabled={!!base || busy} options={(['entry', 'fragment'] as const).map(value => ({ value, label: t(value), disabled: value === 'fragment' && !capture.fragment }))} onChange={value => { setKind(value as TemplateKind); setParameters([]); }} />
      <Field label={t('name')}>{control => <Input {...control} disabled={busy} value={name} maxLength={200} onChange={event => setName(event.target.value)} />}</Field>
      <Field label={t('description')}>{control => <Textarea {...control} disabled={busy} value={description} maxLength={2000} onChange={event => setDescription(event.target.value)} />}</Field>
      <Field label={t('collections')}>{control => <Input {...control} disabled={busy} value={collections} onChange={event => setCollections(event.target.value)} />}</Field>
      <strong>{t('parameters')}</strong>
      {parameters.map((parameter, index) => <div className="notebook-template-parameter" key={index}>
        <Field label={t('key')}>{control => <Input {...control} disabled={busy} value={parameter.key} maxLength={128} onChange={event => updateParameter(index, { key: event.target.value })} />}</Field>
        <Field label={t('label')}>{control => <Input {...control} disabled={busy} value={parameter.label} maxLength={200} onChange={event => updateParameter(index, { label: event.target.value })} />}</Field>
        <Select label={t('target')} disabled={busy} value={String(bindings.findIndex(item => JSON.stringify(item.target) === JSON.stringify(parameter.target)))}
          options={bindings.map((item, offset) => ({ value: String(offset), label: item.label }))} onChange={value => {
            const binding = bindings[Number(value)]; if (binding) updateParameter(index, { target: binding.target, type: binding.types[0] });
          }} />
        <Select label={t('type')} disabled={busy} value={parameter.type} options={(bindings.find(item => JSON.stringify(item.target) === JSON.stringify(parameter.target))?.types ?? ['text']).map(value => ({ value, label: t(value) }))}
          onChange={value => updateParameter(index, { type: value as TemplateParameter['type'] })} />
        <label><Checkbox disabled={busy} checked={parameter.required} onCheckedChange={checked => updateParameter(index, { required: checked === true })} />{t('required')}</label>
        <Button variant="ghost" disabled={busy} onClick={() => setParameters(previous => previous.filter((_, offset) => offset !== index))}>{t('remove')}</Button>
      </div>)}
      <Button disabled={!bindings.length || parameters.length >= 50 || busy} onClick={() => setParameters(previous => [...previous, { key: `parameter_${previous.length + 1}`, label: `Parameter ${previous.length + 1}`, type: bindings[0].types[0], target: bindings[0].target, required: true }])}>{t('add')}</Button>
      <div className="notebook-template-actions"><Button disabled={busy} onClick={() => setPublishing(false)}>{t('cancel')}</Button><Button variant="primary" busy={busy} disabled={!name.trim()} onClick={() => void publish()}>{t('publishNow')}</Button></div>
    </div> : <>
      <div className="notebook-template-actions"><Button disabled={busy || !editor.isEditable} onClick={() => beginPublication()}>{t('publish')}</Button></div>
      <TemplateCollections templateId={selected?.id} selected={collection} onSelect={setCollection} onLibrary={setOrganization} />
      <Field label={t('filter')}>{control => <Input {...control} disabled={busy} value={filter} onChange={event => setFilter(event.target.value)} />}</Field>
      <label><Checkbox checked={archived} onCheckedChange={checked => setArchived(checked === true)} />{t('archived')}</label>
      {!list && !error && <p role="status">{t('loading')}</p>}
      {shown?.length === 0 && <p>{t('empty')}</p>}
      <div className="notebook-template-library">
        <ul>{shown?.map(item => <li key={item.id}><Button variant="ghost" disabled={busy} aria-pressed={selected?.id === item.id} onClick={() => void choose(item.id)}>{item.name} · v{item.revision}</Button><Badge>{t(item.kind)}</Badge>{item.collections.length > 0 && <small>{item.collections.join(' · ')}</small>}</li>)}</ul>
        {selected && <section className="notebook-template-detail" aria-label={selected.name}>
          <h3>{selected.name}</h3><p>{selected.description}</p>
          {(list?.find(item => item.id === selected.id)?.revision ?? 0) > selected.revision && <p>{t('newer')}</p>}
          <Select label={t('version')} value={String(selected.revision)} disabled={busy}
            options={Array.from({ length: list?.find(item => item.id === selected.id)?.revision ?? selected.revision }, (_, index) => ({ value: String(index + 1), label: `v${index + 1}` }))} onChange={value => void choose(selected.id, Number(value))} />
          <pre className="notebook-template-preview" aria-label={t('preview')}>{contentPreview(selected.document.content) || selected.document.title}</pre>
          <p>{t(selected.archived ? 'archivedHint' : selected.kind === 'entry' ? 'entryHint' : 'fragmentHint')}</p>
          {selected.parameters.map(parameter => <Field key={parameter.key} label={`${parameter.label} (${t(parameter.type)}, ${t(parameter.required ? 'required' : 'optional')})`}>
            {control => parameter.type === 'boolean' ? <Select {...control} disabled={busy} label={parameter.label} value={values[parameter.key] ?? (parameter.default === undefined ? '' : String(parameter.default))} options={[
              { value: '', label: t('unset') }, { value: 'true', label: t('yes') }, { value: 'false', label: t('no') },
            ]} onChange={value => setValues(previous => ({ ...previous, [parameter.key]: value }))} />
              : <Input {...control} disabled={busy} type={parameter.type === 'decimal' ? 'number' : 'text'} step={parameter.type === 'decimal' ? 'any' : undefined} value={values[parameter.key] ?? String(parameter.default ?? '')} onChange={event => setValues(previous => ({ ...previous, [parameter.key]: event.target.value }))} />}
          </Field>)}
          <div className="notebook-template-actions"><Button variant="primary" busy={busy} disabled={selected.archived || (selected.kind === 'entry' ? !onCreateEntry : !editor.isEditable)} onClick={() => void instantiate()}>{t(selected.kind === 'entry' ? 'newEntry' : 'insert')}</Button>
            <Button disabled={busy} onClick={() => void run(async () => { const result = await api.post<PublishedTemplate>(`/api/templates/${selected.id}/archive`, { archived: !selected.archived }); if (alive.current) setSelected(result); await refresh(); })}>{t(selected.archived ? 'restore' : 'archive')}</Button>
            <Button disabled={busy || selected.archived || !editor.isEditable} onClick={() => beginPublication(list?.find(item => item.id === selected.id) ?? selected)}>{t('newRevision')}</Button></div>
        </section>}
      </div>
    </>}
  </Dialog>;
}
