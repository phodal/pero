// Bounded, local display documents. These never enter the perturbation evaluator.
export type Source = { id: string; revision: string; kind: 'observed' | 'illustrative'; url?: string };
export type Atlas = { schema: 'point.virtual-cell.atlas.v1'; source: Source; scale: string; genes: string[]; embedding: { method: 'UMAP' | 't-SNE' | 'PCA'; coordinates: number[][] }; cells: { id: string; group: string; expression: number[] }[] };
export type Mechanism = { schema: 'point.virtual-cell.mechanism.v1'; source: Source; timeUnit: string; concentrationUnit: string; duration: number; species: { id: string; initial: number }[]; reactions: { id: string; from: string; to: string; rate: number }[] };
export type Volume = { schema: 'point.virtual-cell.volume.v1'; source: Source; dimensions: number[]; spacing: number[]; unit: string; channels: { name: string; values: number[] }[] };
export type DisplayDocument = Atlas | Mechanism | Volume;
export type Dataset = { genes: string[]; control: string; scale: string; conditions: { id: string; targets: string[]; cells: number; mean: number[] }[] };
export type Bundle = { dataset: Dataset; split: { assignments: Record<string, string[]> }; predictions: any[] };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= 240;
const unique = (values: string[]) => new Set(values).size === values.length;
const vector = (a: unknown, n: number) => Array.isArray(a) && a.length === n && a.every(finite);

/** Reject unsupported/oversized files before allocating plotting/GPU resources. */
export function parseDisplay(value: unknown): DisplayDocument {
  const d = value as DisplayDocument;
  const fail = () => { throw new Error('display_document_invalid'); };
  if (!d || typeof d !== 'object' || !d.source || !text(d.source.id) || !text(d.source.revision) || !['observed', 'illustrative'].includes(d.source.kind)) fail();
  if (d.source.url && (!text(d.source.url) || !/^https:\/\//.test(d.source.url))) fail();
  if (d.schema === 'point.virtual-cell.atlas.v1') {
    if (!text(d.scale) || !Array.isArray(d.genes) || !d.genes.length || d.genes.length > 128 || !d.genes.every(text) || !unique(d.genes)) fail();
    if (!Array.isArray(d.cells) || !d.cells.length || d.cells.length > 5000 || d.cells.length * d.genes.length > 500000) fail();
    if (!d.embedding || !['UMAP', 't-SNE', 'PCA'].includes(d.embedding.method) || !Array.isArray(d.embedding.coordinates) || d.embedding.coordinates.length !== d.cells.length || !d.embedding.coordinates.every(p => vector(p, 2))) fail();
    if (!d.cells.every(c => c && text(c.id) && text(c.group) && vector(c.expression, d.genes.length)) || !unique(d.cells.map(c => c.id))) fail();
    if (new Set(d.cells.map(c => c.group)).size > 32) fail();
  } else if (d.schema === 'point.virtual-cell.mechanism.v1') {
    if (!text(d.timeUnit) || !text(d.concentrationUnit) || !finite(d.duration) || d.duration < .1 || d.duration > 100) fail();
    if (!Array.isArray(d.species) || !d.species.length || d.species.length > 32 || !d.species.every(s => s && text(s.id) && finite(s.initial) && s.initial >= 0 && s.initial <= 10000) || !unique(d.species.map(s => s.id))) fail();
    const ids = new Set(d.species.map(s => s.id));
    if (!Array.isArray(d.reactions) || !d.reactions.length || d.reactions.length > 64 || !d.reactions.every(r => r && text(r.id) && ids.has(r.from) && ids.has(r.to) && r.from !== r.to && finite(r.rate) && r.rate >= 0 && r.rate <= 10) || !unique(d.reactions.map(r => r.id))) fail();
    // Validate the solver budget before replacing the visible document: every
    // accepted model must also be safe to compute on its first render.
    const maxOut = Math.max(1, ...d.species.map(s => d.reactions.filter(r => r.from === s.id).reduce((sum, r) => sum + r.rate, 0)));
    if (Math.ceil(d.duration * maxOut * 4) > 20000) fail();
  } else if (d.schema === 'point.virtual-cell.volume.v1') {
    if (!vector(d.dimensions, 3) || !d.dimensions.every(n => Number.isInteger(n) && n >= 2 && n <= 64) || !vector(d.spacing, 3) || !d.spacing.every(n => n > 0 && n <= 10000) || !text(d.unit)) fail();
    const size = d.dimensions.reduce((a, b) => a * b, 1);
    if (!Array.isArray(d.channels) || !d.channels.length || d.channels.length > 3 || !d.channels.every(c => c && text(c.name) && vector(c.values, size) && c.values.every(v => v >= 0 && v <= 1)) || !unique(d.channels.map(c => c.name))) fail();
  } else fail();
  return d;
}

/** Explicit first-order transfer model; no fitted biology, PDE or hidden time inference. */
export function simulate(model: Mechanism) {
  parseDisplay(model);
  const ids = model.species.map(s => s.id);
  const edges = model.reactions.map(r => ({ a: ids.indexOf(r.from), b: ids.indexOf(r.to), k: r.rate }));
  const maxOut = Math.max(1, ...ids.map((_, i) => edges.filter(e => e.a === i).reduce((n, e) => n + e.k, 0)));
  const steps = Math.max(200, Math.ceil(model.duration * maxOut * 4));
  if (steps > 20000) throw new Error('simulation_step_limit');
  const dt = model.duration / steps, y = model.species.map(s => s.initial);
  const rows = [{ time: 0, values: [...y] }];
  for (let i = 1; i <= steps; i++) {
    const delta = y.map(() => 0);
    for (const { a, b, k } of edges) { const flux = dt * k * y[a]; delta[a] -= flux; delta[b] += flux; }
    y.forEach((_, j) => { y[j] += delta[j]; });
    if (i % Math.ceil(steps / 200) === 0 || i === steps) rows.push({ time: i * dt, values: [...y] });
  }
  return { rows, dt, solver: 'explicit_euler_first_order_transfer' };
}

export function groupMeans(atlas: Atlas, groups: string[]) {
  return groups.map(group => {
    const cells = atlas.cells.filter(c => c.group === group);
    return { id: group, count: cells.length, values: atlas.genes.map((_, g) => cells.reduce((n, c) => n + c.expression[g], 0) / Math.max(1, cells.length)) };
  });
}
