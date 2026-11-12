/** The Data API boundary. Original values arrive as text, never floating-point replacements. */
export type Asset = {
  id: string; name: string; kind: 'dataset' | 'model'; format: string; size: number;
  source: string; revision: string; license: string; sha256: string; createdAt: string;
  checksums: { algorithm: string; value: string; provenance: string }[];
  bundleId: string; sourceId: string; localAvailable: boolean; availability: 'present' | 'missing' | 'changed';
};
export type Dataset = {
  id: string; name: string; kind: 'dataset' | 'model'; versions: string[]; projectRef: string; archived: boolean;
};
export type ViewFilter = { field: string; operator: string; value: string };
export type ViewIssue = { kind: 'missing' | 'null' | 'empty' | 'duplicate' | 'conversion'; field?: string };
export type ViewSpec = {
  interpretations?: Record<string, 'number'>;
  issue?: ViewIssue | null;
  columns: string[];
  filter: ViewFilter | null;
  sort: { field: string; descending: boolean } | null;
  selection: number[];
  chart: { category: string; measure: string; aggregation: string } | null;
  units: Record<string, string>;
};
export const emptyView = (): ViewSpec => ({ columns: [], filter: null, sort: null, selection: [], chart: null, units: {}, interpretations: {}, issue: null });
export const fieldRule = { type: 'string', maxLength: 300 };
export const querySchema = { type: 'object', properties: {
  filterField: fieldRule, operator: { type: 'string', enum: ['contains', 'eq', 'gte', 'lte', 'missing', 'null'] }, value: { type: 'string', maxLength: 4096 },
  sortField: fieldRule, descending: { type: 'boolean' },
  columns: { type: 'array', maxItems: 32, items: fieldRule },
  selection: { type: 'array', maxItems: 1000, items: { type: 'integer', minimum: 0 } },
}, additionalProperties: false };
export type FieldProfile = { name: string; kinds: string[]; missing: number; nulls: number; empty: number; interpretation?: 'number' | null; conversionFailures?: number; conversionExamples?: { row: number; sourceLine: number | null; text: string }[] };
export type Report = {
  conversionFailures?: number; parserVersion: string; scope: 'full'; rowCount: number; fields: FieldProfile[];
  missing: number; nulls: number; empty: number; duplicateRows: number; blankLines: number;
  duplicates: { row: number; duplicateOf: number; sourceLine: number | null }[];
};
export type SavedView = {
  id: string; name: string; datasetId: string; assetId: string; sha256: string;
  view: ViewSpec; report: Report; createdAt: string;
};
export type Source = {
  id: string; name: string; kind: string; filename: string; size: number; license: string; revision: string; sourceUrl: string;
};
export type CatalogState = {
  assets: Asset[]; datasets: Dataset[]; views: SavedView[]; sources: Source[];
  download: { id: string; sourceId?: string; status: string; received: number; total: number; error: string } | null;
  parserVersion: string; limits: { importBytes: number; previewBytes: number; records: number; fields: number; columns: number };
  selectedDatasetId?: string; selectedAssetId?: string; savedViewId?: string;
};
export type Selection = { datasetId: string; assetId: string };
export type InspectionRow = { row: number; pointer: string; line: number | null; cells: { kind: string; text: string; exact?: string; conversionError?: string }[] };
export type OkInspection = {
  status: 'ok'; datasetId: string; assetId: string; sha256: string; report: Report;
  columns: string[]; matched: number; selected?: number; offset: number; nextOffset: number | null; viewId?: string;
  rows: InspectionRow[];
};
export type Inspection = OkInspection | { status: 'invalid' | 'changed' | 'missing' | 'unsupported'; datasetId: string; assetId: string; message: string };
export type InspectionOutcome = Inspection | { status: 'rejected' | 'unavailable' | 'forbidden'; message: string };
export type ChartDataset = {
  datasetId: string; assetId: string; sha256: string; name: string; view: ViewSpec; viewId: string; parserVersion: string;
  fields: { name: string; kinds: string[] }[];
};

/** Only these catalog formats have a table/field inspection capability. */
export function canInspect(asset: Pick<Asset, 'kind' | 'format'>): boolean {
  return asset.kind === 'dataset' && ['csv', 'tsv', 'json', 'jsonl', 'json_lines', 'ndjson'].includes(asset.format.toLowerCase());
}

export function visibleDatasets(state: CatalogState, query: string, project: string, archived: boolean, kind = ''): Dataset[] {
  const term = query.trim().toLocaleLowerCase();
  return state.datasets.filter(dataset => dataset.archived === archived && (!project || dataset.projectRef === project)
    && (!kind || dataset.kind === kind)
    && (!term || `${dataset.name} ${dataset.kind} ${dataset.projectRef} ${state.assets.filter(a => dataset.versions.includes(a.id))
      .map(a => `${a.name} ${a.format} ${a.source}`).join(' ')}`.toLocaleLowerCase().includes(term)));
}

