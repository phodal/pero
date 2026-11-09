import { NotebookHomeTools } from './notebook-home';
import { NotebookPrintTools } from './notebook-print';
import { WorksheetAmendments } from './worksheet-amendments';
import { parseNotebookLink } from '@pero/notebook/workspace';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppApiError, AppProvider, downloadFile, useAppApi, useAppChat, useAppContext, useAppDataChanged, useAppI18n, useAppObject } from '@pero/app-sdk';
import { AppFrame, Button, Disclosure, EmptyState, Feedback, FilePicker, Icon, IconButton, Input, ListRow, LoadingSkeleton, SkeletonBlock, SkeletonText, Split, SplitPane } from '@pero/app-sdk/ui';
import { scientificReferenceState, type ScientificReference, type NotebookDocument, type NotebookEntry, type NotebookEntrySummary, type NotebookNode } from '@pero/notebook';
import { documentHistory, transitionDocument, type DocumentHistory } from '@pero/notebook/document-history';
import { NotebookEditor } from './editor';
import { documentHistoryShortcut } from './workspace-views';
import { NOTEBOOK_SEARCH_OPEN_EVENT } from './saved-search';
import { messages } from './messages';
import './styles.css';

type Draft = {
  entry: NotebookEntry;
  document: NotebookDocument;
  dirty: boolean;
  newer: boolean;
  editorEpoch: number;
  history: DocumentHistory;
  durable: boolean;
  storageError: string;
  recovery?: string;
  recoveryProtected?: boolean;
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
  const [replacementNotice, setReplacementNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const catalogRequest = useRef(0);

  const latestDrafts = useRef(drafts);
  latestDrafts.current = drafts;
  const draftWriteEpoch = useRef<Record<string, number>>({});
  const writes = useRef(new Map<string, Promise<unknown>>());
  const sequence = <T,>(id: string, action: () => Promise<T>): Promise<T> => {
    const next = (writes.current.get(id) ?? Promise.resolve()).catch(() => {}).then(action);
    writes.current.set(id, next);
    return next;
  };
  const navigationRequest = useRef(0);
  const handledLink = useRef('');
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
  useEffect(() => {
    const followLink = () => {
      const hash = window.location.hash, link = parseNotebookLink(hash);
      // Wait for the first catalog load, but open valid deep links even when the
      // summary list is still stale after an out-of-band create.
      if (entries === null || handledLink.current === hash || !link || !/^[a-f0-9]{32}$/.test(link.entryId)) return;
      handledLink.current = hash;
      navigationRequest.current++;
      setSelected(link.entryId); setSnapshot(null); setHistory(null); setOpenError('');
      if (!entries.some(entry => entry.id === link.entryId)) void refresh();
    };
    followLink(); window.addEventListener('hashchange', followLink);
    return () => window.removeEventListener('hashchange', followLink);
  }, [entries, refresh]);


  const adopt = useCallback((entry: NotebookEntry, discard = false) => {
    setDrafts(previous => {
      const existing = previous[entry.id];
      if (existing && !discard) {
        if (existing.entry.revision >= entry.revision) return previous;
        if (existing.dirty) return { ...previous, [entry.id]: { ...existing, newer: true } };
      }
      return { ...previous, [entry.id]: {
        entry, document: entry.document, history: documentHistory(entry.document), durable: true, storageError: '', dirty: false, newer: false, editorEpoch: (existing?.editorEpoch ?? 0) + 1,
      } };
    });
  }, []);

  useEffect(() => {
    if (!selected || !active) return;
    let live = true;
    setOpenError('');
    void api.get<NotebookEntry>(endpoint(selected)).then(async entry => {
      if (!live) return;
      if (latestDrafts.current[entry.id]) { adopt(readEntry(entry)); return; }
      type StoredDraft = { baseRevision: number; document: NotebookDocument };
      let stored: StoredDraft | null = null;
      let storageError = '', recovery: string | undefined;
      try { stored = (await api.get<{ draft: StoredDraft | null }>(`${endpoint(selected)}/draft`)).draft; }
      catch (cause) {
        storageError = messageOf(cause);
        if (cause instanceof AppApiError) {
          try { recovery = (JSON.parse(cause.body) as { recovery?: string }).recovery; } catch { /* Keep transport error. */ }
        }
      }
      if (!live) return;
      const document = stored?.document ?? entry.document;
      setDrafts(previous => previous[entry.id] ? previous : { ...previous, [entry.id]: {
        entry, document, history: documentHistory(document), dirty: !!stored,
        newer: !!stored && stored.baseRevision !== entry.revision,
        durable: true, storageError, recovery, recoveryProtected: !!storageError, editorEpoch: 1,
      } });
    }).catch(cause => { if (live) setOpenError(messageOf(cause)); });
    return () => { live = false; };
  }, [selected, api, retry, adopt, active]);

  useEffect(() => {
    if (!Object.values(drafts).some(draft => !draft.durable)) return;
    const keepDraft = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', keepDraft);
    return () => window.removeEventListener('beforeunload', keepDraft);
  }, [drafts]);

  useEffect(() => {
    const timers = Object.entries(drafts).filter(([, draft]) => !draft.durable && !draft.newer && !draft.storageError).map(([id, draft]) => {
      const epoch = draftWriteEpoch.current[id] ?? 0;
      return window.setTimeout(() => {
      void sequence(id, async () => {
        if (latestDrafts.current[id] !== draft || epoch !== (draftWriteEpoch.current[id] ?? 0)) return;
        try {
          await api.post(`${endpoint(id)}/draft`, { baseRevision: draft.entry.revision, document: draft.document });
          setDrafts(previous => previous[id]?.document !== draft.document ? previous : {
            ...previous, [id]: { ...previous[id], durable: true },
          });
        } catch (cause) {
          setDrafts(previous => previous[id]?.document !== draft.document ? previous : {
            ...previous, [id]: { ...previous[id], storageError: messageOf(cause),
              newer: cause instanceof AppApiError && cause.status === 409 || previous[id].newer },
          });
        }
      });
    }, 800); });
    return () => timers.forEach(window.clearTimeout);
  }, [drafts, api]);

  const applyHistory = (edit: Parameters<typeof transitionDocument>[1]) => {
    setDrafts(previous => {
      const draft = previous[selected];
      if (!draft) return previous;
      const history = transitionDocument(draft.history, edit);
      if (history === draft.history) return previous;
      return { ...previous, [selected]: { ...draft, history, document: history.present, dirty: true, durable: false,
        storageError: draft.recoveryProtected ? draft.storageError : '' } };
    });
  };
  const updateDraft = (change: Partial<NotebookDocument>, group: string | null = Object.keys(change).join(',')) => {
    const at = Date.now();
    setDrafts(previous => {
      const draft = previous[selected];
      if (!draft) return previous;
      const history = transitionDocument(draft.history, { type: 'edit', document: { ...draft.document, ...change }, group, at });
      if (history === draft.history) return previous;
      return { ...previous, [selected]: { ...draft, history, document: history.present, dirty: true, durable: false,
        storageError: draft.recoveryProtected ? draft.storageError : '' } };
    });
  };
  const choose = (id: string) => {
    if (id === selected) return;
    setSelected(id); setReplacementNotice('');
    setSnapshot(null);
    setHistory(null);
    setError('');
    setOpenError('');
  };
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'pero:app:location' || typeof event.data.location !== 'string') return;
      const match = /^entry\/([a-f0-9]{32})$/.exec(event.data.location);
      if (!match) return;
      navigationRequest.current++;
      setSelected(match[1]); setSnapshot(null); setHistory(null); setError(''); setOpenError('');
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
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
  const createFromDocument = async (document: NotebookDocument) => {
    const entry = await api.post<NotebookEntry>('/api/entries', { document });
    adopt(readEntry(entry)); updateList(entry); choose(entry.id);
  };
  const importNotebook = (file: File) => perform('create', async () => {
    if (file.size > 2 * 1024 * 1024) throw new Error(t('importNotebookLimit'));
    // Validate and create atomically before the editor can normalize unknown data.
    const document: unknown = JSON.parse(await file.text());
    const entry = await api.post<NotebookEntry>('/api/entries', { document });
    adopt(readEntry(entry));
    updateList(entry);
    choose(entry.id);
  });
  useEffect(() => {
    const openRevision = (event: Event) => {
      const target = (event as CustomEvent<{ entryId?: unknown; revision?: unknown }>).detail;
      if (!target || typeof target.entryId !== 'string' || !/^[a-f0-9]{32}$/.test(target.entryId) || !Number.isSafeInteger(target.revision) || Number(target.revision) < 1) return;
      const request = ++navigationRequest.current;
      void api.get<NotebookEntry>(`${endpoint(target.entryId)}/revisions/${target.revision}`).then(entry => {
        if (request !== navigationRequest.current) return;
        choose(entry.id); setSnapshot(readEntry(entry));
      }).catch(cause => { if (request === navigationRequest.current) setError(messageOf(cause)); });
    };
    window.addEventListener(NOTEBOOK_SEARCH_OPEN_EVENT, openRevision);
    return () => { navigationRequest.current++; window.removeEventListener(NOTEBOOK_SEARCH_OPEN_EVENT, openRevision); };
  }, [api]);
  const save = (draft: Draft) => perform('save', async () => {
    if (!draft.document.title.trim()) { setError(t('titleRequired')); return; }
    if (hasIncompleteReference(draft.document.content.content)) { setError(t('pendingReference')); return; }
    const id = draft.entry.id;
    draftWriteEpoch.current[id] = (draftWriteEpoch.current[id] ?? 0) + 1;
    try {
      const entry = await sequence(id, async () => {
        const saved = await api.post<NotebookEntry>(endpoint(id), { baseRevision: draft.entry.revision, document: draft.document });
        // The published document replaces any earlier debounce copy. A copy left behind reloads in place of this revision.
        await api.post(`${endpoint(id)}/draft/discard`, { baseRevision: saved.revision });
        return saved;
      });
      setDrafts(previous => {
        const latest = previous[id];
        return { ...previous, [id]: { ...latest, entry, newer: false,
          durable: latest.document === draft.document, storageError: '', dirty: latest.document !== draft.document, document: latest.document === draft.document ? entry.document : latest.document,
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
    draftWriteEpoch.current[selected] = (draftWriteEpoch.current[selected] ?? 0) + 1;
    const entry = await sequence(selected, async () => {
      const entry = await api.get<NotebookEntry>(endpoint(selected));
      await api.post(`${endpoint(selected)}/draft/discard`, { baseRevision: entry.revision });
      return entry;
    });
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
    state: shown ? {
      entryId: shown.id, revision: shown.revision, title: shown.title,
      discovery: 'Call read for this entry and revision. A large entry returns format=block-index with blockId values. Pass offset to continue.',
    } : { phase: 'empty' },
    actions: {
      read: {
        description: 'Read this open saved revision. A large entry returns format=block-index with up to 100 block IDs and types. Pass blockId to read one block, or offset to continue an index page or JSON chunk. This reads only the open entry at its saved revision.',
        parameters: {
          type: 'object',
          properties: {
            blockId: { type: 'string', minLength: 1, maxLength: 128 },
            offset: { type: 'integer', minimum: 0, maximum: 2147483647 },
            view: { type: 'string', enum: ['index'] },
          },
          additionalProperties: false,
        },
        run: params => {
          if (!shown) throw new Error('Open a notebook revision first.');
          return api.post('/api/agent-read', {
            entryId: shown.id,
            revision: shown.revision,
            ...(typeof params.blockId === 'string' ? { blockId: params.blockId } : {}),
            ...(typeof params.offset === 'number' ? { offset: params.offset } : {}),
            ...(params.view ? { view: params.view } : {}),
          });
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
      onClick={() => setNavigationOpen(open => !open)}>{t('notebooks')}</Button><Button variant="primary" disabled={!!busy} onClick={() => void create()}><Icon name="plus" /> {t('newNotebook')}</Button>
      <FilePicker compact label={t('importNotebook')} emptyLabel="" accept=".json,application/json" variant="ghost" disabled={!!busy} onFile={file => void importNotebook(file)} /></>}
    actions={<IconButton label={t('refresh')} disabled={!!busy} onClick={() => { void refresh(); setRetry(value => value + 1); }}><Icon name="sync" /></IconButton>}>
    {catalogError && <Feedback kind="error" variant="block">{catalogError} <Button onClick={() => void refresh()}>{t('retry')}</Button></Feedback>}
    {error && <Feedback kind="error" variant="block">{error}</Feedback>}
    {replacementNotice && <Feedback kind="success" variant="block">{replacementNotice}</Feedback>}
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
            : <div className="notebook-document" onKeyDownCapture={event => {
              const action = snapshot ? null : documentHistoryShortcut(event);
              if (!action) return;
              event.preventDefault(); event.stopPropagation();
              applyHistory({ type: action });
            }}>
              <div className="notebook-document-controls">
                <span className="notebook-status" role="status">{t('revision', { number: shown.revision })}
                  {!snapshot && current.dirty ? ` · ${busy === 'save' ? t('saving') : current.durable ? t('draftStored') : current.storageError ? t('draftNotStored') : t('draftStoring')}` : ''}</span>
                {window.parent !== window && <Button variant="ghost" disabled={!!busy} onClick={() => void ask(shown)}><Icon name="agent" /> {t('askAgent')}</Button>}
                {snapshot ? <><Button disabled={!!busy} onClick={() => setSnapshot(null)}>{t('backToDraft')}</Button>
                  <Button disabled={!!busy || current.newer} onClick={() => {
                    try {
                      const restored = transitionDocument(current.history, { type: 'restore', document: snapshot.document });
                      setDrafts(previous => ({ ...previous, [selected]: { ...previous[selected], history: restored,
                        document: restored.present, dirty: true, durable: false, storageError: previous[selected].recoveryProtected ? previous[selected].storageError : '' } }));
                      setSnapshot(null);
                    } catch (cause) { setError(messageOf(cause)); }
                  }}>{t('restoreDraft')}</Button></> : <>
                  <Button variant="ghost" aria-expanded={!!history} disabled={!!busy} onClick={() => void showHistory()}>{t('history')}</Button>
                  <Button variant="primary" busy={busy === 'save'} disabled={!current.dirty || current.newer || current.recoveryProtected || !!busy}
                    onClick={() => void save(current)}><Icon name="save" /> {t('save')}</Button>
                </>}
                <NotebookHomeTools key={`home:${shown.id}:${shown.revision}`} entry={shown} document={draft} dirty={!snapshot && current.dirty} readonly={!!snapshot || !!busy}
                  onOpenEntry={id => { if (!busy) choose(id); }} onMetadata={metadata => updateDraft({ metadata })} />
                <NotebookPrintTools key={`print:${shown.id}:${shown.revision}`} document={draft} entryId={shown.id} revision={shown.revision} dirty={!snapshot && current.dirty} />
                <WorksheetAmendments key={`amend:${shown.id}:${shown.revision}`} entry={shown} dirty={current.dirty} readonly={!!snapshot || !!busy}
                  onCommitted={entry => { adopt(readEntry(entry)); updateList(entry); }} />
              </div>
              {!snapshot && current.storageError && <Feedback kind="error" variant="block">{current.storageError}
                <Button onClick={() => downloadFile('notebook-draft-recovery.json', current.recovery ?? JSON.stringify(current.document, null, 2), 'application/json')}>{t('exportRecovery')}</Button>
                {!current.recoveryProtected && <Button onClick={() => setDrafts(previous => ({ ...previous, [selected]: { ...previous[selected], durable: false, storageError: '' } }))}>{t('retry')}</Button>}
                <Button onClick={() => { if (window.confirm(t('discardRecoveryConfirm'))) void loadLatest(); }}>{t('discardRecovery')}</Button>
              </Feedback>}
              {!snapshot && current.newer && <Feedback kind="warning" variant="block">
                {t('conflict')} <Button onClick={() => downloadFile('notebook-draft.json', JSON.stringify(current.document, null, 2), 'application/json')}>{t('exportDraft')}</Button>
                <Button busy={busy === 'reload'} onClick={() => { if (window.confirm(t('discardDraftConfirm'))) void loadLatest(); }}>{t('loadLatest')}</Button>
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
                  {snapshot ? <h1>{draft.title}</h1> : <Input unstyled data-notebook-document-edit className="notebook-title" aria-label={t('title')} placeholder={t('untitled')}
                    value={draft.title} maxLength={200} onChange={event => updateDraft({ title: event.target.value })} />}
                  <p className="notebook-revision-date">{t('savedRevision')} <time dateTime={shown.updatedAt}>
                    {new Date(shown.updatedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en')}
                  </time></p>
                </header>}
                historyControls={{ canUndo: !!current.history.past.length, canRedo: !!current.history.future.length, undo: () => applyHistory({ type: 'undo' }), redo: () => applyHistory({ type: 'redo' }) }}
                onSave={snapshot ? undefined : () => { if (current.dirty && !current.newer && !current.recoveryProtected && !busy) void save(current); }}
                onReplaceDocument={snapshot ? undefined : document => {
                  const history = transitionDocument(current.history, { type: 'restore', document });
                  setReplacementNotice(t('documentReplaced'));
                  setDrafts(previous => ({ ...previous, [selected]: { ...previous[selected], history, document: history.present, dirty: true, durable: false,
                    editorEpoch: previous[selected].editorEpoch + 1, storageError: previous[selected].recoveryProtected ? previous[selected].storageError : '' } }));
                }}
                readonly={!!snapshot} document={draft} entryId={shown.id} revision={shown.revision} onCreateEntry={createFromDocument} onDocumentChange={snapshot ? undefined : updateDraft}
                content={draft.content} onChange={snapshot ? undefined : (content, group) => updateDraft({ content }, group)} />
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
