import { createHash } from 'node:crypto';
import type { PreparedAppWrite } from './app-write.ts';
import { AppUseError } from './app-use-task.ts';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const SOURCE_IMAGE_RESPONSE_BYTES = 4 * Math.ceil(MAX_IMAGE_BYTES / 3) + 4096;
const HASH = /^[a-f0-9]{64}$/;
type ImageProvenance = Readonly<{ archiveDigest: string; memberId: string; originalSha256: string; previewSha256: string; width: number; height: number }>;

/** One declared read representation, not a generic JSON-to-image convention. */
export class PaperSourceImage {
  readonly data: string;
  readonly provenance: ImageProvenance;
  private constructor(data: string, provenance: ImageProvenance) { this.data = data; this.provenance = provenance; }
  static accepts(prepared: PreparedAppWrite): boolean {
    const route = prepared.definition;
    return route.app === 'paper-agent' && route.name === 'research-source-read'
      && route.path === '/api/research/source-read' && (route.method ?? 'POST') === 'POST'
      && (prepared.document as Record<string, unknown>).operation === 'image';
  }
  static parse(prepared: PreparedAppWrite, raw: unknown): PaperSourceImage | null {
    if (!this.accepts(prepared)) return null;
    const invalid = () => { throw new AppUseError('APP_SOURCE_IMAGE_INVALID', 'The declared source image or its version provenance is invalid'); };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
    const value = raw as Record<string, unknown>;
    if (Object.keys(value).sort().join(',') !== 'data,mimeType,provenance,type' || value.type !== 'source_image' || value.mimeType !== 'image/png'
      || typeof value.data !== 'string' || !value.data.length || value.data.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3)
      || /[^A-Za-z0-9+/=]/.test(value.data)) return invalid();
    const provenance = value.provenance as Record<string, unknown>;
    if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)
      || Object.keys(provenance).sort().join(',') !== 'archiveDigest,height,memberId,originalSha256,previewSha256,width'
      || ['archiveDigest', 'memberId', 'originalSha256', 'previewSha256'].some(key => typeof provenance[key] !== 'string' || !HASH.test(provenance[key] as string))
      || ['width', 'height'].some(key => !Number.isInteger(provenance[key]) || Number(provenance[key]) < 1 || Number(provenance[key]) > 2048)
      || provenance.memberId !== (prepared.document as Record<string, unknown>).memberId) return invalid();
    const bytes = Buffer.from(value.data, 'base64');
    if (bytes.length < 45 || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== value.data
      || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR'
      || bytes.readUInt32BE(16) !== provenance.width || bytes.readUInt32BE(20) !== provenance.height
      || bytes.toString('ascii', bytes.length - 8, bytes.length - 4) !== 'IEND'
      || createHash('sha256').update(bytes).digest('hex') !== provenance.previewSha256) return invalid();
    // Full decoding and RGB re-encoding belong to the bounded Paper acquisition
    // worker. This boundary checks the typed representation and immutable receipt.
    return new PaperSourceImage(value.data, Object.freeze({ ...provenance }) as ImageProvenance);
  }
  metadata() { return { type: 'source_image', mimeType: 'image/png', provenance: this.provenance }; }
  content() { return { type: 'image' as const, mimeType: 'image/png', data: this.data }; }
}
