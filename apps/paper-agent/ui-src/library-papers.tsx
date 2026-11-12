import React, { useRef, useState } from 'react';
import { Button, EmptyIllustration, EmptyState, Icon, LibraryHeader, LoadingSkeleton, Select, SkeletonBlock, Split, SplitPane } from '@pero/app-sdk/ui';
import { addedText, contentKind, PaperList, paperSource } from './library';
import { LibrarySearch } from './library-search';
import { cycleStatus, isShelfStatus, statusOf, type Shelf, type ShelfFilter, type ShelfStatus } from './shelf';
import type { Api, LocalSearchHit, Paper } from './types';
import type { Translator } from './i18n';

/** Preview owns no source copy: every action uses the selected saved Paper. */
export function LibraryPapers({ api, papers, shelf, filter, loading, unavailable = false, savingId, activeHitId, locked, showDetails, t, onFilter, onStatus, onRefresh, onImport, onRead, onRecords, onDiscover, onDownload, onSearchHit, onFind, onCompare }: {
  api: Api; papers: Paper[]; shelf: Shelf; filter: ShelfFilter; loading: boolean; unavailable?: boolean; savingId?: string; activeHitId?: string; locked: boolean; showDetails: boolean; t: Translator;
  onFilter(value: ShelfFilter): void; onStatus(id: string, value: ShelfStatus): void; onRefresh(): void; onImport(): void;
  onRead(paper: Paper): void; onRecords(paper: Paper): void; onDiscover(paper: Paper): void; onDownload(paper: Paper, format: 'pdf' | 'tex'): void;
  onSearchHit(hit: LocalSearchHit): Promise<void>; onFind(): void; onCompare(ids: string[]): void;
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
    {showDetails && paper && !loading && !query && <SplitPane id="paper-library-inspector" size={320} min={270} resizeLabel={t('resizePaperDetails')} className="pa-library-inspector-pane" stackedBasis="auto">
      <section ref={inspector} tabIndex={-1} className="pa-paper-inspector" aria-label={t('paperDetails')}>
        <header className="pa-inspector-identity">
          <h2>{paper.title}</h2>
          {!!paper.authors.length && <p className="pa-inspector-authors">{paper.authors.join(', ')}</p>}
        </header>
        <div className="pa-inspector-decision">
          <Select label={t('readingStatus')} value={statusOf(shelf, paper.id)} onChange={value => { if (isShelfStatus(value)) onStatus(paper.id, value); }} options={[
            { value: 'to-read', label: t('statusToRead') }, { value: 'reading', label: t('statusReading') }, { value: 'reviewed', label: t('statusReviewed') },
          ]}/>
          <Button variant="primary" className="pa-inspector-read" onClick={() => onRead(paper)}><Icon name="skill" size={15}/>{t(statusOf(shelf, paper.id) === 'to-read' ? 'read' : 'continueReading')}<Icon name="arrow" size={14}/></Button>
        </div>
        <p className="pa-inspector-facts">{[paperSource(paper, t), contentKind(paper, t), addedText(paper.fetchedAt, t)].filter(Boolean).join(' · ')}</p>
        <div className="pa-inspector-actions">
          {paper.source !== 'local-pdf' && <a className="pa-inspector-original" href={paper.url} target="_blank" rel="noreferrer">{t('openOriginal')}<Icon name="open" size={12}/></a>}
          <Button variant="ghost" onClick={() => onRecords(paper)}><Icon family="shell" name="clock" size={14}/>{t('researchProgress')}</Button>
          <Button variant="ghost" onClick={() => onDiscover(paper)}><Icon name="drafting-compass" size={14}/>{t('discover')}</Button>
          <Button variant="ghost" disabled={!!savingId || !(paper.pdfUrl || paper.pdfCandidateUrl || paper.hasCachedPdf)} onClick={() => onDownload(paper, 'pdf')}><Icon name="file-text" size={14}/>{t('downloadPdf')}</Button>
          {paper.arxivUrl && <Button variant="ghost" disabled={!!savingId} onClick={() => onDownload(paper, 'tex')}><Icon name="file-code" size={14}/>{t('downloadTex')}</Button>}
        </div>
      </section>
    </SplitPane>}
  </Split>;
}
