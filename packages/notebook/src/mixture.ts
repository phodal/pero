import { chemistryUnits } from './science-chemistry.ts';

export const mixtureUnits = { ...chemistryUnits.mass, ...chemistryUnits.volume, ...chemistryUnits.amount };
export interface MixtureQuantity { value: number | null; unit: string }
export interface MixtureIngredient { id: string; reference: string; source: string; mode: 'quantity' | 'qs'; target: MixtureQuantity }
export interface MixtureRecipe { name: string; output: string; notes: string; target: MixtureQuantity; additiveVolumes: boolean; ingredients: MixtureIngredient[] }
export interface MixtureRecipeRevision { revision: number; recipe: MixtureRecipe }
export interface MixtureRecord { id: string; recipeRevision: number; recipe: MixtureRecipe; operator: string; recordedAt: string; actual: Record<string, MixtureQuantity>; output: string; notes: string }
export interface MixturePreparation { version: 1; draft: MixtureRecipe; recipes: MixtureRecipeRevision[]; measurements: Record<string, MixtureQuantity>; records: MixtureRecord[] }
export function emptyMixturePreparation(): MixturePreparation {
  return { version: 1, draft: { name: '', output: '', notes: '', target: { value: null, unit: 'mL' }, additiveVolumes: false, ingredients: [] }, recipes: [], measurements: {}, records: [] };
}
const fail = (message: string): never => { throw new Error(message); };
function object(value: unknown, keys: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) fail('Invalid mixture fields.');
  return value as Record<string, any>;
}
function text(value: unknown, max = 200): string { if (typeof value !== 'string' || value.length > max) fail('Invalid mixture text.'); return value as string; }
function id(value: unknown): string { const result = text(value, 128); if (!/^[A-Za-z0-9_-]+$/.test(result)) fail('Invalid mixture identity.'); return result; }
export function mixtureDimension(unit: string): 'mass' | 'volume' | 'amount' {
  for (const dimension of ['mass', 'volume', 'amount'] as const) if (Object.hasOwn(chemistryUnits[dimension], unit)) return dimension;
  return fail('Unsupported quantity unit.');
}
export function parseMixtureQuantity(value: unknown): MixtureQuantity {
  const q = object(value, ['value', 'unit']); mixtureDimension(q.unit);
  if (q.value !== null && (typeof q.value !== 'number' || !Number.isFinite(q.value) || q.value < 0 || q.value > 1e12)) fail('Quantity must be unknown or a finite nonnegative number ≤ 1e12.');
  return { value: q.value, unit: q.unit };
}
export function convertMixtureQuantity(quantity: MixtureQuantity, unit: string): number | null {
  if (mixtureDimension(quantity.unit) !== mixtureDimension(unit)) fail('Incompatible quantity dimensions.');
  return quantity.value === null ? null : quantity.value * mixtureUnits[quantity.unit] / mixtureUnits[unit];
}
function recipe(value: unknown): MixtureRecipe {
  const r = object(value, ['name', 'output', 'notes', 'target', 'additiveVolumes', 'ingredients']);
  text(r.name); text(r.output); text(r.notes, 4000); parseMixtureQuantity(r.target);
  if (typeof r.additiveVolumes !== 'boolean' || !Array.isArray(r.ingredients) || r.ingredients.length > 100) fail('Invalid mixture recipe.');
  const ids = new Set<string>(); let qs = 0;
  for (const item of r.ingredients) {
    const i = object(item, ['id', 'reference', 'source', 'mode', 'target']); id(i.id); text(i.reference); text(i.source, 1000); parseMixtureQuantity(i.target);
    if (ids.has(i.id)) fail('Duplicate ingredient identity.'); ids.add(i.id);
    if (i.mode !== 'quantity' && i.mode !== 'qs') fail('Invalid ingredient mode.');
    if (i.mode === 'qs') { qs++; if (i.target.value !== null || mixtureDimension(i.target.unit) !== 'volume' || mixtureDimension(r.target.unit) !== 'volume') fail('QS requires an unknown volume target.'); }
  }
  if (qs > 1) fail('Only one QS ingredient is supported.');
  return { name: r.name, output: r.output, notes: r.notes, target: parseMixtureQuantity(r.target), additiveVolumes: r.additiveVolumes, ingredients: r.ingredients.map((i: MixtureIngredient) => ({ id: i.id, reference: i.reference, source: i.source, mode: i.mode, target: parseMixtureQuantity(i.target) })) };
}
/** Null means no defensible estimate. Non-additive mixing must be measured to final volume. */
export function mixtureQSEstimate(r: MixtureRecipe): MixtureQuantity | null {
  const qs = r.ingredients.find(i => i.mode === 'qs'); if (!qs) return null;
  if (!r.additiveVolumes || r.target.value === null) return { value: null, unit: qs.target.unit };
  let sum = 0;
  for (const i of r.ingredients.filter(i => i.mode !== 'qs')) {
    const value = convertMixtureQuantity(i.target, r.target.unit);
    if (value === null) return { value: null, unit: qs.target.unit }; sum += value;
  }
  if (sum > r.target.value + Math.max(1, r.target.value) * 1e-9) fail('Ingredients exceed the final QS target.');
  return { value: convertMixtureQuantity({ value: Math.max(0, r.target.value - sum), unit: r.target.unit }, qs.target.unit), unit: qs.target.unit };
}
export function validateMixtureRecipe(r: MixtureRecipe): void {
  if (!r.name.trim() || !r.ingredients.length || r.target.value === null || r.target.value <= 0) fail('Name, positive target and at least one ingredient are required.');
  for (const i of r.ingredients) if (!i.reference.trim() || (i.mode === 'quantity' && (i.target.value === null || i.target.value <= 0))) fail('Each ingredient needs a reference and a positive planned quantity.');
  mixtureQSEstimate(r);
}
function actual(value: unknown, r: MixtureRecipe, complete: boolean): Record<string, MixtureQuantity> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid measurements.');
  const result: Record<string, MixtureQuantity> = {};
  for (const [key, q] of Object.entries(value as Record<string, unknown>)) {
    const ingredient = r.ingredients.find(i => i.id === key); if (!ingredient) fail('Unknown measured ingredient.');
    result[key] = parseMixtureQuantity(q);
    convertMixtureQuantity(result[key], ingredient!.target.unit);
  }
  if (complete && r.ingredients.some(i => !result[i.id] || result[i.id].value === null)) fail('Enter actual quantities for every ingredient; planned amounts are not measurements.');
  return result;
}
export function parseMixturePreparation(value: unknown): MixturePreparation {
  const s = object(value, ['version', 'draft', 'recipes', 'measurements', 'records']);
  if (s.version !== 1 || !Array.isArray(s.recipes) || s.recipes.length > 100 || !Array.isArray(s.records) || s.records.length > 100) fail('Invalid mixture history.');
  const draft = recipe(s.draft); const recipes: MixtureRecipeRevision[] = s.recipes.map((item: unknown, index: number) => {
    const r = object(item, ['revision', 'recipe']); if (r.revision !== index + 1) fail('Invalid recipe revision.');
    const parsed = recipe(r.recipe); validateMixtureRecipe(parsed); return { revision: r.revision, recipe: parsed };
  });
  const ids = new Set<string>(); const records: MixtureRecord[] = s.records.map((item: unknown) => {
    const r = object(item, ['id', 'recipeRevision', 'recipe', 'operator', 'recordedAt', 'actual', 'output', 'notes']);
    id(r.id); if (ids.has(r.id)) fail('Duplicate preparation record.'); ids.add(r.id);
    text(r.operator); text(r.output); text(r.notes, 4000); text(r.recordedAt, 40);
    if (!r.operator.trim() || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.recordedAt) || !Number.isFinite(Date.parse(r.recordedAt)) || new Date(r.recordedAt).toISOString() !== r.recordedAt) fail('Operator and UTC recording time are required.');
    const source = recipes.find(x => x.revision === r.recipeRevision); const snapshot = recipe(r.recipe);
    if (!source || JSON.stringify(source.recipe) !== JSON.stringify(snapshot)) fail('Preparation must preserve the source recipe revision.');
    return { ...r, recipe: snapshot, actual: actual(r.actual, snapshot, true) } as MixtureRecord;
  });
  return { version: 1, draft, recipes, measurements: actual(s.measurements, draft, false), records };
}
/** A changed recipe invalidates pending observations; historical records remain untouched. */
export function editMixtureRecipe(state: MixturePreparation, draft: MixtureRecipe): MixturePreparation {
  return { ...state, draft, measurements: {} };
}
export function saveMixtureRecipe(state: MixturePreparation): MixturePreparation {
  const parsed = recipe(state.draft); validateMixtureRecipe(parsed); if (state.recipes.length >= 100) fail('Recipe revision limit reached.');
  return { ...state, draft: parsed, recipes: [...state.recipes, { revision: state.recipes.length + 1, recipe: structuredClone(parsed) }] };
}
export function recordMixturePreparation(state: MixturePreparation, input: { id: string; expectedRecipeRevision: number; expectedDraft: MixtureRecipe; operator: string; recordedAt: string; output: string; notes: string }): MixturePreparation {
  const saved = state.recipes.at(-1);
  if (!saved || saved.revision !== input.expectedRecipeRevision || JSON.stringify(saved.recipe) !== JSON.stringify(state.draft) || JSON.stringify(input.expectedDraft) !== JSON.stringify(state.draft)) fail('Recipe changed. Save and review the current recipe before recording actual preparation.');
  const record: MixtureRecord = { id: input.id, recipeRevision: saved!.revision, recipe: structuredClone(saved!.recipe), operator: input.operator, recordedAt: input.recordedAt, actual: structuredClone(state.measurements), output: input.output, notes: input.notes };
  return parseMixturePreparation({ ...state, records: [...state.records, record] });
}
