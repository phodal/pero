import type { NotebookDocument, NotebookNode, CellAnnotation } from './document.ts';

/** Local published templates. Revisions are immutable; archive prevents new instances. */
export type TemplateKind = 'entry' | 'fragment';
export type TemplateValue = string | number | boolean;
export type TemplateTarget =
  | { kind: 'title' }
  | { kind: 'block-text'; blockId: string }
  | { kind: 'block-attribute'; blockId: string; field: 'label' | 'claim' | 'limitations' | 'caption' | 'checked' }
  | { kind: 'spreadsheet-cell'; blockId: string; address: string };
export interface TemplateParameter {
  key: string; label: string; type: 'text' | 'decimal' | 'boolean'; required: boolean;
  target: TemplateTarget; default?: TemplateValue;
}
export interface TemplateSummary {
  id: string; revision: number; name: string; description: string; kind: TemplateKind;
  collections: string[]; archived: boolean; publishedAt: string;
}
export interface PublishedTemplate extends TemplateSummary { document: NotebookDocument; parameters: TemplateParameter[] }
export interface TemplateOrigin {
  templateId: string; revision: number; instanceId: string;
  parameterValues: Record<string, TemplateValue>; idMap: Record<string, string>;
}
export interface TemplateInstance { document: NotebookDocument; origin: TemplateOrigin }

const validId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id);
const visit = (node: NotebookNode, apply: (node: NotebookNode) => void) => { apply(node); for (const child of node.content ?? []) visit(child, apply); };
const attrsFields: Record<string, string[]> = {
  section: ['label'], spreadsheet: ['label'], evidence: ['label'], experiment: ['label'],
  finding: ['claim', 'limitations'], attachment: ['caption'], taskItem: ['checked'],
};

function bind(document: NotebookDocument, parameter: TemplateParameter): (value: TemplateValue) => void {
  const target = parameter.target;
  if (target.kind === 'title') {
    if (parameter.type !== 'text') throw new Error('Entry title requires a text parameter.');
    return value => { if (!String(value).trim() || String(value).length > 200) throw new Error('Invalid entry title.'); document.title = String(value); };
  }
  let found: NotebookNode | undefined;
  visit(document.content, node => { if (node.attrs?.blockId === target.blockId) found = node; });
  if (!found) throw new Error(`Parameter ${parameter.key} has a stale block binding.`);
  const node = found;
  if (target.kind === 'block-text') {
    if (!['paragraph', 'heading', 'codeBlock'].includes(node.type) || parameter.type !== 'text') throw new Error('Unsupported text binding.');
    return value => { node.content = value === '' ? [] : [{ type: 'text', text: String(value) }]; };
  }
  if (target.kind === 'block-attribute') {
    if (!attrsFields[node.type]?.includes(target.field) || parameter.type !== (target.field === 'checked' ? 'boolean' : 'text')) throw new Error('Unsupported typed attribute binding.');
    return value => {
      const limit = ['label'].includes(target.field) ? 200 : target.field === 'caption' ? 2000 : 32768;
      if (typeof value === 'string' && value.length > limit) throw new Error('Parameter exceeds the field limit.');
      node.attrs![target.field] = value;
    };
  }
  const sheet = node.attrs?.sheet as { rows: number; columns: number; cells: Record<string, string> } | undefined;
  const match = /^([A-Z]{1,2})([1-9][0-9]{0,2})$/.exec(target.address);
  const column = match ? [...match[1]].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) : 0;
  if (node.type !== 'spreadsheet' || !sheet || !match || column > sheet.columns || Number(match[2]) > sheet.rows || sheet.cells[target.address]?.startsWith('=')) throw new Error('Stale, invalid, or calculated cell binding.');
  return value => {
    let cell = typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value);
    if (parameter.type === 'text' && cell) cell = `'${cell}`;
    if (cell.length > 4096) throw new Error('Parameter exceeds the cell limit.');
    sheet.cells[target.address] = cell;
  };
}

