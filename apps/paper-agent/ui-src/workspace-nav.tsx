import React from 'react';
import { Icon, SidebarRow } from '@pero/app-sdk/ui';
import type { Translator } from './i18n';
import type { ShelfFilter } from './shelf';

type LibraryScreen = 'papers' | 'import' | 'discovery' | 'bundle' | 'find';

export function WorkspaceNav({ t, paperCount, readingCount, toReadCount, bundles, libraryScreen, shelfFilter, openBundleId, onLibrary, onDiscover, onShelf, onBundle }: {
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
  onShelf(filter: 'reading' | 'to-read'): void;
  onBundle(id: string): void;
}) {
  const onPapers = libraryScreen === 'papers';
  return <nav className="pa-workspace-nav" aria-label={t('papers')}>
    <SidebarRow label={t('library')} count={paperCount} lead={<Icon name="list" size={15}/>} selected={(libraryScreen === 'papers' || libraryScreen === 'import') && shelfFilter === 'all'} onClick={onLibrary}/>
    <SidebarRow label={t('discoverNav')} lead={<Icon name="drafting-compass" size={15}/>} selected={libraryScreen === 'find' || libraryScreen === 'discovery'} onClick={onDiscover}/>
    <p className="pa-nav-label">{t('papers')}</p>
    <SidebarRow label={t('statusReading')} count={readingCount} lead={<Icon name="skill" size={15}/>} selected={onPapers && shelfFilter === 'reading'} onClick={() => onShelf('reading')}/>
    <SidebarRow label={t('statusToRead')} count={toReadCount} lead={<Icon family="shell" name="clock" size={15}/>} selected={onPapers && shelfFilter === 'to-read'} onClick={() => onShelf('to-read')}/>
    {bundles.length > 0 && <>
      <p className="pa-nav-label">{t('collections')}</p>
      {bundles.map(bundle => <SidebarRow key={bundle.id} label={bundle.title} lead={<Icon name="folder" size={15}/>} selected={libraryScreen === 'bundle' && openBundleId === bundle.id} onClick={() => onBundle(bundle.id)}/>)}
    </>}
  </nav>;
}