export function retainSelection(state: CatalogState, current: Selection | null): Selection | null {
  const dataset = state.datasets.find(d => d.id === current?.datasetId);
  if (current && dataset?.versions.includes(current.assetId)) return current;
  const first = state.datasets.find(d => !d.archived);
  return first ? { datasetId: first.id, assetId: first.versions[first.versions.length - 1] } : null;
}

export const formatInt = (value: number) => new Intl.NumberFormat('en-US').format(value);
export const formatBytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 ** 2).toFixed(1)} MiB`;
export const formatDay = (value: string) => /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
export const sourceHost = (value: string) => {
  try { return /^https:\/\//.test(value) ? new URL(value).hostname.replace(/^www\./, '') : value; }
  catch { return value; }
};

/** Format-derived labels only. No scientific claim beyond the admitted file type and revision text. */
export function datasetBadges(asset: Pick<Asset, 'format' | 'revision' | 'kind'>): string[] {
  const format = asset.format.toUpperCase();
  const badges = [format];
  if (asset.kind === 'model') return badges;
  if (format === 'H5AD') badges.push('Single cell');
  if (/scperturb|perturb/i.test(asset.revision)) badges.push('Perturbation');
  return badges;
}

/** Display order in `dataset.versions`. The label distinguishes immutable receipts, not filenames. */
export function versionLabel(asset: Pick<Asset, 'size' | 'createdAt' | 'revision'>, index: number): string {
  return [`v${index + 1}`, formatBytes(asset.size), formatDay(asset.createdAt), asset.revision].filter(Boolean).join(' · ');
}

/** Size presence, overridden when this asset's inspection reports missing or changed bytes. */
export function catalogAvailability(asset: Asset, inspection?: InspectionOutcome | null): 'present' | 'missing' | 'changed' {
  if ((inspection?.status === 'missing' || inspection?.status === 'changed') && inspection.assetId === asset.id) return inspection.status;
  return asset.availability;
}

export function availabilityLabel(asset: Asset, inspection?: InspectionOutcome | null) {
  return { present: 'Stored', missing: 'Missing', changed: 'Changed' }[catalogAvailability(asset, inspection)];
}

/** Custody wording for the selected version. `Stored` remains a size check, not a fresh digest. */
export function custodyDetail(asset: Asset, inspection: InspectionOutcome | null | undefined, bytesMatched: boolean): string {
  if (bytesMatched) return 'Inspected bytes match the admitted SHA-256.';
  if (catalogAvailability(asset, inspection) === 'missing') return 'Original file is missing.';
  if (asset.availability === 'changed') return 'File size no longer matches the admitted size.';
  if (inspection?.status === 'changed' && inspection.assetId === asset.id) return 'Admitted SHA-256 does not match the current file.';
  return `File present. Size matches ${formatBytes(asset.size)}. Digest recorded at admission, not rechecked.`;
}

export function summary(value: OkInspection) {
  return { datasetId: value.datasetId, assetId: value.assetId, sha256: value.sha256, viewId: value.viewId ?? '',
    matching: value.matched, selected: value.selected ?? 0, offset: value.offset, visibleRows: value.rows.length };
}

export function encodeBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let encoded = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    encoded += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(encoded);
}

/** Applying a type removes only predicates that lose their numeric interpretation. */
export function applyInterpretation(view: ViewSpec, field: string, numeric: boolean): ViewSpec {
  const interpretations = { ...view.interpretations };
  if (numeric) interpretations[field] = 'number';
  else delete interpretations[field];
  const issue = !numeric && view.issue?.kind === 'conversion' &&
    (view.issue.field === field || !Object.keys(interpretations).length) ? null : view.issue ?? null;
  const filter = !numeric && view.filter?.field === field && ['gte', 'lte'].includes(view.filter.operator)
    ? null : view.filter;
  return { ...view, interpretations, issue, filter };
}

/** A type preview reads the full input without changing the active analysis. */
export function interpretationPreview(view: ViewSpec, field: string, numeric: boolean): ViewSpec {
  return { ...applyInterpretation(view, field, numeric), filter: null, sort: null, selection: [], chart: null, issue: null, columns: [field] };
}

/** Bounded JSON-safe sample for the semantic App object. */
export function sampleRows(value: OkInspection) {
  const sample = value.rows.slice(0, 10).map(row => ({
    ordinal: row.row - 1, pointer: row.pointer, line: row.line,
    cells: Object.fromEntries(value.columns.slice(0, 8).map((name, index) => [name, {
      kind: row.cells[index]?.kind ?? 'missing', ...(row.cells[index]?.exact === undefined ? {}
        : row.cells[index].exact.length <= 240 ? { exact: row.cells[index].exact } : { exactOmitted: true }),
      ...(row.cells[index]?.conversionError === undefined ? {} : { conversionError: row.cells[index].conversionError }),
      display: (row.cells[index]?.text ?? '').slice(0, 240),
      truncated: (row.cells[index]?.text.length ?? 0) > 240,
    }])),
  }));
  const encoder = new TextEncoder();
  while (encoder.encode(JSON.stringify(sample)).length > 8192) sample.pop();
  return sample;
}
