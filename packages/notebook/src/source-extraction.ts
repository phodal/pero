/** Derived source text is distinct from original file bytes and scientific acceptance. */
export interface SourceRegion { x: number; y: number; width: number; height: number }
export interface SourceSegment { start: number; end: number; page: number | null; part: string; region: SourceRegion | null; score: number | null }
export interface SourceExtraction {
  version: 1; original: { sha256: string; bytes: number }; parser: { name: string; version: string };
  method: 'native' | 'ocr'; textSha256: string; segments: SourceSegment[]; limitations: string[];
}
export interface ExtractedSource { text: string; extraction: SourceExtraction }
export const extractedSourceMimes = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value: unknown, keys: string[]): value is Record<string, unknown> => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const textValue = (value: unknown, limit: number): value is string => typeof value === 'string' && new TextEncoder().encode(value).length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(value);
const integer = (value: unknown, minimum: number, maximum: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && minimum <= value && value <= maximum;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function isSourceExtraction(value: unknown, text: string, originalDigest?: string): value is SourceExtraction {
  if (!fields(value, ['version', 'original', 'parser', 'method', 'textSha256', 'segments', 'limitations']) || value.version !== 1 || !['native', 'ocr'].includes(value.method as string) ||
      !fields(value.original, ['sha256', 'bytes']) || !digest(value.original.sha256) || originalDigest !== undefined && originalDigest !== value.original.sha256 || !integer(value.original.bytes, 1, 512 * 1024) ||
      !fields(value.parser, ['name', 'version']) || !textValue(value.parser.name, 100) || !value.parser.name || !textValue(value.parser.version, 100) || !value.parser.version ||
      !textValue(text, 128 * 1024) || !text || !digest(value.textSha256) || !Array.isArray(value.segments) || !value.segments.length || value.segments.length > 4096 ||
      !Array.isArray(value.limitations) || !value.limitations.length || value.limitations.length > 10 || !value.limitations.every(item => textValue(item, 500))) return false;
  let previous = 0; const length = Array.from(text).length;
  for (const segment of value.segments) {
    if (!fields(segment, ['start', 'end', 'page', 'part', 'region', 'score']) || !integer(segment.start, previous, length) || !integer(segment.end, segment.start + 1, length) ||
        segment.page !== null && !integer(segment.page, 1, 500) || !textValue(segment.part, 255) || !segment.part) return false;
    previous = segment.end;
    const region = segment.region;
    if (region !== null) {
      if (!fields(region, ['x', 'y', 'width', 'height']) || !Object.values(region).every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return false;
      const { x, y, width, height } = region as unknown as SourceRegion;
      if (width <= 0 || height <= 0 || x + width > 1.0000001 || y + height > 1.0000001) return false;
    }
    if (segment.score !== null && (value.method !== 'ocr' || typeof segment.score !== 'number' || !Number.isFinite(segment.score) || segment.score < -1 || segment.score > 100)) return false;
  }
  return true;
}
export async function textSha256(text: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function verifyExtractedSource(value: unknown, originalDigest?: string): Promise<ExtractedSource> {
  if (!fields(value, ['text', 'extraction']) || typeof value.text !== 'string' || !isSourceExtraction(value.extraction, value.text, originalDigest) || await textSha256(value.text) !== value.extraction.textSha256) throw new Error('Extracted source metadata or text integrity failed.');
  return value as unknown as ExtractedSource;
}
export function selectedSourceSegments(extraction: SourceExtraction, start: number, end: number): SourceSegment[] {
  return extraction.segments.filter(part => part.start < end && part.end > start);
}
