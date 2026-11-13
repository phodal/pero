import React from 'react';
import { Select, Tabs, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
import type { Translator } from './i18n';
import type { ShelfFilter } from './shelf';

export type LibraryScreen = 'papers' | 'import' | 'discovery' | 'bundle' | 'find' | 'compare' | 'results' | 'programs';

/** Library destinations for the AppBar. Narrow windows keep one select, including shelves and collections. */
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
  const compact = libraryScreen === 'programs' ? 'programs' : libraryScreen === 'bundle' && openBundleId ? `bundle:${openBundleId}` : libraryScreen === 'find' || libraryScreen === 'discovery' ? 'discover' : libraryScreen === 'results' ? 'results' : libraryScreen === 'papers' && shelfFilter !== 'all' ? shelfFilter : 'library';
  const tab = libraryScreen === 'programs' ? 'programs' : libraryScreen === 'find' || libraryScreen === 'discovery' ? 'discover' : libraryScreen === 'results' ? 'results' : 'library';
  const choose = (next: string) => {
    if (next === 'library') onLibrary();
    else if (next === 'discover') onDiscover();
    else if (next === 'results') onResults();
    else if (next === 'programs') onPrograms();
    else if (next === 'reading' || next === 'to-read') onShelf(next);
    else if (next.startsWith('bundle:')) onBundle(next.slice(7));
  };
  return <>
    <div className="pa-workspace-switch"><Select label={t('papers')} value={compact} onChange={choose} options={[
      { value: 'library', label: `${t('library')} (${paperCount})` }, { value: 'discover', label: t('discoverNav') }, { value: 'results', label: t('researchResults') }, { value: 'programs', label: t('autonomousResearch') },
      { value: 'reading', label: `${t('statusReading')} (${readingCount})` }, { value: 'to-read', label: `${t('statusToRead')} (${toReadCount})` },
      ...(shelfFilter === 'reviewed' ? [{ value: 'reviewed', label: t('statusReviewed') }] : []), ...bundles.map(bundle => ({ value: `bundle:${bundle.id}`, label: bundle.title })),
    ]}/></div>
    <Tabs className="pa-library-scope" value={tab} onValueChange={choose}>
      <TabsList variant="navigation" aria-label={t('papers')}>
        <TabsTrigger value="library">{t('library')}</TabsTrigger>
        <TabsTrigger value="discover">{t('discoverNav')}</TabsTrigger>
        <TabsTrigger value="results">{t('researchResults')}</TabsTrigger>
        <TabsTrigger value="programs">{t('autonomousResearch')}</TabsTrigger>
      </TabsList>
    </Tabs>
    {bundles.length > 0 && <div className="pa-bundle-switch"><Select label={t('collections')} value={openBundleId ? `bundle:${openBundleId}` : ''} onChange={choose} options={[{ value: '', label: t('collections') }, ...bundles.map(bundle => ({ value: `bundle:${bundle.id}`, label: bundle.title }))]}/></div>}
  </>;
}
