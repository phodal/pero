import React, { useRef, useState } from 'react';
import { Button, EmptyIllustration, EmptyState, Icon, LibraryHeader, LoadingSkeleton, SkeletonBlock, Split, SplitPane } from '@pero/app-sdk/ui';
import { PaperList } from './library';
import { LibrarySearch } from './library-search';
import { PaperInspector } from './paper-inspector';
import { cycleStatus, statusOf, type Shelf, type ShelfFilter, type ShelfStatus } from './shelf';
import type { Api, Library, LocalSearchHit, Paper } from './types';
import type { Translator } from './i18n';

/** Preview owns no source copy: every action uses the selected saved Paper. */
export function LibraryPapers({ api, papers, shelf, library, filter, loading, unavailable = false, savingId, activeHitId, locked, showDetails, t, onFilter, onStatus, onRefresh, onImport, onRead, onRecords, onDiscover, onDownload, onSearchHit, onFind, onCompare, onAsk }: {
  api: Api; papers: Paper[]; shelf: Shelf; library?: Pick<Library, 'intents' | 'studies' | 'discoveries' | 'favorites'>;
  filter: ShelfFilter; loading: boolean; unavailable?: boolean; savingId?: string; activeHitId?: string; locked: boolean; showDetails: boolean; t: Translator;
  onFilter(value: ShelfFilter): void; onStatus(id: string, value: ShelfStatus): void; onRefresh(): void; onImport(): void;
  onRead(paper: Paper): void; onRecords(paper: Paper): void; onDiscover(paper: Paper): void; onDownload(paper: Paper, format: 'pdf' | 'tex'): void;
  onSearchHit(hit: LocalSearchHit): Promise<void>; onFind(): void; onCompare(ids: string[]): void;
  onAsk?(paper: Paper, message: string): void;
}) {
  const [sort, setSort] = useState<'recent' | 'title'>('recent');
  const [previewId, setPreviewId] = useState<string | null>(null), [selected, setSelected] = useState<string[]>([]), [query, setQuery] = useState('');
  const inspector = useRef<HTMLElement>(null);
  const rows = papers.filter(paper => filter === 'all' || statusOf(shelf, paper.id) === filter)
    .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : b.fetchedAt.localeCompare(a.fetchedAt));
  const paper = rows.find(paper => paper.id === previewId) ?? rows[0];
  const selectedIds = selected.filter(id => papers.some(paper => paper.id === id));
  const title = filter === 'all' ? 'allPapers' : filter === 'reading' ? 'statusReading' : filter === 'to-read' ? 'statusToRead' : 'statusReviewed';
  function preview(paper: Paper) {
    setPreviewId(paper.id);
    if (window.matchMedia('(max-width: 940px)').matches) requestAnimationFrame(() => inspector.current?.focus());
  }
  return <Split storageKey="paper-agent.library-preview" collapseBelow={940} className="pa-library-papers">
    <SplitPane id="paper-library-list" min={360} className="pa-library-list-pane">
      <LibraryHeader className="pa-library-heading" title={t(title)} subtitle={`${rows.length} ${t('sourcesCount')}`} actions={<><Button variant="ghost" aria-label={t('refresh')} onClick={onRefresh}><Icon name="refresh" size={15}/></Button><Button variant="primary" onClick={onImport}><Icon name="plus" size={15}/>{t('add')}</Button></>}/>
      {loading ? <LoadingSkeleton label={t('loading')}>{[0, 1, 2].map(row => <div className="pa-library-placeholder" key={row}>
        <SkeletonBlock shape="title" width={row === 1 ? '68%' : '84%'}/><SkeletonBlock width="42%"/>
      </div>)}</LoadingSkeleton> : !unavailable && <LibrarySearch api={api} t={t} activeHitId={activeHitId} onOpen={onSearchHit} onQueryChange={setQuery} onFind={onFind}>
        {!papers.length ? <EmptyState icon={<EmptyIllustration kind="documents"/>} heading={t('emptyLibrary')} description={t('emptyLibraryCopy')}/> : <>
          <PaperList papers={rows} sort={sort} onSort={setSort} selected={selectedIds} previewId={paper?.id ?? ''} locked={locked} shelf={shelf} shelfFilter={filter} onShelfFilter={onFilter}
            onCycleStatus={id => onStatus(id, cycleStatus(statusOf(shelf, id)))}
            onFindMore={onFind} onRead={onRead} onPreview={preview} onSelect={(id, checked) => setSelected(current => checked ? [...current, id] : current.filter(value => value !== id))} t={t}/>
          <div className="pa-library-selection"><span>{t(selectedIds.length ? 'selectedPapers' : 'previewHint')}{selectedIds.length ? ` ${selectedIds.length}` : ''}</span><div className="pa-actions">{selectedIds.length > 0 && <Button variant="ghost" onClick={() => setSelected([])}>{t('clearSelection')}</Button>}<Button disabled={locked || selectedIds.length < 2} onClick={() => onCompare(selectedIds)}><Icon name="columns" size={14}/>{t('comparePapers')}</Button></div></div>
        </>}
      </LibrarySearch>}
    </SplitPane>
    {showDetails && paper && !loading && !query && <SplitPane id="paper-library-inspector" size={400} min={320} resizeLabel={t('resizePaperDetails')} className="pa-library-inspector-pane" stackedBasis="auto">
      <PaperInspector ref={inspector} api={api} paper={paper} shelf={shelf} library={library} savingId={savingId} locked={locked} t={t}
        onStatus={onStatus} onRead={onRead} onRecords={onRecords} onDiscover={onDiscover} onDownload={onDownload} onAsk={onAsk}/>
    </SplitPane>}
  </Split>;
}