/** Validate explicit targets before a template is sent for publication. No global substitution. */
export function validateTemplateParameters(document: NotebookDocument, parameters: TemplateParameter[], kind: TemplateKind): void {
  if (!Array.isArray(parameters) || parameters.length > 50) throw new Error('At most 50 parameters are supported.');
  const keys = new Set<string>(), targets = new Set<string>();
  for (const parameter of parameters) {
    if (!validId(parameter.key) || keys.has(parameter.key) || !parameter.label.trim() || parameter.label.length > 200 || !['text', 'decimal', 'boolean'].includes(parameter.type) || typeof parameter.required !== 'boolean') throw new Error('Invalid or duplicate template parameter.');
    keys.add(parameter.key);
    if (kind === 'fragment' && parameter.target.kind === 'title') throw new Error('Fragment parameters cannot change the entry title.');
    const target = JSON.stringify(parameter.target);
    if (targets.has(target)) throw new Error('Two parameters cannot write the same field.');
    targets.add(target);
    const setter = bind(structuredClone(document), parameter);
    if (parameter.default !== undefined) { validateValue(parameter, parameter.default); setter(parameter.default); }
  }
}

function validateValue(parameter: TemplateParameter, value: TemplateValue): void {
  if (parameter.type === 'text' ? typeof value !== 'string' || value.length > 32768 || (parameter.required && !value.trim())
    : parameter.type === 'boolean' ? typeof value !== 'boolean' : typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${parameter.type} value for ${parameter.label}.`);
}

/** Clone only Notebook-owned identities. Source owner IDs, fixed snapshots and digests stay untouched. */
export function instantiateTemplate(template: PublishedTemplate, values: Record<string, TemplateValue>, newId: () => string): TemplateInstance {
  if (template.archived) throw new Error('Archived templates cannot create new instances.');
  validateTemplateParameters(template.document, template.parameters, template.kind);
  const document = structuredClone(template.document);
  const parameterEntries: [string, TemplateValue][] = [];
  if (Object.keys(values).some(key => !template.parameters.some(parameter => parameter.key === key))) throw new Error('Unknown template parameter.');
  for (const parameter of template.parameters) {
    const value = values[parameter.key] ?? parameter.default;
    if (value === undefined) { if (parameter.required) throw new Error(`Missing ${parameter.label}.`); continue; }
    validateValue(parameter, value); bind(document, parameter)(value); parameterEntries.push([parameter.key, value]);
  }
  const roots: NotebookNode[] = [document.content];
  for (const procedure of document.procedures ?? []) for (const step of procedure.steps) {
    const typed = step as typeof step & { content?: NotebookNode; timer?: { elapsedMs: number; startedAt: number | null } };
    if (typed.content) roots.push(typed.content);
    step.completed = false;
    if (typed.timer) typed.timer = { elapsedMs: 0, startedAt: null };
  }
  const existing = new Set<string>();
  for (const root of roots) visit(root, node => {
    if (typeof node.attrs?.blockId === 'string') existing.add(node.attrs.blockId);
    if (['inputTable', 'registrationTable'].includes(node.type)) {
      const table = node.attrs!.table as { id: string; rows: { id: string }[] };
      existing.add(table.id); for (const row of table.rows) existing.add(row.id);
    }
  });
  for (const procedure of document.procedures ?? []) for (const item of [procedure, ...procedure.materials, ...procedure.steps]) existing.add(item.id);
  const allocated = new Set<string>();
  const fresh = () => { const id = newId(); if (!validId(id) || existing.has(id) || allocated.has(id)) throw new Error('Template identity factory must return fresh IDs.'); allocated.add(id); return id; };
  const idMap: Record<string, string> = Object.fromEntries([...existing].map(id => [id, fresh()]));
  const remap = (ids: string[]) => ids.map(id => idMap[id] ?? id);
  for (const root of roots) visit(root, node => {
    if (!['doc', 'text', 'hardBreak', 'referenceMention'].includes(node.type)) node.attrs = { ...node.attrs, blockId: typeof node.attrs?.blockId === 'string' ? idMap[node.attrs.blockId] : fresh() };
    if (['inputTable', 'registrationTable'].includes(node.type)) {
      const table = node.attrs!.table as { id: string; rows: { id: string }[] };
      table.id = idMap[table.id]; for (const row of table.rows) row.id = idMap[row.id];
      // Schema IDs, column IDs, catalog references and submission receipts are fixed source identities.
    }
    if (node.type === 'finding') node.attrs!.evidenceIds = remap(node.attrs!.evidenceIds as string[]);
    if (node.type === 'spreadsheet') node.attrs!.annotations = Object.fromEntries(Object.entries(node.attrs!.annotations as Record<string, CellAnnotation> ?? {})
      .map(([address, annotation]) => [address, { ...annotation, evidenceIds: remap(annotation.evidenceIds) }]));
  });
  for (const procedure of document.procedures ?? []) for (const item of [procedure, ...procedure.materials, ...procedure.steps]) item.id = idMap[item.id];
  const origin: TemplateOrigin = { templateId: template.id, revision: template.revision, instanceId: fresh(), parameterValues: Object.fromEntries(parameterEntries), idMap };
  if (template.kind === 'entry') Object.assign(document, { templateOrigin: origin });
  else for (const node of document.content.content) node.attrs = { ...node.attrs, templateOrigin: origin };
  return { document, origin };
}

/** Explicit text/cell/checkbox fields for the publication form. */
export function templateBindingChoices(document: NotebookDocument, kind: TemplateKind): { label: string; target: TemplateTarget; types: TemplateParameter['type'][] }[] {
  const result: ReturnType<typeof templateBindingChoices> = kind === 'entry' ? [{ label: 'Entry title', target: { kind: 'title' }, types: ['text'] }] : [];
  visit(document.content, node => {
    const blockId = node.attrs?.blockId;
    if (typeof blockId !== 'string') return;
    const label = String(node.attrs?.label || node.attrs?.claim || node.content?.find(child => child.text)?.text || node.type).slice(0, 60);
    if (['paragraph', 'heading', 'codeBlock'].includes(node.type)) result.push({ label: `${label} · text`, target: { kind: 'block-text', blockId }, types: ['text'] });
    for (const field of attrsFields[node.type] ?? []) result.push({ label: `${label} · ${field}`, target: { kind: 'block-attribute', blockId, field: field as Extract<TemplateTarget, { kind: 'block-attribute' }>['field'] }, types: [field === 'checked' ? 'boolean' : 'text'] });
    if (node.type === 'spreadsheet') {
      const sheet = node.attrs!.sheet as { rows: number; columns: number; cells: Record<string, string> };
      for (const address of Object.keys(sheet.cells)) if (!sheet.cells[address].startsWith('=')) result.push({ label: `${label} · ${address}`, target: { kind: 'spreadsheet-cell', blockId, address }, types: ['text', 'decimal', 'boolean'] });
    }
  });
  return result;
}

/** HTML/clipboard boundary for provenance. External owner snapshots are not parsed here. */
export function isTemplateOrigin(value: unknown): value is TemplateOrigin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const origin = value as Record<string, unknown>;
  if (Object.keys(origin).sort().join(',') !== 'idMap,instanceId,parameterValues,revision,templateId' ||
      typeof origin.templateId !== 'string' || !validId(origin.templateId) || typeof origin.instanceId !== 'string' || !validId(origin.instanceId) ||
      typeof origin.revision !== 'number' || !Number.isSafeInteger(origin.revision) || origin.revision < 1) return false;
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  if (!object(origin.parameterValues) || Object.keys(origin.parameterValues).length > 50 || !object(origin.idMap) || Object.keys(origin.idMap).length > 10000) return false;
  if (!Object.entries(origin.parameterValues).every(([key, item]) => validId(key) && (typeof item === 'string' ? item.length <= 32768 : typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)))) return false;
  return Object.entries(origin.idMap).every(([key, item]) => validId(key) && typeof item === 'string' && validId(item)) && new Set(Object.values(origin.idMap)).size === Object.keys(origin.idMap).length;
}

/** A copied instance keeps its source revision, with a fresh instance identity and copied targets. */
export function copyTemplateOrigin(origin: TemplateOrigin, copiedIds: ReadonlyMap<string, string>, copiedInstances: Map<string, string>, newId: () => string): TemplateOrigin {
  let instanceId = copiedInstances.get(origin.instanceId);
  if (!instanceId) { instanceId = newId(); copiedInstances.set(origin.instanceId, instanceId); }
  return { ...structuredClone(origin), instanceId, idMap: Object.fromEntries(Object.entries(origin.idMap).map(([source, target]) => [source, copiedIds.get(target) ?? target])) };
}
