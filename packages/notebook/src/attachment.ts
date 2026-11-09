/** Revision-embedded files. No URLs or external asset lifecycle are stored here. */
export interface AttachmentAttributes {
  filename: string;
  mime: string;
  data: string;
  caption: string;
  sha256: string;
}

export const attachmentLimits = { bytes: 512 * 1024, filename: 255, mime: 127, caption: 2000 } as const;
export const attachmentDefaults: AttachmentAttributes = {
  filename: '', mime: 'application/octet-stream', data: '', caption: '', sha256: '',
};
const previewTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const mimePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function isPreviewImage(mime: string): boolean { return previewTypes.has(mime); }

export function isAttachmentMime(mime: string): boolean {
  return mime.length <= attachmentLimits.mime && mimePattern.test(mime) &&
    (!mime.startsWith('image/') || isPreviewImage(mime));
}

/** File names are display/download names, never paths. */
export function isAttachmentFilename(filename: string): boolean {
  return !!filename.trim() && Array.from(filename).length <= attachmentLimits.filename &&
    !/[\u0000-\u001f\u007f/\\]/.test(filename) && filename !== '.' && filename !== '..';
}

/** Decode only bounded, canonical base64. In particular, data: and http(s): are not file data. */
export function attachmentBytes(data: string): Uint8Array<ArrayBuffer> {
  if (data.length > Math.ceil(attachmentLimits.bytes / 3) * 4 || !base64Pattern.test(data)) {
    throw new Error('Invalid attachment data.');
  }
  const binary = atob(data);
  if (binary.length > attachmentLimits.bytes || btoa(binary) !== data) throw new Error('Invalid attachment data.');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

/** Synchronous clipboard boundary. Digest equality is verified before display/download and on save. */
export function isAttachmentAttributes(value: unknown): value is AttachmentAttributes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const attrs = value as Record<string, unknown>;
  if (Object.keys(attrs).length !== 5 || typeof attrs.filename !== 'string' || !isAttachmentFilename(attrs.filename) ||
      typeof attrs.mime !== 'string' || !isAttachmentMime(attrs.mime) || typeof attrs.data !== 'string' ||
      typeof attrs.caption !== 'string' || Array.from(attrs.caption).length > attachmentLimits.caption ||
      typeof attrs.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(attrs.sha256)) return false;
  try { attachmentBytes(attrs.data); return true; }
  catch { return false; }
}
