/** Queries address current local entry heads; snapshots preserve the observed revision. */
export interface NotebookQuery { scope: 'entries'; title: string; text: string; tags: string[]; sort: 'updated-desc' | 'title-asc' }
export interface SavedNotebookSearch { id: string; revision: number; name: string; query: NotebookQuery; updatedAt: string }
export interface NotebookSearchResult { entryId: string; revision: number; title: string; summary: string; tags: string[]; updatedAt: string }
export interface NotebookSearchProjection { queryId: string; queryRevision: number; results: NotebookSearchResult[]; refreshedAt: string }
export interface SavedSearchAttributes {
  blockId: string; label: string; queryId: string; queryRevision: number; mode: 'live' | 'snapshot';
  snapshot: NotebookSearchProjection | null;
}
export const emptyNotebookQuery = (): NotebookQuery => ({ scope: 'entries', title: '', text: '', tags: [], sort: 'updated-desc' });
export const searchResultLocation = (result: NotebookSearchResult): string =>
  `pero-app-location://notebook/main/entry/${encodeURIComponent(result.entryId)}/revision/${result.revision}`;

export function isSavedSearchAttributes(value: Record<string, unknown>): boolean {
  const id = (item: unknown) => typeof item === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(item);
  const revision = (item: unknown) => typeof item === 'number' && Number.isSafeInteger(item) && item >= 1;
  const text = (item: unknown, max: number) => typeof item === 'string' && item.length <= max;
  if (!id(value.blockId) || !id(value.queryId) || !revision(value.queryRevision) || !text(value.label, 200) || !['live', 'snapshot'].includes(String(value.mode))) return false;
  if (value.mode === 'live') return value.snapshot === null;
  const snapshot = value.snapshot as NotebookSearchProjection | null;
  return !!snapshot && snapshot.queryId === value.queryId && snapshot.queryRevision === value.queryRevision &&
    text(snapshot.refreshedAt, 64) && Number.isFinite(Date.parse(snapshot.refreshedAt)) && Array.isArray(snapshot.results) && snapshot.results.length <= 200 &&
    snapshot.results.every(row => id(row.entryId) && revision(row.revision) && text(row.title, 200) && text(row.summary, 500) && text(row.updatedAt, 64) &&
      Array.isArray(row.tags) && row.tags.length <= 50 && row.tags.every(tag => text(tag, 100)));
}
