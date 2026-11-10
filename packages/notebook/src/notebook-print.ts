import type { NotebookDocument, NotebookNode } from './document.ts';

export interface NotebookPrintSettings { version: 1; orientation: 'portrait' | 'landscape'; paper: 'A4' | 'Letter'; marginMm: number; includeMetadata: boolean; includeInputs: boolean; sections: string[] }
export interface NotebookPrintSection { id: string; label: string; kind: 'notes' | 'section' | 'procedure'; nodes?: NotebookNode[]; procedureId?: string }
/** User-authored names only. Empty means the editor supplies the locale fallback. */
function authoredPrintLabel(value: unknown): string {
  const label = typeof value === 'string' ? value : '';
  return label.trim() ? label : '';
}
export function notebookPrintSections(document: NotebookDocument): NotebookPrintSection[] {
  const ordinary = document.content.content.filter(node => node.type !== 'section');
  return [
    ...(ordinary.length ? [{ id: 'notes', label: '', kind: 'notes' as const, nodes: ordinary }] : []),
    ...document.content.content.filter(node => node.type === 'section').map(node => ({ id: `section:${node.attrs!.blockId}`, label: authoredPrintLabel(node.attrs?.label), kind: 'section' as const, nodes: [node] })),
    ...(document.procedures ?? []).map(procedure => ({ id: `procedure:${procedure.id}`, label: authoredPrintLabel(procedure.title), kind: 'procedure' as const, procedureId: procedure.id })),
  ];
}
export function defaultPrintSettings(document: NotebookDocument): NotebookPrintSettings {
  return { version: 1, orientation: 'portrait', paper: 'A4', marginMm: 15, includeMetadata: true, includeInputs: false, sections: notebookPrintSections(document).map(section => section.id) };
}
/** Validate storage only at its boundary; removed section identities are discarded. */
export function parsePrintSettings(value: unknown, document: NotebookDocument): NotebookPrintSettings {
  const fallback = defaultPrintSettings(document);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const saved = value as Record<string, unknown>;
  if (saved.version !== 1 || !['portrait', 'landscape'].includes(String(saved.orientation)) || !['A4', 'Letter'].includes(String(saved.paper)) ||
      typeof saved.marginMm !== 'number' || !Number.isFinite(saved.marginMm) || saved.marginMm < 5 || saved.marginMm > 40 ||
      typeof saved.includeMetadata !== 'boolean' || typeof saved.includeInputs !== 'boolean' || !Array.isArray(saved.sections) || !saved.sections.every(id => typeof id === 'string')) return fallback;
  const ids = new Set(fallback.sections);
  return { version: 1, orientation: saved.orientation as NotebookPrintSettings['orientation'], paper: saved.paper as NotebookPrintSettings['paper'],
    marginMm: saved.marginMm, includeMetadata: saved.includeMetadata, includeInputs: saved.includeInputs, sections: [...new Set(saved.sections as string[])].filter(id => ids.has(id)) };
}
export function notebookPageRule(settings: NotebookPrintSettings): string {
  return `@page { size: ${settings.paper} ${settings.orientation}; margin: ${settings.marginMm}mm; }`;
}
