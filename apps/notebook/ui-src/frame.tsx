import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppApiError, AppProvider, downloadFile, useAppApi, useAppChat, useAppContext, useAppDataChanged, useAppI18n, useAppObject } from '@pero/app-sdk';
import { AppFrame, Button, Disclosure, EmptyState, Feedback, Icon, IconButton, Input, ListRow, LoadingSkeleton, SkeletonBlock, SkeletonText, Split, SplitPane } from '@pero/app-sdk/ui';
import { scientificReferenceState, type ScientificReference, type NotebookDocument, type NotebookEntry, type NotebookEntrySummary, type NotebookNode } from '@pero/notebook';
import { NotebookEditor } from './editor';
import { messages } from './messages';
import './styles.css';

type Draft = {
  entry: NotebookEntry;
  document: NotebookDocument;
  dirty: boolean;
  newer: boolean;
  editorEpoch: number;
};

const endpoint = (id: string) => `/api/entries/${encodeURIComponent(id)}`;
function readEntry(entry: NotebookEntry): NotebookEntry {
  if (entry.document.schemaVersion !== 1) throw new Error('Unsupported Notebook document version');
  return entry;
}

function messageOf(cause: unknown) {
  if (cause instanceof AppApiError) {
    try {
      const body = JSON.parse(cause.body) as { detail?: unknown };
      if (typeof body.detail === 'string') return body.detail;
    } catch { /* Host errors need not be JSON. */ }
  }
  return cause instanceof Error ? cause.message : String(cause);
}

function hasIncompleteReference(nodes: NotebookNode[]): boolean {
  return nodes.some(node => {
    if ((node.type === 'evidence' || node.type === 'experiment') && node.attrs?.source) {
      const source = node.attrs.source as ScientificReference;
      if (scientificReferenceState(source) === 'partial') return true;
    }
    return !!node.content && hasIncompleteReference(node.content);
  });
}

