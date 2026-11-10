import { extractedSourceMimes, isSourceExtraction, type SourceExtraction } from './source-extraction.ts';
import type { NotebookDocument, NotebookNode } from './document.ts';
import { notebookContentRoots } from './workspace.ts';
import { attachmentBytes, isAttachmentAttributes, isAttachmentFilename, type AttachmentAttributes } from './attachment.ts';

/** An immutable local text snapshot, not a claim of external source authenticity. */
export interface SourceExcerptSource { blockId: string; filename: string; mime: string; sha256: string }
export interface SourceExcerptText { source: SourceExcerptSource; text: string; extraction?: SourceExtraction }
export interface SourceExcerpt extends SourceExcerptText { version: string; start: number; end: number; quote: string }
export interface SourceExcerptAttributes { label: string; excerpt: SourceExcerpt | null }
export interface SourceExcerptAttachment { blockId: string; attachment: AttachmentAttributes }
export const sourceExcerptLimits = { bytes: 128 * 1024, label: 200 } as const;
const sourceMimes = new Set(['text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values', 'application/json', 'application/x-ndjson']);
export const isSourceExcerptMime = (mime: string): boolean => sourceMimes.has(mime);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const digestPattern = /^[a-f0-9]{64}$/;
const blockPattern = /^[A-Za-z0-9_-]{1,128}$/;

function textBytes(text: string): Uint8Array<ArrayBuffer> {
  if (text.length > sourceExcerptLimits.bytes || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ||
      Array.from(text).some(character => { const code = character.codePointAt(0)!; return code >= 0xd800 && code <= 0xdfff; })) {
    throw new Error('Source must be bounded Unicode text without binary control characters.');
  }
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > sourceExcerptLimits.bytes) throw new Error('Source text exceeds 128 KiB.');
  return bytes;
}

/** Synchronous clipboard admission checks shape/range/quote, not SHA-256 equality. */
export function isSourceExcerpt(value: unknown): value is SourceExcerpt {
  if (!object(value) || Object.keys(value).length !== (Object.hasOwn(value, 'extraction') ? 7 : 6) || !object(value.source) || Object.keys(value.source).length !== 4) return false;
  const source = value.source;
  if (typeof source.blockId !== 'string' || !blockPattern.test(source.blockId) || typeof source.filename !== 'string' || !isAttachmentFilename(source.filename) ||
      typeof source.mime !== 'string' || !(isSourceExcerptMime(source.mime) || value.extraction && extractedSourceMimes.has(source.mime)) || typeof source.sha256 !== 'string' || !digestPattern.test(source.sha256) ||
      value.version !== source.sha256 || typeof value.text !== 'string' || typeof value.quote !== 'string' ||
      typeof value.start !== 'number' || !Number.isInteger(value.start) || typeof value.end !== 'number' || !Number.isInteger(value.end)) return false;
  if (value.extraction !== undefined && !isSourceExtraction(value.extraction, value.text, source.sha256)) return false;
  try { textBytes(value.text); } catch { return false; }
  const points = Array.from(value.text);
  return value.start >= 0 && value.end > value.start && value.end <= points.length && value.quote === points.slice(value.start, value.end).join('');
}

