import type { MystProjectSnapshot } from './myst-project-snapshot.ts';

export interface PublicationSource { readonly path: string; readonly sha256: string; readonly locator?: string }
export interface PublicationPanel { readonly id: string; readonly label: string; readonly data: readonly PublicationSource[]; readonly code: readonly PublicationSource[] }
export interface PublicationFigure { readonly id: string; readonly path: string; readonly sha256: string; readonly panels: readonly PublicationPanel[]; readonly exports?: readonly string[] }
export interface PublicationProvenance { readonly figures: readonly PublicationFigure[]; readonly problems: readonly string[] }
export const PUBLICATION_PROVENANCE_PATH = 'publication-provenance.json';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const named = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 1024;

/** Optional authored provenance is admitted once, then checked against this frozen
 * project's bytes. Consistency establishes traceability, not scientific validity. */
export async function publicationProvenance(snapshot: MystProjectSnapshot): Promise<PublicationProvenance> {
  const resource = snapshot.files.find(file => file.path === PUBLICATION_PROVENANCE_PATH);
  if (!resource) return { figures: [], problems: [] };
  const input: unknown = JSON.parse(resource.text);
  if (!record(input) || input.format !== 'pero-publication-provenance' || input.version !== 1 || !Array.isArray(input.figures) || input.figures.length > 32) throw new TypeError('Unsupported publication provenance manifest');
  const source = (value: unknown): PublicationSource => {
    if (!record(value) || !named(value.path) || !digest(value.sha256) || (value.locator !== undefined && !named(value.locator))) throw new TypeError('Invalid publication panel source');
    return { path: value.path, sha256: value.sha256, ...(value.locator ? { locator: value.locator as string } : {}) };
  };
  const figures = input.figures.map((figure): PublicationFigure => {
    if (!record(figure) || !named(figure.id) || !named(figure.path) || !digest(figure.sha256) || !Array.isArray(figure.panels) || !figure.panels.length || figure.panels.length > 26 || (figure.exports !== undefined && (!Array.isArray(figure.exports) || !figure.exports.every(named)))) throw new TypeError('Invalid publication figure');
    const panels = figure.panels.map((panel): PublicationPanel => {
      if (!record(panel) || !named(panel.id) || !named(panel.label) || !Array.isArray(panel.data) || !panel.data.length || !Array.isArray(panel.code) || !panel.code.length || panel.data.length + panel.code.length > 32) throw new TypeError('A publication panel requires identified data and code');
      return { id: panel.id, label: panel.label, data: panel.data.map(source), code: panel.code.map(source) };
    });
    if (new Set(panels.map(panel => panel.id)).size !== panels.length) throw new TypeError('Duplicate publication panel ID');
    return { id: figure.id, path: figure.path, sha256: figure.sha256, panels, ...(figure.exports ? { exports: figure.exports as string[] } : {}) };
  });
  if (new Set(figures.map(figure => figure.id)).size !== figures.length) throw new TypeError('Duplicate publication figure ID');
  const hashes = new Map<string, string>();
  for (const file of snapshot.files) hashes.set(file.path, await sha256(new TextEncoder().encode(file.text)));
  for (const asset of snapshot.assets ?? []) hashes.set(asset.path, await sha256(Uint8Array.from(atob(asset.base64), char => char.charCodeAt(0))));
  const problems = new Set<string>();
  for (const figure of figures) {
    for (const item of [figure, ...figure.panels.flatMap(panel => [...panel.data, ...panel.code])]) {
      if (!hashes.has(item.path)) problems.add(`${figure.id}: missing ${item.path}. Restore the recorded input or regenerate this figure.`);
      else if (hashes.get(item.path) !== item.sha256) problems.add(`${figure.id}: ${item.path} changed. Regenerate the figure and its provenance before publication.`);
    }
    for (const path of figure.exports ?? []) if (!hashes.has(path)) problems.add(`${figure.id}: missing vector export ${path}.`);
  }
  return { figures, problems: [...problems] };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
