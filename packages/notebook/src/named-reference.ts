import type { NotebookDocument } from './document.ts';

/** A human-authored entry card, not a scientific source identity or verified citation. */
export interface NamedReference { kind: 'entry'; name: string; notes: string }
export function parseNamedReference(value: unknown): NamedReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid named reference');
  const attrs = value as Record<string, unknown>;
  if (attrs.kind !== 'entry' || typeof attrs.name !== 'string' || !attrs.name.trim() || attrs.name.length > 200 ||
      typeof attrs.notes !== 'string' || !attrs.notes.trim() || attrs.notes.length > 20000) throw new Error('Enter a name (1–200 characters) and notes (1–20,000 characters).');
  return { kind: 'entry', name: attrs.name, notes: attrs.notes };
}

/** Original Pero example. Each restoration receives fresh IDs from the UI shell. */
export function notebookExample(id: () => string): NotebookDocument {
  return { schemaVersion: 1, title: 'Pero research notebook example', metadata: { project: '', author: '', tags: ['example'] }, procedures: [], content: { type: 'doc', content: [
    { type: 'section', attrs: { blockId: id(), label: 'Record an observation', date: '' }, content: [
      { type: 'paragraph', attrs: { blockId: id() }, content: [{ type: 'text', text: 'Describe what you measured, how you measured it, and what remains uncertain.' }] },
      { type: 'namedReference', attrs: { blockId: id(), kind: 'entry', name: 'Preparation checklist', notes: 'Record instrument settings and sample labels before collecting measurements. This example card is not a verified scientific citation.' } },
    ] },
    { type: 'paragraph', attrs: { blockId: id() } },
  ] } };
}
