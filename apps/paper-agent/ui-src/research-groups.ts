import type { ResearchResource } from './research-types';

/** A review row groups confirmed representations, never file identities or grants. */
export type ResearchResourceGroup = Readonly<{
  id: string;
  primary: ResearchResource;
  resources: readonly ResearchResource[];
  html: ResearchResource | null;
}>;

export function groupResearchResources(resources: readonly ResearchResource[]): ResearchResourceGroup[] {
  const rows = new Map<string, ResearchResource[]>();
  for (const resource of resources) {
    const paper = ['paper', 'pdf_candidate', 'source_archive'].includes(resource.kind);
    const id = paper && resource.workIdentity && resource.revision
      ? `work:${resource.workIdentity}:${resource.revision}` : `resource:${resource.id}`;
    const row = rows.get(id) ?? [];
    row.push(resource); rows.set(id, row);
  }
  return [...rows].map(([id, members]) => {
    const primary = members.find(r => r.kind === 'paper') ?? members.find(r => r.kind === 'pdf_candidate') ?? members[0];
    const html = [primary, ...members].find(r => ['paper', 'pdf_candidate'].includes(r.kind)
      && r.workIdentity?.startsWith('arxiv:') && /^v[1-9]\d*$/.test(r.revision ?? '')) ?? null;
    return { id, primary, resources: members, html };
  });
}