function Notebook() {
  const { t, locale } = useAppI18n(messages);
  const { active } = useAppContext();
  const api = useAppApi(), chat = useAppChat();
  const [entries, setEntries] = useState<NotebookEntrySummary[] | null>(null);
  const [selected, setSelected] = useState('');
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [history, setHistory] = useState<NotebookEntrySummary[] | null>(null);
  const [snapshot, setSnapshot] = useState<NotebookEntry | null>(null);
  const [busy, setBusy] = useState<'create' | 'save' | 'history' | 'reload' | 'agent' | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [openError, setOpenError] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const catalogRequest = useRef(0);

  const current = drafts[selected];
  const shown = snapshot ?? current?.entry;
  const draft = snapshot?.document ?? current?.document;
  const refresh = useCallback(async () => {
    const request = ++catalogRequest.current;
    try {
      const { entries: list } = await api.get<{ entries: NotebookEntrySummary[] }>('/api/entries');
      if (request !== catalogRequest.current) return;
      setEntries(list);
      setSelected(previous => previous || list[0]?.id || '');
      setCatalogError('');
    } catch (cause) { if (request === catalogRequest.current) setCatalogError(messageOf(cause)); }
  }, [api]);

  useEffect(() => { if (active) void refresh(); }, [active, refresh]);
  useAppDataChanged(() => { void refresh(); setRetry(previous => previous + 1); });

  const adopt = useCallback((entry: NotebookEntry, discard = false) => {
    setDrafts(previous => {
      const existing = previous[entry.id];
      if (existing && !discard) {
        if (existing.entry.revision >= entry.revision) return previous;
        if (existing.dirty) return { ...previous, [entry.id]: { ...existing, newer: true } };
      }
      return { ...previous, [entry.id]: {
        entry, document: entry.document, dirty: false, newer: false, editorEpoch: (existing?.editorEpoch ?? 0) + 1,
      } };
    });
  }, []);

  useEffect(() => {
    if (!selected || !active) return;
    let live = true;
    setOpenError('');
    void api.get<NotebookEntry>(endpoint(selected)).then(entry => {
      if (live) adopt(readEntry(entry));
    }).catch(cause => { if (live) setOpenError(messageOf(cause)); });
    return () => { live = false; };
  }, [selected, api, retry, adopt, active]);

  useEffect(() => {
    if (!Object.values(drafts).some(draft => draft.dirty)) return;
    const keepDraft = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', keepDraft);
    return () => window.removeEventListener('beforeunload', keepDraft);
  }, [drafts]);

  const updateDraft = (change: Partial<NotebookDocument>) => {
    setDrafts(previous => {
      const draft = previous[selected];
      if (!draft) return previous;
      return { ...previous, [selected]: { ...draft, document: { ...draft.document, ...change }, dirty: true } };
    });
  };
  const choose = (id: string) => {
    if (id === selected) return;
    setSelected(id);
    setSnapshot(null);
    setHistory(null);
    setError('');
    setOpenError('');
  };
  const updateList = (entry: NotebookEntrySummary) => {
    catalogRequest.current++;
    const { id, title, revision, updatedAt } = entry;
    setEntries(previous => [{ id, title, revision, updatedAt }, ...(previous?.filter(value => value.id !== id) ?? [])]);
  };
  const perform = async (operation: NonNullable<typeof busy>, action: () => Promise<void>) => {
    setBusy(operation);
    setError('');
    try { await action(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(null); }
  };
  const create = () => perform('create', async () => {
    const entry = await api.post<NotebookEntry>('/api/entries', { title: t('untitled') });
    adopt(entry);
    updateList(entry);
    choose(entry.id);
  });
  const save = (draft: Draft) => perform('save', async () => {
    if (!draft.document.title.trim()) { setError(t('titleRequired')); return; }
    if (hasIncompleteReference(draft.document.content.content)) { setError(t('pendingReference')); return; }
    const id = draft.entry.id;
    try {
      const entry = await api.post<NotebookEntry>(endpoint(id), { baseRevision: draft.entry.revision, document: draft.document });
      setDrafts(previous => {
        const latest = previous[id];
        return { ...previous, [id]: { ...latest, entry, newer: false,
          dirty: latest.document !== draft.document, document: latest.document === draft.document ? entry.document : latest.document,
        } };
      });
      updateList(entry);
      setHistory(null);
    } catch (cause) {
      if (!(cause instanceof AppApiError) || cause.status !== 409) throw cause;
      setDrafts(previous => ({ ...previous, [id]: { ...previous[id], newer: true } }));
    }
  });
  const loadLatest = () => perform('reload', async () => {
    const entry = await api.get<NotebookEntry>(endpoint(selected));
    adopt(readEntry(entry), true);
    updateList(entry);
  });
  const showHistory = () => {
    if (history) { setHistory(null); return; }
    return perform('history', async () => {
      const result = await api.get<{ revisions: NotebookEntrySummary[] }>(`${endpoint(selected)}/revisions`);
      setHistory(result.revisions);
    });
  };

  useAppObject({
    id: 'notebook-entry',
    kind: 'notebook-entry',
    label: shown?.title || t('notebook'),
    state: shown ? { entryId: shown.id, revision: shown.revision, title: shown.title } : { phase: 'empty' },
    actions: {
      read: {
        description: 'Read this saved Notebook revision or a single block with its typed content and source references.',
        parameters: { type: 'object', properties: { blockId: { type: 'string' } }, additionalProperties: false },
        run: params => {
          if (!shown) throw new Error('Open a notebook revision first.');
          return api.post('/api/agent-read', { entryId: shown.id, revision: shown.revision, ...(params.blockId ? { blockId: params.blockId } : {}) });
        },
      },
    },
  });
  const ask = (entry: NotebookEntry) => perform('agent', async () => {
    await chat.compose(t('askPrompt', { id: entry.id, number: entry.revision }), {
      attachments: [chat.objectReference('notebook-entry', { entryId: entry.id, revision: entry.revision })],
    });
  });

  return <AppFrame label={t('notebook')} className="notebook-app"
    tools={<><Button variant="ghost" aria-expanded={navigationOpen} aria-controls="notebook-list"
      onClick={() => setNavigationOpen(open => !open)}>{t('notebooks')}</Button><Button variant="primary" disabled={!!busy} onClick={() => void create()}><Icon name="plus" /> {t('newNotebook')}</Button></>}
    actions={<IconButton label={t('refresh')} disabled={!!busy} onClick={() => { void refresh(); setRetry(value => value + 1); }}><Icon name="sync" /></IconButton>}>
    {catalogError && <Feedback kind="error" variant="block">{catalogError} <Button onClick={() => void refresh()}>{t('retry')}</Button></Feedback>}
    {error && <Feedback kind="error" variant="block">{error}</Feedback>}
    {!entries ? (catalogError ? null : <LoadingSkeleton label={t('loading')}><SkeletonBlock shape="title" width="40%" /><SkeletonText /></LoadingSkeleton>)
      : entries.length === 0 ? <EmptyState className="notebook-empty" icon={<Icon name="notebook" size={32} />}
        heading={t('noNotebooks')} description={t('start')} />
      : <Split className="notebook-split" storageKey="pero.notebook.list-width" collapseBelow={650}>
        {navigationOpen && <SplitPane as="aside" id="notebook-list" aria-label={t('notebooks')} size={240} min={175} className="notebook-nav">
          <ul className="notebook-list">
            {entries.map(entry => {
              const local = drafts[entry.id];
              return <li key={entry.id}><ListRow title={local?.document.title || entry.title} current={entry.id === selected}
                onOpen={() => { if (!busy) choose(entry.id); }}
                meta={local?.dirty ? t('unsaved') : t('revision', { number: entry.revision })} /></li>;
            })}
          </ul>
        </SplitPane>}
        <SplitPane as="section" id="notebook-document" aria-label={t('body')} min={350} className="notebook-page">
          {openError && <Feedback kind="error" variant="block">{openError} <Button onClick={() => setRetry(value => value + 1)}>{t('retry')}</Button></Feedback>}
          {!shown || !draft || !current ? (openError ? null : <LoadingSkeleton label={t('loading')}><SkeletonBlock shape="title" width="40%" /><SkeletonText /></LoadingSkeleton>)
            : <div className="notebook-document">
              <div className="notebook-document-controls">
                <span className="notebook-status" role="status">{t('revision', { number: shown.revision })}
                  {!snapshot && current.dirty ? ` · ${t(busy === 'save' ? 'saving' : 'unsaved')}` : ''}</span>
                {window.parent !== window && <Button variant="ghost" disabled={!!busy} onClick={() => void ask(shown)}><Icon name="agent" /> {t('askAgent')}</Button>}
                {snapshot ? <Button disabled={!!busy} onClick={() => setSnapshot(null)}>{t('backToDraft')}</Button> : <>
                  <Button variant="ghost" aria-expanded={!!history} disabled={!!busy} onClick={() => void showHistory()}>{t('history')}</Button>
                  <Button variant="primary" busy={busy === 'save'} disabled={!current.dirty || current.newer || !!busy}
                    onClick={() => void save(current)}><Icon name="save" /> {t('save')}</Button>
                </>}
              </div>
              {!snapshot && current.newer && <Feedback kind="warning" variant="block">
                {t('conflict')} <Button onClick={() => downloadFile('notebook-draft.json', JSON.stringify(current.document, null, 2), 'application/json')}>{t('exportDraft')}</Button>
                <Button busy={busy === 'reload'} onClick={() => void loadLatest()}>{t('loadLatest')}</Button>
              </Feedback>}
              {!snapshot && history && <section aria-label={t('history')} className="notebook-revisions">
                <ul>{history.map(revision => <li key={revision.revision}>
                  <Button variant="ghost" disabled={!!busy} onClick={() => void perform('history', async () => {
                    setSnapshot(readEntry(await api.get<NotebookEntry>(`${endpoint(selected)}/revisions/${revision.revision}`)));
                  })}>{t('revision', { number: revision.revision })}</Button>
                  <time dateTime={revision.updatedAt}>{new Date(revision.updatedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en')}</time>
                </li>)}</ul>
              </section>}
              <NotebookEditor key={snapshot ? `${snapshot.id}:revision:${snapshot.revision}` : `${selected}:draft:${current.editorEpoch}`}
                header={<header className="notebook-document-header">
                  {snapshot ? <h1>{draft.title}</h1> : <Input unstyled className="notebook-title" aria-label={t('title')} placeholder={t('untitled')}
                    value={draft.title} maxLength={200} onChange={event => updateDraft({ title: event.target.value })} />}
                  <p className="notebook-revision-date">{t('savedRevision')} <time dateTime={shown.updatedAt}>
                    {new Date(shown.updatedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en')}
                  </time></p>
                </header>}
                readonly={!!snapshot} content={draft.content} onChange={snapshot ? undefined : content => updateDraft({ content })} />
            </div>}
        </SplitPane>
      </Split>}
  </AppFrame>;
}

class NotebookErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <AppFrame label="Notebook"><Feedback kind="error" variant="block">Notebook could not load.
      <Button onClick={() => location.reload()}>Reload</Button>
      <Disclosure variant="inline" summary="Details"><pre>{this.state.error}</pre></Disclosure>
    </Feedback></AppFrame> : this.props.children;
  }
}

createRoot(document.getElementById('app')!).render(<AppProvider><NotebookErrorBoundary><Notebook /></NotebookErrorBoundary></AppProvider>);
