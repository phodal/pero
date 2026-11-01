import type { SelectionRangeX } from '@embedpdf/plugin-selection';
import type { PdfDocument } from './types';

/** App-local view state, never annotation/evidence or a document identity source. */
export type PdfReaderState = {
  schema: 1; documentId: string; fileDigest: string; page: number; zoom: number;
  position: { x: number; y: number }; selection: SelectionRangeX | null; mode: 'text' | 'pdf';
};
export function readerStateKey(document: PdfDocument) { return `pero.paper.pdf-view:${document.id}:${document.fileDigest}`; }
export function parseReaderState(raw: string | null, document: PdfDocument): PdfReaderState | null {
  if (!raw || raw.length > 4096) return null;
  try {
    const value = JSON.parse(raw);
    const point = (v: unknown): v is { x: number; y: number } => !!v && typeof v === 'object' &&
      ['x', 'y'].every(k => typeof (v as Record<string, unknown>)[k] === 'number' && Number.isFinite((v as Record<string, number>)[k]));
    const glyph = (v: unknown): boolean => !!v && typeof v === 'object' &&
      Number.isSafeInteger((v as { page: number }).page) && (v as { page: number }).page >= 0 && (v as { page: number }).page < document.pages.length &&
      Number.isSafeInteger((v as { index: number }).index) && (v as { index: number }).index >= 0;
    if (value?.schema !== 1 || value.documentId !== document.id || value.fileDigest !== document.fileDigest ||
      !Number.isInteger(value.page) || value.page < 1 || value.page > document.pages.length ||
      typeof value.zoom !== 'number' || !Number.isFinite(value.zoom) || value.zoom <= 0 || value.zoom > 100 ||
      !point(value.position) || !['text', 'pdf'].includes(value.mode) ||
      !(value.selection === null || (glyph(value.selection?.start) && glyph(value.selection?.end)))) return null;
    return value as PdfReaderState;
  } catch { return null; }
}
export function loadReaderState(document: PdfDocument): PdfReaderState | null {
  try { return parseReaderState(localStorage.getItem(readerStateKey(document)), document); }
  catch { return null; }
}
export function saveReaderState(document: PdfDocument, state: PdfReaderState): boolean {
  try { localStorage.setItem(readerStateKey(document), JSON.stringify(state)); return true; }
  catch { return false; }
}
