export type Kind = 'dataset' | 'model';
export type Checksum = { algorithm: string; value: string; provenance: string };
export type Asset = {
  id: string; name: string; kind: Kind; format: string; size: number;
  source: string; revision: string; license: string; sha256: string; createdAt: string;
  localAvailable: boolean; location: string; checksums: Checksum[];
};
export type Source = {
  id: string; name: string; kind: Kind; filename: string; size: number;
  license: string; revision: string; sourceUrl: string;
  checksums: Checksum[];
};
export type CatalogState = {
  assets: Asset[]; sources: Source[];
  download: null | { id: string; sourceId: string; status: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted'; received: number; total: number; error: string };
};
export const IMPORT_LIMIT = 10 * 1024 * 1024;
export function filterAssets(assets: Asset[], kind: Kind | 'all', query: string): Asset[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return assets.filter(asset => (kind === 'all' || asset.kind === kind) &&
    terms.every(term => [asset.name, asset.kind, asset.source, asset.format, asset.license].join(' ').toLocaleLowerCase().includes(term)));
}
export function formatBytes(size: number | null | undefined): string {
  if (size == null || !Number.isFinite(size) || size < 0) return 'Unknown size';
  if (size < 1024) return `${size} B`;
  const power = Math.min(3, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / 1024 ** power).toFixed(1)} ${['B', 'KiB', 'MiB', 'GiB'][power]}`;
}
export function validateImport(size: number): void {
  if (size > IMPORT_LIMIT) throw new Error('Import supports files up to 10 MiB.');
  if (size === 0) throw new Error('Choose a non-empty file.');
}
export async function fileContent(file: File): Promise<string> {
  validateImport(file.size);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
