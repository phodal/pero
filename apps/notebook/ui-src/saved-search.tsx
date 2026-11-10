import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Dialog, Feedback, Field, Input, Select } from '@pero/app-sdk/ui';
import { emptyNotebookQuery, searchResultLocation, type NotebookQuery, type NotebookSearchProjection, type NotebookSearchResult, type SavedNotebookSearch, type SavedSearchAttributes } from '@pero/notebook/saved-search';
import { activeNotebookBlock, rememberWidgetFocus } from './block-order';
import { templateError } from './template-tools';

const messages = {
  savedSearch: { en: 'Saved search', zh: '保存查询' }, close: { en: 'Close', zh: '关闭' },
  scope: { en: 'Searches saved local Notebook entries. Unsaved editor changes are not indexed.', zh: '搜索已保存的本地 Notebook 记录，不包含编辑器中未保存的更改。' },
  loading: { en: 'Loading…', zh: '正在加载…' }, noQueries: { en: 'No saved queries. Name and save a query below.', zh: '暂无保存查询。请在下方命名并保存查询。' },
  choose: { en: 'Choose saved query', zh: '选择已保存查询' }, create: { en: 'New query', zh: '新建查询' },
  name: { en: 'Query name', zh: '查询名称' }, title: { en: 'Title contains', zh: '标题包含' }, text: { en: 'Text contains all words', zh: '正文包含全部关键词' },
  tags: { en: 'All tags (comma-separated)', zh: '包含全部标签（以逗号分隔）' }, sort: { en: 'Sort results', zh: '结果排序' },
  newest: { en: 'Recently updated', zh: '最近更新' }, alphabetic: { en: 'Title', zh: '标题' },
  save: { en: 'Save query', zh: '保存查询' }, saveRevision: { en: 'Save new query revision', zh: '保存查询新版本' },
  run: { en: 'Run saved query', zh: '运行已保存查询' }, use: { en: 'Insert live query', zh: '插入实时查询' }, update: { en: 'Use this query revision', zh: '使用此查询版本' },
  refresh: { en: 'Refresh', zh: '刷新' }, retry: { en: 'Retry', zh: '重试' },
  live: { en: 'Live query', zh: '实时查询' }, snapshot: { en: 'Fixed snapshot', zh: '固定快照' },
  freeze: { en: 'Freeze current results', zh: '固定当前结果' }, unfreeze: { en: 'Switch to live query', zh: '切换为实时查询' },
  edit: { en: 'Edit / choose query', zh: '编辑 / 选择查询' }, remove: { en: 'Remove block', zh: '移除块' },
  noResults: { en: 'No matching saved entries.', zh: '没有匹配的已保存记录。' },
  results: { en: '{count} results · refreshed {time}', zh: '{count} 条结果 · 刷新于 {time}' },
  fixedHint: { en: 'These titles, summaries and source revisions are frozen. Opening a result selects its original revision.', zh: '这些标题、摘要和来源版本已固定。打开结果会选择其原始版本。' },
  dirty: { en: 'Save these changes as a new query revision before running or inserting.', zh: '请先将更改保存为查询新版本，再运行或插入。' },
  source: { en: 'Open source revision', zh: '打开来源版本' }, pending: { en: 'Run this saved query to preview actual results.', zh: '运行此查询以预览实际结果。' },
};

/** Parent frame handles this event by loading the exact saved entry revision. */
export const NOTEBOOK_SEARCH_OPEN_EVENT = 'notebook-open-entry-revision';
function openResult(result: NotebookSearchResult) {
  window.dispatchEvent(new CustomEvent(NOTEBOOK_SEARCH_OPEN_EVENT, { detail: { entryId: result.entryId, revision: result.revision } }));
}
function Results({ projection }: { projection: NotebookSearchProjection }) {
  const { t, locale } = useAppI18n(messages);
  return <>
    <p className="notebook-note">{t('results', { count: projection.results.length, time: new Date(projection.refreshedAt).toLocaleString(locale) })}</p>
    {projection.results.length === 0 ? <p>{t('noResults')}</p> : <ul className="notebook-query-results">{projection.results.map(result => <li key={result.entryId}>
      <a href={searchResultLocation(result)} onClick={event => { event.preventDefault(); openResult(result); }} title={t('source')}>{result.title} · v{result.revision}</a>
      <p>{result.summary}</p>{result.tags.length > 0 && <small>{result.tags.join(' · ')}</small>}
    </li>)}</ul>}
  </>;
}

