import { attachmentBytes, isAttachmentAttributes, type AttachmentAttributes } from './attachment.ts';
import type { NotebookNode } from './document.ts';

export const aiSourceLimits = { files: 8, bytes: 64 * 1024, totalBytes: 96 * 1024 } as const;
export interface AISource { id: string; name: string; kind: 'file' | 'attachment' | 'block'; sha256: string; bytes: number; text: string }
export interface AISourceOption { id: string; name: string; node: NotebookNode; supported: boolean; reason: string }
const textExtensions = /\.(txt|md|csv|tsv|json|fasta|fa|log)$/i;
const textMimes = new Set(['text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values', 'application/json']);
export const sourceFormatMessage = 'UTF-8 TXT, Markdown, CSV, TSV, JSON, FASTA and LOG only, up to 64 KiB per source and 96 KiB selected. PDF, images, office documents and binary formats are unsupported; no OCR is performed.';
function supportedFile(name: string, mime: string) { return textExtensions.test(name) || textMimes.has(mime); }
export function listAISources(content: string): AISourceOption[] {
  const result: AISourceOption[] = [];
  const walk = (node: NotebookNode) => {
    const blockId = node.attrs?.blockId;
    if (typeof blockId === 'string') {
      if (node.type === 'attachment') {
        const attrs = node.attrs?.attachment ?? node.attrs;
        const { filename, mime, data, caption, sha256 } = attrs as AttachmentAttributes;
        const attachment = { filename, mime, data, caption, sha256 };
        if (isAttachmentAttributes(attachment)) result.push({ id: blockId, name: attachment.filename, node, supported: supportedFile(attachment.filename, attachment.mime), reason: supportedFile(attachment.filename, attachment.mime) ? '' : sourceFormatMessage });
      } else if (['paragraph', 'heading', 'codeBlock', 'blockquote'].includes(node.type)) result.push({ id: blockId, name: `${node.type}: ${nodeText(node).slice(0, 80) || blockId}`, node, supported: true, reason: '' });
    }
    node.content?.forEach(walk);
  };
  walk(JSON.parse(content));
  return result;
}
function nodeText(node: NotebookNode): string { return node.text ?? (node.content ?? []).map(nodeText).join(node.type === 'paragraph' || node.type === 'heading' ? '' : '\n'); }
export async function readAISourceBytes(id: string, name: string, mime: string, bytes: Uint8Array<ArrayBuffer>, kind: AISource['kind'] = 'file'): Promise<AISource> {
  if (!supportedFile(name, mime) && kind !== 'block') throw new Error(sourceFormatMessage);
  if (!bytes.length || bytes.length > aiSourceLimits.bytes) throw new Error('Source must contain 1–65,536 readable bytes. No truncation is performed.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('Source is not valid UTF-8 text. Convert it explicitly before selecting it.'); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('Source contains binary control bytes and cannot be extracted as text.');
  const sha256 = await sourceDigest(bytes);
  return { id, name, kind, sha256, bytes: bytes.length, text };
}
export async function readAIBlockSource(option: AISourceOption): Promise<AISource> {
  if (!option.supported) throw new Error(option.reason);
  if (option.node.type === 'attachment') {
    const attrs = (option.node.attrs?.attachment ?? option.node.attrs) as unknown as AttachmentAttributes;
    const result = await readAISourceBytes(option.id, attrs.filename, attrs.mime, attachmentBytes(attrs.data), 'attachment');
    if (result.sha256 !== attrs.sha256) throw new Error('Attachment bytes do not match their saved SHA-256. Reselect an intact source.');
    return result;
  }
  return readAISourceBytes(option.id, option.name, 'text/plain', new TextEncoder().encode(nodeText(option.node)), 'block');
}
async function sourceDigest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
}

/** Persist text without normalization, including a UTF-8 BOM, so its original bytes can be verified. */
export async function validateAISources(sources: AISource[]): Promise<void> {
  if (!sources.length || sources.length > aiSourceLimits.files || new Set(sources.map(source => source.id)).size !== sources.length) throw new Error('Select 1–8 distinct readable sources.');
  if (sources.reduce((sum, source) => sum + source.bytes, 0) > aiSourceLimits.totalBytes) throw new Error('Selected sources exceed the 96 KiB total limit. Remove a source; nothing is silently truncated.');
  for (const source of sources) if (typeof source.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(source.id) || typeof source.name !== 'string' || !source.name || source.name.length > 255 || !['file', 'attachment', 'block'].includes(source.kind) || typeof source.text !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256) || !Number.isSafeInteger(source.bytes) || source.bytes < 1 || source.bytes > aiSourceLimits.bytes || new TextEncoder().encode(source.text).length !== source.bytes) throw new Error('Invalid source identity, text or byte count. Reselect its bytes.');
  for (const source of sources) {
    const bytes = new TextEncoder().encode(source.text);
    if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== source.text || await sourceDigest(bytes) !== source.sha256) throw new Error('Source text does not match its saved UTF-8 SHA-256. The stored source has not been changed.');
  }
}
