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
  download: { id: string; status: string; received: number; total: number; error: string } | null;
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
export type ChartDataset = {
  datasetId: string; assetId: string; sha256: string; name: string; view: ViewSpec; viewId: string; parserVersion: string;
  fields: { name: string; kinds: string[] }[];
};

export function visibleDatasets(state: CatalogState, query: string, project: string, archived: boolean): Dataset[] {
  const term = query.trim().toLocaleLowerCase();
  return state.datasets.filter(dataset => dataset.archived === archived && (!project || dataset.projectRef === project) &&
    (!term || `${dataset.name} ${dataset.kind} ${dataset.projectRef} ${state.assets.filter(a => dataset.versions.includes(a.id))
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
export const availabilityLabel = (asset: Asset) => ({ present: 'Stored', missing: 'Missing', changed: 'Changed' })[asset.availability];

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

/** Applying a type preserves analysis, except issue predicates whose type no longer exists. */
export function applyInterpretation(view: ViewSpec, field: string, numeric: boolean): ViewSpec {
  const interpretations = { ...view.interpretations };
  if (numeric) interpretations[field] = 'number';
  else delete interpretations[field];
  const issue = !numeric && view.issue?.kind === 'conversion' &&
    (view.issue.field === field || !Object.keys(interpretations).length) ? null : view.issue;
  return { ...view, interpretations, issue };
}

/** A type preview reads the full input without changing the active analysis. */
export function interpretationPreview(view: ViewSpec, field: string, numeric: boolean): ViewSpec {
  return { ...applyInterpretation(view, field, numeric), filter: null, sort: null, selection: [], chart: null, issue: null, columns: [field] };
}