export function NotebookSavedSearchTools({ editor }: { editor: Editor }) {
  const { t } = useAppI18n(messages), [open, setOpen] = useState(false);
  return <><Button variant="ghost" disabled={!editor.isEditable} onMouseDown={event => event.preventDefault()} onClick={() => setOpen(true)}>{t('savedSearch')}</Button>
    {open && <SavedSearchDialog onClose={() => setOpen(false)} onUse={query => {
      if (editor.isDestroyed || !editor.isEditable) throw new Error('Editor is unavailable or read-only.');
      const block = activeNotebookBlock(editor);
      const position = block ? block.start + block.node.nodeSize - (block.node.type.name === 'section' ? 1 : 0) : editor.state.doc.content.size;
      if (!editor.commands.insertContentAt(position, { type: 'savedSearch', attrs: {
        blockId: crypto.randomUUID(), label: query.name, queryId: query.id, queryRevision: query.revision, mode: 'live', snapshot: null,
      } })) throw new Error('Cannot insert the saved search here.');
      setOpen(false);
    }} />}
  </>;
}

export function SavedSearchDialog({ onClose, onUse, initialId }: {
  onClose: () => void; onUse: (query: SavedNotebookSearch) => void; initialId?: string;
}) {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const [queries, setQueries] = useState<SavedNotebookSearch[] | null>(null), [saved, setSaved] = useState<SavedNotebookSearch | null>(null);
  const [name, setName] = useState(''), [query, setQuery] = useState<NotebookQuery>(emptyNotebookQuery), [tags, setTags] = useState('');
  const [projection, setProjection] = useState<NotebookSearchProjection | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const choose = (item: SavedNotebookSearch | null) => {
    setSaved(item); setName(item?.name ?? ''); setQuery(item?.query ?? emptyNotebookQuery()); setTags(item?.query.tags.join(', ') ?? ''); setProjection(null); setError('');
  };
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); try { await work(); } catch (cause) { if (alive.current) setError(templateError(cause)); } finally { if (alive.current) setBusy(false); } };
  useEffect(() => { void run(async () => {
    const result = await api.get<{ searches: SavedNotebookSearch[] }>('/api/saved-searches');
    if (!alive.current) return;
    setQueries(result.searches); const match = result.searches.find(item => item.id === initialId); if (match) choose(match);
  }); }, [api, initialId]);
  const definition = { name, query: { ...query, tags: tags.split(',').map(item => item.trim()).filter(Boolean) } };
  const dirty = !saved || saved.name !== name || JSON.stringify(saved.query) !== JSON.stringify(definition.query);
  useEffect(() => { if (dirty) setProjection(null); }, [dirty]);
  const save = () => run(async () => {
    const result = saved ? await api.post<SavedNotebookSearch>(`/api/saved-searches/${saved.id}/revisions`, { expectedRevision: saved.revision, definition })
      : await api.post<SavedNotebookSearch>('/api/saved-searches', definition);
    if (!alive.current) return;
    choose(result); setQueries(previous => [result, ...(previous ?? []).filter(item => item.id !== result.id)]);
  });
  return <Dialog title={t('savedSearch')} closeLabel={t('close')} size="lg" onClose={onClose}>
    <p>{t('scope')}</p>
    {error && <Feedback kind="error">{error}</Feedback>}
    {!queries && !error && <p role="status">{t('loading')}</p>}
    {queries?.length === 0 && <p>{t('noQueries')}</p>}
    <Select label={t('choose')} disabled={busy} value={saved?.id ?? ''} options={[{ value: '', label: t('create') }, ...(queries ?? []).map(item => ({ value: item.id, label: `${item.name} · v${item.revision}` }))]} onChange={id => choose(queries?.find(item => item.id === id) ?? null)} />
    <div className="notebook-template-form">
      <Field label={t('name')}>{control => <Input {...control} disabled={busy} value={name} maxLength={200} onChange={event => setName(event.target.value)} />}</Field>
      <Field label={t('title')}>{control => <Input {...control} disabled={busy} value={query.title} maxLength={200} onChange={event => setQuery(previous => ({ ...previous, title: event.target.value }))} />}</Field>
      <Field label={t('text')}>{control => <Input {...control} disabled={busy} value={query.text} maxLength={500} onChange={event => setQuery(previous => ({ ...previous, text: event.target.value }))} />}</Field>
      <Field label={t('tags')}>{control => <Input {...control} disabled={busy} value={tags} onChange={event => setTags(event.target.value)} />}</Field>
      <Select label={t('sort')} disabled={busy} value={query.sort} options={[{ value: 'updated-desc', label: t('newest') }, { value: 'title-asc', label: t('alphabetic') }]} onChange={value => setQuery(previous => ({ ...previous, sort: value as NotebookQuery['sort'] }))} />
      {saved && dirty && <p>{t('dirty')}</p>}
      <div className="notebook-template-actions">
        <Button variant="primary" busy={busy} disabled={!name.trim() || !dirty} onClick={() => void save()}>{t(saved ? 'saveRevision' : 'save')}</Button>
        <Button disabled={busy || dirty} onClick={() => void run(async () => { if (!saved) return; const result = await api.post<NotebookSearchProjection>(`/api/saved-searches/${saved.id}/run`, { revision: saved.revision }); if (alive.current) setProjection(result); })}>{t('run')}</Button>
        <Button disabled={busy || dirty} onClick={() => { try { if (saved) onUse(saved); } catch (cause) { setError(templateError(cause)); } }}>{t(initialId ? 'update' : 'use')}</Button>
      </div>
      {projection ? <Results projection={projection} /> : saved && !dirty && <p>{t('pending')}</p>}
    </div>
  </Dialog>;
}

