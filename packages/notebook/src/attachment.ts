import { rasterEditPlan, type RasterEdit } from './raster-edit.ts';
export { rasterEditPlan, rasterLimits, type RasterEdit } from './raster-edit.ts';

/** Revision-embedded files. No URLs or external asset lifecycle are stored here. */
export interface AttachmentFile {
  filename: string;
  mime: string;
  data: string;
  sha256: string;
}

export interface ImageDerivationStep {
  source: AttachmentFile;
  sourceWidth: number;
  sourceHeight: number;
  edit: RasterEdit;
  outputSha256: string;
}
/** A local recorded chain, not a signed attestation or verified rendering replay. */
export interface ImageDerivation { version: 1; steps: ImageDerivationStep[] }
export interface AttachmentAttributes extends AttachmentFile {
  caption: string;
  derivation?: ImageDerivation | null;
}
export const imageDerivationLimits = { steps: 8, sourceBytes: 512 * 1024 } as const;

export const attachmentLimits = { bytes: 512 * 1024, filename: 255, mime: 127, caption: 2000 } as const;
export const attachmentDefaults: AttachmentAttributes = {
  filename: '', mime: 'application/octet-stream', data: '', caption: '', sha256: '', derivation: null,
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

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function isAttachmentFile(value: Record<string, unknown>): boolean {
  return typeof value.filename === 'string' && isAttachmentFilename(value.filename) &&
    typeof value.mime === 'string' && isAttachmentMime(value.mime) && typeof value.data === 'string' &&
    typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256);
}

/** Synchronous import/clipboard boundary. Hashes are checked before display/download and on save. */
export function isAttachmentAttributes(value: unknown): value is AttachmentAttributes {
  if (!object(value) || !isAttachmentFile(value) ||
      !exactKeys(value, ['filename', 'mime', 'data', 'caption', 'sha256', ...(Object.hasOwn(value, 'derivation') ? ['derivation'] : [])]) ||
      typeof value.caption !== 'string' || Array.from(value.caption).length > attachmentLimits.caption) return false;
  try {
    attachmentBytes(value.data as string);
    if (value.derivation === undefined || value.derivation === null) return true;
    const chain = value.derivation;
    if (value.mime !== 'image/png' || !object(chain) || !exactKeys(chain, ['version', 'steps']) || chain.version !== 1 ||
        !Array.isArray(chain.steps) || !chain.steps.length || chain.steps.length > imageDerivationLimits.steps) return false;
    let bytes = 0;
    let previous: { hash: string; width: number; height: number } | null = null;
    for (const step of chain.steps) {
      if (!object(step) || !exactKeys(step, ['source', 'sourceWidth', 'sourceHeight', 'edit', 'outputSha256']) ||
          !object(step.source) || !exactKeys(step.source, ['filename', 'mime', 'data', 'sha256']) || !isAttachmentFile(step.source) ||
          !isPreviewImage(step.source.mime as string) || !object(step.edit) ||
          !exactKeys(step.edit, ['x', 'y', 'width', 'height', 'outputWidth', 'outputHeight', 'rotation']) ||
          typeof step.outputSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(step.outputSha256)) return false;
      bytes += attachmentBytes(step.source.data as string).length;
      if (bytes > imageDerivationLimits.sourceBytes || (previous && (step.source.sha256 !== previous.hash ||
          step.source.mime !== 'image/png' || step.sourceWidth !== previous.width || step.sourceHeight !== previous.height))) return false;
      const plan = rasterEditPlan(step.sourceWidth as number, step.sourceHeight as number, step.edit as RasterEdit);
      previous = { hash: step.outputSha256, width: plan.canvasWidth, height: plan.canvasHeight };
    }
    return previous?.hash === value.sha256;
  } catch { return false; }
}

/** Append without discarding ancestors. Limits fail explicitly instead of silently losing evidence. */
export function deriveImageAttachment(source: AttachmentAttributes, output: AttachmentAttributes,
  sourceWidth: number, sourceHeight: number, edit: RasterEdit): AttachmentAttributes {
  rasterEditPlan(sourceWidth, sourceHeight, edit);
  const steps = source.derivation?.steps ?? [];
  if (steps.length >= imageDerivationLimits.steps) throw new Error('Image history is limited to 8 edits. Download the image and attach it separately to start a new history.');
  if (attachmentBytes(source.data).length + steps.reduce((total, step) => total + attachmentBytes(step.source.data).length, 0) > imageDerivationLimits.sourceBytes) {
    throw new Error('Retained image sources exceed 512 KiB. Download the image and attach it separately to start a new history.');
  }
  const { filename, mime, data, sha256 } = source;
  const result: AttachmentAttributes = { ...output, caption: source.caption, derivation: { version: 1, steps: [...steps, {
    source: { filename, mime, data, sha256 }, sourceWidth, sourceHeight, edit: { ...edit }, outputSha256: output.sha256,
  }] } };
  if (!isAttachmentAttributes(result)) throw new Error('Invalid image derivation.');
  return result;
}

/** Verify every embedded byte sequence against its digest, not the truth of the recorded edits. */
export async function verifiedAttachmentBytes(value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  if (!isAttachmentAttributes(value)) throw new Error('Invalid attachment.');
  let current: Uint8Array<ArrayBuffer> | undefined;
  for (const file of [value, ...(value.derivation?.steps.map(step => step.source) ?? [])]) {
    const bytes = attachmentBytes(file.data);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    if (Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== file.sha256) throw new Error('Attachment digest mismatch.');
    current ??= bytes;
  }
  return current!;
}
