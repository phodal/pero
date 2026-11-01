/** Paper owns references; only the Host can hand approved assets to Data. */
export type ResearchAsset = {
  id: string; name: string; kind: 'model' | 'dataset'; filename: string;
  size: number; license: string; revision: string; sourceUrl: string; url: string; sha256: string | null;
};
export type ResearchResource = {
  id: string; identity: string; observedAt?: string; workIdentity?: string | null; kind: 'web_article' | 'paper' | 'pdf_candidate' | 'source_archive' | 'code' | 'model' | 'dataset' | 'benchmark' | 'service';
  url: string; originalUrl: string; title: string; authors: string[]; revision: string | null;
  license: string | null; size: number | null; confidence: 'explicit' | 'metadata' | 'unresolved';
  relation: 'links_to' | 'implements' | 'cites' | 'releases' | 'evaluated_on';
  evidence: { url: string; label: string; href?: string; kind?: string; position?: number | null }[]; excerpt: string; unresolved: string[]; assets: ResearchAsset[]; paperId?: string | null;
};
export type ImportDraft = {
  id: string; seedUrl: string; status: 'inspecting' | 'ready' | 'failed' | 'cancelled';
  resources: ResearchResource[]; warnings: string[]; error?: string;
};
export type ResearchBundle = {
  id: string; seedUrl: string; title: string; resources: ResearchResource[];
  createdAt: string; updatedAt: string; downloadIds: string[]; pdfDownloadIds?: string[]; sourceDownloadIds?: string[];
};
export const resourceKinds: Record<ResearchResource['kind'], string> = {
  web_article: 'Article', paper: 'Paper', pdf_candidate: 'PDF / unverified paper', source_archive: 'Source archive', code: 'Code', model: 'Model', dataset: 'Dataset', benchmark: 'Benchmark', service: 'Service',
};
export function assetSize(size: number | null) {
  if (size == null) return 'Size unknown';
  if (size < 1024) return `${size} B`;
  const unit = size >= 1024 ** 3 ? 3 : size >= 1024 ** 2 ? 2 : 1;
  return `${(size / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${['B', 'KiB', 'MiB', 'GiB'][unit]}`;
}