export function isSourceExcerptAttributes(value: unknown): value is SourceExcerptAttributes {
  return object(value) && Object.keys(value).length === 2 && typeof value.label === 'string' &&
    Array.from(value.label).length <= sourceExcerptLimits.label && (value.excerpt === null || isSourceExcerpt(value.excerpt));
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Decode via the attachment owner. ignoreBOM retains U+FEFF so encoding preserves every original byte. */
export async function readSourceExcerptAttachment(candidate: SourceExcerptAttachment): Promise<SourceExcerptText> {
  const { blockId, attachment } = candidate;
  if (!blockPattern.test(blockId) || !isAttachmentAttributes(attachment)) throw new Error('Invalid source attachment.');
  if (!isSourceExcerptMime(attachment.mime)) throw new Error('Choose a UTF-8 plain text, Markdown, CSV, TSV, JSON or NDJSON attachment.');
  const bytes = attachmentBytes(attachment.data);
  if (bytes.length > sourceExcerptLimits.bytes) throw new Error('Source text exceeds 128 KiB.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('Source attachment is not valid UTF-8 text.'); }
  textBytes(text);
  if (await sha256(bytes) !== attachment.sha256) throw new Error('Source attachment digest does not match its bytes.');
  return { source: { blockId, filename: attachment.filename, mime: attachment.mime, sha256: attachment.sha256 }, text };
}

/** Selection offsets count Unicode codepoints, including BOM and CR/LF separately. */
export function createSourceExcerpt(snapshot: SourceExcerptText, start: number, end: number): SourceExcerpt {
  const excerpt = { ...snapshot, source: { ...snapshot.source }, version: snapshot.source.sha256, start, end, quote: Array.from(snapshot.text).slice(start, end).join('') };
  if (!isSourceExcerpt(excerpt)) throw new Error('Select a nonempty range within the source text using Unicode codepoint offsets.');
  return excerpt;
}

export async function verifySourceExcerpt(value: unknown): Promise<SourceExcerpt> {
  if (!isSourceExcerpt(value)) throw new Error('Invalid source excerpt.');
  if (await sha256(textBytes(value.text)) !== (value.extraction?.textSha256 ?? value.source.sha256)) throw new Error('Retained source digest does not match its text.');
  return value;
}

/** Remap only a copied local attachment locator; the retained source version stays exact. */
export function copySourceExcerpt(excerpt: SourceExcerpt | null, copiedAttachments: ReadonlyMap<string, string>): SourceExcerpt | null {
  const blockId = excerpt && copiedAttachments.get(excerpt.source.blockId);
  return excerpt && blockId ? { ...excerpt, source: { ...excerpt.source, blockId } } : excerpt;
}

/** Capture comparison used immediately before inserting, including changes that kept a stale digest. */
export function sameSourceExcerptAttachment(left: SourceExcerptAttachment, right: SourceExcerptAttachment | undefined): boolean {
  return !!right && left.blockId === right.blockId && ['filename', 'mime', 'data', 'sha256'].every(key =>
    left.attachment[key as keyof AttachmentAttributes] === right.attachment[key as keyof AttachmentAttributes]);
}

/** Availability is separate from retained snapshot integrity; no original attachment is modified. */
export function sourceExcerptAvailability(excerpt: SourceExcerpt, attachments: readonly SourceExcerptAttachment[]): 'available' | 'changed' | 'missing' {
  const matches = attachments.filter(item => item.blockId === excerpt.source.blockId);
  if (!matches.length) return 'missing';
  if (matches.length !== 1) return 'changed';
  const { attachment } = matches[0];
  if (attachment.filename !== excerpt.source.filename || attachment.mime !== excerpt.source.mime || attachment.sha256 !== excerpt.source.sha256) return 'changed';
  try {
    if (excerpt.extraction) return attachmentBytes(attachment.data).length === excerpt.extraction.original.bytes ? 'available' : 'changed';
    const bytes = attachmentBytes(attachment.data), retained = textBytes(excerpt.text);
    return bytes.length === retained.length && bytes.every((byte, index) => byte === retained[index]) ? 'available' : 'changed';
  } catch { return 'changed'; }
}

/** Native textarea selections use UTF-16 and normalize CRLF/CR to LF. Map them back losslessly. */
export function sourceExcerptSelection(text: string, selectionStart: number, selectionEnd: number): { start: number; end: number } {
  const points = Array.from(text), boundaries = new Map<number, number>([[0, 0]]);
  let offset = 0;
  for (let index = 0; index < points.length; index++) {
    const character = points[index];
    if (character === '\r' && points[index + 1] === '\n') index++;
    offset += character.length;
    boundaries.set(offset, index + 1);
  }
  const start = boundaries.get(selectionStart), end = boundaries.get(selectionEnd);
  if (start === undefined || end === undefined || start >= end) throw new Error('Highlight complete characters in the source text.');
  return { start, end };
}

/** Source discovery shares the workspace owner's Notes/procedure root contract. */
export function sourceExcerptAttachments(document: Pick<NotebookDocument, 'content' | 'procedures'>): SourceExcerptAttachment[] {
  const result: SourceExcerptAttachment[] = [];
  const visit = (node: NotebookNode) => {
    if (node.type === 'attachment' && typeof node.attrs?.blockId === 'string') {
      const { blockId, filename, mime, data, caption, sha256 } = node.attrs as unknown as AttachmentAttributes & { blockId: string };
      result.push({ blockId, attachment: { filename, mime, data, caption, sha256 } });
    }
    node.content?.forEach(visit);
  };
  notebookContentRoots(document).forEach(visit);
  return result;
}
