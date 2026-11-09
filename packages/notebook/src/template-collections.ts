/** Stable organization identities are separate from immutable published content. */
export interface TemplateCollection { id: string; name: string; parentId: string | null }
export interface TemplateCollectionLibrary { revision: number; collections: TemplateCollection[]; memberships: Record<string, string> }
export type TemplateCollectionChange =
  | { type: 'create'; name: string; parentId: string | null }
  | { type: 'rename'; id: string; name: string }
  | { type: 'move'; id: string; parentId: string | null }
  | { type: 'assign-template'; templateId: string; collectionId: string | null };
export interface TemplateCollectionHistory { revision: number; occurredAt: string; change: TemplateCollectionChange; subject: string; destination: string[] }

export function collectionPath(collections: readonly TemplateCollection[], id: string): TemplateCollection[] {
  const path: TemplateCollection[] = [], visited = new Set<string>();
  let current = collections.find(item => item.id === id);
  while (current && !visited.has(current.id)) {
    path.unshift(current); visited.add(current.id);
    current = collections.find(item => item.id === current!.parentId);
  }
  return path;
}
export function collectionDestinations(collections: readonly TemplateCollection[], movingId?: string): TemplateCollection[] {
  return collections.filter(item => !collectionPath(collections, item.id).some(parent => parent.id === movingId))
    .sort((a, b) => collectionPath(collections, a.id).map(item => item.name).join('/').localeCompare(collectionPath(collections, b.id).map(item => item.name).join('/')));
}
