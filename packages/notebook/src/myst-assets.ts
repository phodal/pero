/** Explicit binary admission. Header/structure checks are not a full decoder. */
export interface MystImageData {
  readonly mediaType: string;
  readonly base64: string;
  readonly byteLength: number;
  readonly renderable: boolean;
  readonly width?: number;
  readonly height?: number;
}
export interface MystBinaryAsset extends MystImageData { readonly path: string }
export const MYST_ASSET_MAX_BYTES = 256 * 1024;
export const MYST_IMAGE_MAX_DIMENSION = 4096;
export const MYST_IMAGE_MAX_PIXELS = 16 * 1024 * 1024;
export function parseMystImageData(mediaType: unknown, base64: unknown): MystImageData {
  if (typeof mediaType !== 'string' || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mediaType)) throw new TypeError('Invalid asset media type');
  if (typeof base64 !== 'string' || base64.length > Math.ceil(MYST_ASSET_MAX_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new TypeError('Invalid or oversized asset base64');
  const decoded = atob(base64);
  if (btoa(decoded) !== base64) throw new TypeError('Asset base64 must be canonical');
  if (decoded.length > MYST_ASSET_MAX_BYTES) throw new RangeError('Asset exceeds 256 KiB');
  const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  let width: number | undefined;
  let height: number | undefined;
  if (mediaType === 'image/png') {
    if (bytes.length < 45 || [137,80,78,71,13,10,26,10].some((byte, index) => bytes[index] !== byte)) throw new TypeError('PNG signature mismatch');
    let offset = 8;
    let data = false;
    let end = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (length > bytes.length - offset - 12) throw new TypeError('Invalid PNG chunk length');
      if (offset === 8) {
        if (type !== 'IHDR' || length !== 13) throw new TypeError('PNG requires first IHDR');
        width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
        if (![0,2,3,4,6].includes(bytes[offset + 17]) || ![1,2,4,8,16].includes(bytes[offset + 16]) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) throw new TypeError('Invalid PNG header');
      } else if (type === 'IHDR') throw new TypeError('Duplicate PNG header');
      if (type === 'IDAT') data = true;
      offset += length + 12;
      if (type === 'IEND') { if (length !== 0 || offset !== bytes.length) throw new TypeError('Invalid PNG end'); end = true; break; }
    }
    if (!data || !end) throw new TypeError('Incomplete PNG structure');
  } else if (mediaType === 'image/jpeg') {
    if (bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new TypeError('JPEG signature mismatch');
    let offset = 2;
    let scan = false;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) throw new TypeError('Invalid JPEG marker');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw new TypeError('Invalid JPEG segment');
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (length < 8 || width !== undefined) throw new TypeError('Invalid JPEG frame');
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
      }
      if (marker === 218) { scan = true; break; }
      offset += length;
    }
    if (!scan || width === undefined) throw new TypeError('Incomplete JPEG structure');
  }
  if (width !== undefined && (width < 1 || !height || width > MYST_IMAGE_MAX_DIMENSION || height > MYST_IMAGE_MAX_DIMENSION || width * height > MYST_IMAGE_MAX_PIXELS)) throw new RangeError('Image dimensions exceed the bounded raster budget');
  return Object.freeze({ mediaType, base64, byteLength: bytes.length, renderable: width !== undefined, ...(width !== undefined ? { width, height } : {}) });
}
/** Only admitted PNG/JPEG can become embedded data URLs. */
export function safeMystImageDataUri(data: MystImageData): string | undefined {
  return data.renderable && ['image/png', 'image/jpeg'].includes(data.mediaType) ? `data:${data.mediaType};base64,${data.base64}` : undefined;
}
