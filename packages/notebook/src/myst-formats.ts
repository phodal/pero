import type { DocumentImportFormat, DocumentExportFormat } from './scientific-block.ts';
import { MYST_SOURCE_MAX_BYTES, exportMystBundle, exportMystMarkdown, importMystBundle, parseMystAttributes, parseMystDocument } from './myst.ts';
import { renderMystHtml } from './myst-render.ts';

export type MystSourceAttributes = { schemaVersion: 1; source: string };
/** Imports own their file budgets. Bundle headroom covers JSON escaping and derived projections. */
export const mystImportFormats: readonly DocumentImportFormat<MystSourceAttributes>[] = [
  {
    id: 'source', label: 'MyST Markdown', extensions: ['.md', '.myst'], mediaType: 'text/markdown',
    maxBytes: MYST_SOURCE_MAX_BYTES,
    parse: source => parseMystAttributes({ schemaVersion: 1, source }),
  },
  {
    id: 'bundle', label: 'MyST bundle', extensions: ['.myst.json'], mediaType: 'application/json',
    maxBytes: MYST_SOURCE_MAX_BYTES * 8,
    parse: importMystBundle,
  },
];

/** Source remains downloadable even for a preserved future-version block.
 * Derived exports require a valid current source and never accept a caller's AST.
 * File I/O and download UI belong to consumers, not these codecs.
 */
export const mystExportFormats: readonly DocumentExportFormat<{ source: string }>[] = [
  { id: 'source', label: 'MyST Markdown', extensions: ['.myst', '.md'], mediaType: 'text/markdown', serialize: exportMystMarkdown },
  { id: 'bundle', label: 'MyST bundle', extensions: ['.myst.json'], mediaType: 'application/json', serialize: document => exportMystBundle(parseMystDocument(document.source)) },
  { id: 'html', label: 'HTML publication', extensions: ['.html'], mediaType: 'text/html', serialize: document => renderMystHtml(parseMystDocument(document.source)) },
];