export function SavedSearchView(view: NodeViewProps) {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const attrs = view.node.attrs as SavedSearchAttributes;
  const [projection, setProjection] = useState<NotebookSearchProjection | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [editing, setEditing] = useState(false);
  const generation = useRef(0), alive = useRef(true);
  useEffect(() => () => { alive.current = false; generation.current++; }, []);
  const refresh = async () => {
    const request = ++generation.current;
    setBusy(true); setError('');
    try {
      const result = await api.post<NotebookSearchProjection>(`/api/saved-searches/${attrs.queryId}/run`, { revision: attrs.queryRevision });
      if (alive.current && generation.current === request) setProjection(result);
    } catch (cause) { if (alive.current && generation.current === request) setError(templateError(cause)); }
    finally { if (alive.current && generation.current === request) setBusy(false); }
  };
  useEffect(() => {
    generation.current++; setProjection(null); setError(''); setBusy(false);
    if (attrs.mode === 'live') void refresh();
  }, [api, attrs.queryId, attrs.queryRevision, attrs.mode]);
  const shown = attrs.mode === 'snapshot' ? attrs.snapshot : projection;
  return <NodeViewWrapper className="notebook-block" data-kind="savedSearch" data-notebook-block-id={attrs.blockId} contentEditable={false} onFocusCapture={() => rememberWidgetFocus(view.editor, attrs.blockId)}>
    <div className="notebook-block-header"><strong>{attrs.label || t('savedSearch')} · v{attrs.queryRevision}</strong><Badge>{t(attrs.mode)}</Badge>
      <div className="notebook-template-actions">
        {attrs.mode === 'live' && <Button busy={busy} onClick={() => void refresh()}>{t('refresh')}</Button>}
        {view.editor.isEditable && <>
          {attrs.mode === 'live' && <Button disabled={busy || !!error || !projection} onClick={() => { if (projection) { generation.current++; view.updateAttributes({ mode: 'snapshot', snapshot: structuredClone(projection) }); } }}>{t('freeze')}</Button>}
          {attrs.mode === 'snapshot' && <Button onClick={() => view.updateAttributes({ mode: 'live', snapshot: null })}>{t('unfreeze')}</Button>}
          {attrs.mode === 'live' && <Button onClick={() => setEditing(true)}>{t('edit')}</Button>}
          <Button variant="ghost" onClick={view.deleteNode}>{t('remove')}</Button>
        </>}
      </div>
    </div>
    <div className="notebook-block-content">
      {error && <Feedback kind="error">{error}<Button onClick={() => void refresh()} disabled={busy}>{t('retry')}</Button></Feedback>}
      {busy && <p role="status">{t('loading')}</p>}
      {attrs.mode === 'snapshot' && <p>{t('fixedHint')}</p>}
      {shown && <Results projection={shown} />}
      {editing && <SavedSearchDialog initialId={attrs.queryId} onClose={() => setEditing(false)} onUse={query => {
        view.updateAttributes({ queryId: query.id, queryRevision: query.revision, label: query.name, mode: 'live', snapshot: null }); setEditing(false);
      }} />}
    </div>
  </NodeViewWrapper>;
}
