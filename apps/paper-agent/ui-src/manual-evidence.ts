import type { Report } from './types';

export type ManualEvidence = { paperId: string; reportId: string | null; stance: 'support' | 'counterevidence' | 'gap'; note: string };

/** Rows, not paper identities, own edits: one paper can have conflicting evidence. */
export function reviseEvidence(items: ManualEvidence[], index: number, patch: Partial<ManualEvidence> | null): ManualEvidence[] {
  return patch === null ? items.filter((_, position) => position !== index)
    : items.map((item, position) => position === index ? { ...item, ...patch } : item);
}

/** Intent membership and paper labels do not establish a citation. */
export function reportsCitingPaper(reports: Report[], paperId: string): Report[] {
  return reports.filter(report => [...(report.sections ?? []), ...(report.experiments ?? []), ...(report.matrix?.cells ?? [])]
    .some(group => group.evidence?.some(citation => citation.paperId === paperId)));
}
