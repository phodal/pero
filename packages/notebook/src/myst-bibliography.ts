import { Cite } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import { normalizeMystIdentifier, readMystLocalBibliography, type MystBibliographyEntry, type MystDiagnostic } from './myst.ts';
import type { MystTextResource } from './myst-project-snapshot.ts';

export type MystCslValue = string | number | boolean | null | MystCslValue[] | { [key: string]: MystCslValue };
export interface MystBibliographyRecord {
  id: string;
  path: string;
  /** Complete derived CSL record, not just the renderer's small display projection. */
  csl: { [key: string]: MystCslValue };
}
export interface MystBibliography {
  records: MystBibliographyRecord[];
  entries: Record<string, MystBibliographyEntry>;
  diagnostics: MystDiagnostic[];
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' ? value : undefined;

/** Only explicit BibTeX parsing or JSON arrays, never format autodetection/URL loading. */
export function resolveMystBibliography(resources: readonly MystTextResource[], metadata: Record<string, unknown>, pagePath: string): MystBibliography {
  const diagnostics: MystDiagnostic[] = [];
  const records: MystBibliographyRecord[] = [];
  const entries: Record<string, MystBibliographyEntry> = Object.create(null);
  const seen = new Set<string>();
  const ambiguous = new Set<string>();
  const add = (entry: MystBibliographyEntry, path: string) => {
    const key = normalizeMystIdentifier(entry.id);
    if (seen.has(key)) {
      ambiguous.add(key);
      delete entries[key];
      diagnostics.push({ severity: 'error', code: 'citation-ambiguous', path, message: `Ambiguous bibliography key: ${entry.id}. No record is selected.` });
    } else { seen.add(key); entries[key] = entry; }
  };
  // Keep the standalone extension's projection, but prevent duplicate local keys
  // from becoming a silent winner in the project resolver.
  const legacy = readMystLocalBibliography(metadata, (code, message) => diagnostics.push({ severity: 'warning', code, message, path: pagePath }));
  for (const entry of Object.values(legacy)) add(entry, pagePath);
  const local = object(metadata.pero) && Array.isArray(metadata.pero.bibliography) ? metadata.pero.bibliography : [];
  const localKeys = new Set<string>();
  for (const value of local) if (object(value) && typeof value.id === 'string' && value.id.trim()) {
    const key = normalizeMystIdentifier(value.id);
    if (localKeys.has(key)) { ambiguous.add(key); delete entries[key]; }
    localKeys.add(key);
  }
  for (const resource of resources) {
    let values: unknown;
    try {
      if (/\.bib$/i.test(resource.path)) values = new Cite(resource.text, { forceType: '@bibtex/text', generateGraph: false }).data;
      else if (/\.json$/i.test(resource.path)) values = JSON.parse(resource.text);
      else throw new TypeError('Only explicit .bib and CSL item-array .json resources are supported');
      if (!Array.isArray(values)) throw new TypeError('CSL-JSON must be an array of items');
      if (!values.length && resource.text.trim()) diagnostics.push({ severity: 'warning', code: 'bibliography-empty', path: resource.path, message: 'No bibliography records were parsed from the provided resource.' });
    } catch (error) {
      diagnostics.push({ severity: 'error', code: 'bibliography-invalid', path: resource.path, message: error instanceof Error ? error.message : 'Unable to parse bibliography' });
      continue;
    }
    for (const value of values) {
      if (!object(value) || !['string', 'number'].includes(typeof value.id) || !String(value.id).trim() || typeof value.type !== 'string' || !value.type.trim()) {
        diagnostics.push({ severity: 'error', code: 'bibliography-invalid', path: resource.path, message: 'CSL items require a nonempty id and type.' });
        continue;
      }
      const id = String(value.id);
      const csl = JSON.parse(JSON.stringify(value)) as MystBibliographyRecord['csl'];
      records.push({ id, path: resource.path, csl });
      const author = Array.isArray(value.author) ? value.author.map(person => object(person) ? text(person.literal) ?? [text(person.given), text(person.family)].filter(Boolean).join(' ') : '').filter(Boolean).join(', ') : undefined;
      const issued = object(value.issued) ? value.issued['date-parts'] : undefined;
      const yearValue = Array.isArray(issued) && Array.isArray(issued[0]) ? issued[0][0] : undefined;
      const year = typeof yearValue === 'string' || typeof yearValue === 'number' ? String(yearValue) : undefined;
      const doi = text(value.DOI);
      add({ id, title: text(value.title), author, year, url: text(value.URL) ?? (doi ? `https://doi.org/${doi}` : undefined) }, resource.path);
    }
  }
  for (const key of ambiguous) delete entries[key];
  return { records, entries, diagnostics };
}
