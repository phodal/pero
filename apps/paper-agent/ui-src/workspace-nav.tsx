import React from 'react';
import { Icon, Select, SidebarRow } from '@pero/app-sdk/ui';
import type { Translator } from './i18n';
import type { ShelfFilter } from './shelf';

export type LibraryScreen = 'papers' | 'import' | 'discovery' | 'bundle' | 'find' | 'compare' | 'results' | 'programs';

export function WorkspaceNav({ t, paperCount, readingCount, toReadCount, bundles, libraryScreen, shelfFilter, openBundleId, onLibrary, onDiscover, onResults, onPrograms, onShelf, onBundle }: {
  t: Translator;
  paperCount: number;
  readingCount: number;
  toReadCount: number;
  bundles: { id: string; title: string }[];
  libraryScreen: LibraryScreen;
  shelfFilter: ShelfFilter;
  openBundleId: string | null;
  onLibrary(): void;
  onDiscover(): void;
  onResults(): void;
  onPrograms(): void;
  onShelf(filter: 'reading' | 'to-read'): void;
  onBundle(id: string): void;
}) {
  const onPapers = libraryScreen === 'papers';
  const value = libraryScreen === 'programs' ? 'programs' : libraryScreen === 'bundle' && openBundleId ? `bundle:${openBundleId}` : libraryScreen === 'find' || libraryScreen === 'discovery' ? 'discover' : libraryScreen === 'results' ? 'results' : libraryScreen === 'papers' && shelfFilter !== 'all' ? shelfFilter : 'library';
  return <><div className="pa-workspace-switch"><Select label={t('papers')} value={value} onChange={next => {
    if (next === 'library') onLibrary(); else if (next === 'discover') onDiscover(); else if (next === 'results') onResults(); else if (next === 'programs') onPrograms();
    else if (next === 'reading' || next === 'to-read') onShelf(next); else if (next.startsWith('bundle:')) onBundle(next.slice(7));
  }} options={[{ value: 'library', label: `${t('library')} (${paperCount})` }, { value: 'discover', label: t('discoverNav') }, { value: 'results', label: t('researchResults') }, {value:'programs',label:t('autonomousResearch')},
    { value: 'reading', label: `${t('statusReading')} (${readingCount})` }, { value: 'to-read', label: `${t('statusToRead')} (${toReadCount})` },
    ...(shelfFilter === 'reviewed' ? [{ value: 'reviewed', label: t('statusReviewed') }] : []), ...bundles.map(bundle => ({ value: `bundle:${bundle.id}`, label: bundle.title }))]}/></div><nav className="pa-workspace-nav" aria-label={t('papers')}>
    <SidebarRow label={t('library')} count={paperCount} lead={<Icon name="list" size={15}/>} selected={(libraryScreen === 'papers' || libraryScreen === 'import') && shelfFilter === 'all'} onClick={onLibrary}/>
    <SidebarRow label={t('discoverNav')} lead={<Icon name="drafting-compass" size={15}/>} selected={libraryScreen === 'find' || libraryScreen === 'discovery'} onClick={onDiscover}/>
    <SidebarRow label={t('researchResults')} lead={<Icon name="file-text" size={15}/>} selected={libraryScreen === 'results'} onClick={onResults}/>
    <SidebarRow label={t('autonomousResearch')} lead={<Icon name="drafting-compass" size={15}/>} selected={libraryScreen === 'programs'} onClick={onPrograms}/>
    <p className="pa-nav-label">{t('papers')}</p>
    <SidebarRow label={t('statusReading')} count={readingCount} lead={<Icon name="skill" size={15}/>} selected={onPapers && shelfFilter === 'reading'} onClick={() => onShelf('reading')}/>
    <SidebarRow label={t('statusToRead')} count={toReadCount} lead={<Icon family="shell" name="clock" size={15}/>} selected={onPapers && shelfFilter === 'to-read'} onClick={() => onShelf('to-read')}/>
    {bundles.length > 0 && <>
      <p className="pa-nav-label">{t('collections')}</p>
      {bundles.map(bundle => <SidebarRow key={bundle.id} label={bundle.title} lead={<Icon name="folder" size={15}/>} selected={libraryScreen === 'bundle' && openBundleId === bundle.id} onClick={() => onBundle(bundle.id)}/>)}
    </>}
  </nav></>;
}
