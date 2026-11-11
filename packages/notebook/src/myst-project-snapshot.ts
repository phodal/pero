import { defineDocumentBlock, registerDocumentBlock } from './scientific-block.ts';

export interface MystTextResource { readonly path: string; readonly text: string }
/** Explicit authored resources, never a filesystem or Host ResearchProject. */
export interface MystProjectSnapshot { readonly entry: string; readonly files: readonly MystTextResource[] }
export const MYST_PROJECT_MAX_FILES = 32;
export const MYST_PROJECT_RESOURCE_MAX_BYTES = 256 * 1024;
export const MYST_PROJECT_MAX_BYTES = 1024 * 1024;
export const MYST_PROJECT_WIRE_MAX_BYTES = 8 * 1024 * 1024;
export const MYST_PROJECT_PATH_MAX_BYTES = 1024;
/** Escaped snapshot scalar contribution to the existing 2 MiB Notebook document. */
export const MYST_PROJECT_PERSISTED_MAX_BYTES = 1536 * 1024;
const bytes = (text: string) => new TextEncoder().encode(text).length;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(',') === keys.sort().join(',');
// Reject unpaired UTF-16 surrogates: UTF-8 encoding otherwise replaces authored text.
const scalarText = (text: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);
const forbiddenPath = /[\\:?#\x00-\x1f\x7f]/u;
function pathValid(value: unknown): value is string {
  return typeof value === 'string' && !!value && scalarText(value) && bytes(value) <= MYST_PROJECT_PATH_MAX_BYTES
    && !forbiddenPath.test(value) && value.split('/').every(part => !!part && part !== '.' && part !== '..');
}

/** The only wire boundary: unknown versions/fields are not interpreted as current. */
export function parseMystProjectSnapshot(value: unknown): MystProjectSnapshot {
  if (!record(value) || !exact(value, ['format', 'version', 'entry', 'files']) || value.format !== 'pero-myst-project' || value.version !== 1) throw new TypeError('Unsupported MyST project snapshot');
  if (!pathValid(value.entry) || !/\.(?:md|myst)$/i.test(value.entry)) throw new TypeError('MyST entry must be a canonical Markdown resource path');
  if (!Array.isArray(value.files) || !value.files.length || value.files.length > MYST_PROJECT_MAX_FILES) throw new RangeError('MyST projects require 1–32 text resources');
  const paths = new Set<string>();
  let total = 0;
  const files = value.files.map((resource): MystTextResource => {
    if (!record(resource) || !exact(resource, ['path', 'text']) || !pathValid(resource.path) || typeof resource.text !== 'string' || !scalarText(resource.text)) throw new TypeError('Invalid MyST text resource');
    if (paths.has(resource.path)) throw new TypeError(`Duplicate MyST resource: ${resource.path}`);
    paths.add(resource.path);
    const size = bytes(resource.text);
    if (size > MYST_PROJECT_RESOURCE_MAX_BYTES) throw new RangeError('MyST resource exceeds 256 KiB');
    total += size;
    if (total > MYST_PROJECT_MAX_BYTES) throw new RangeError('MyST project exceeds 1 MiB of text');
    return Object.freeze({ path: resource.path, text: resource.text });
  });
  if (!paths.has(value.entry)) throw new TypeError('MyST entry resource is missing');
  const snapshot = Object.freeze({ entry: value.entry, files: Object.freeze(files) });
  validatePersistedContribution(exportMystProjectSnapshot(snapshot));
  return snapshot;
}
function validatePersistedContribution(text: string): void {
  // Matches NotebookDocument.serialized(): UTF-8 JSON with ensure_ascii=False.
  // Count the actual scalar, including imported whitespace and repeated escapes.
  if (bytes(JSON.stringify(text)) > MYST_PROJECT_PERSISTED_MAX_BYTES) throw new RangeError('MyST snapshot exceeds the 1536 KiB persisted contribution budget after JSON escaping; reduce resources or formatting. The Notebook total remains limited to 2 MiB.');
}
export function importMystProjectSnapshot(text: string): MystProjectSnapshot {
  if (typeof text !== 'string' || bytes(text) > MYST_PROJECT_WIRE_MAX_BYTES) throw new RangeError('MyST project wire exceeds 8 MiB');
  validatePersistedContribution(text);
  return parseMystProjectSnapshot(JSON.parse(text));
}
export function exportMystProjectSnapshot(snapshot: MystProjectSnapshot): string {
  return JSON.stringify({ format: 'pero-myst-project', version: 1, entry: snapshot.entry, files: snapshot.files }, null, 2) + '\n';
}
export function replaceMystProjectResource(snapshot: MystProjectSnapshot, path: string, text: string): MystProjectSnapshot {
  if (!snapshot.files.some(file => file.path === path)) throw new TypeError('Cannot edit an unprovided MyST resource');
  return parseMystProjectSnapshot({ format: 'pero-myst-project', version: 1, entry: snapshot.entry,
    files: snapshot.files.map(file => file.path === path ? { path, text } : file) });
}
export type MystResourceResolution =
  | { status: 'resolved'; path: string; resource: MystTextResource }
  | { status: 'missing'; path: string }
  | { status: 'unsupported'; reason: string };
/** Resolve exact names only; no decoding, globbing, discovery, I/O or expansion. */
export function resolveMystResource(snapshot: MystProjectSnapshot, containingFile: string, authoredPath: string): MystResourceResolution {
  if (!authoredPath || !scalarText(authoredPath) || forbiddenPath.test(authoredPath) || authoredPath.startsWith('/') || authoredPath.split('/').some(part => !part) || /[*${}]/u.test(authoredPath)) return { status: 'unsupported', reason: 'Resource references must be explicit local relative paths' };
  const segments = containingFile.split('/').slice(0, -1);
  for (const part of authoredPath.split('/')) {
    if (part === '.') continue;
    if (part === '..') {
      if (!segments.length) return { status: 'unsupported', reason: 'Resource reference escapes the snapshot root' };
      segments.pop();
    } else segments.push(part);
  }
  const path = segments.join('/');
  if (!pathValid(path)) return { status: 'unsupported', reason: 'Invalid resolved resource path' };
  const resource = snapshot.files.find(file => file.path === path);
  return resource ? { status: 'resolved', path, resource } : { status: 'missing', path };
}
export const mystProjectDefinition = registerDocumentBlock(defineDocumentBlock({
  type: 'mystProject', defaults: { snapshot: exportMystProjectSnapshot({ entry: 'article.md', files: [{ path: 'article.md', text: '' }] }) }, futureVersions: 'reject',
  versionOne(attrs) { importMystProjectSnapshot(attrs.snapshot); },
}));
