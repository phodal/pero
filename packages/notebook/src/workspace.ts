import { isProcedureParameter, procedureParameterLimits, type ProcedureParameter } from './procedure-parameters.ts';
import { scientificReferenceState, type NotebookDocument, type NotebookNode, type ScientificReference, type ScientificReferenceState } from './document.ts';

/** Display labels only. These do not grant project membership or verify authorship. */
export interface NotebookMetadata {
  project: string;
  author: string;
  tags: string[];
}

/** A pinned identity selected from Notebook's local registered catalog, not live inventory. */
export interface MaterialSource {
  source: 'notebook-local-catalog'; catalogId: string; recordId: string; version: number;
  schemaId: string; schemaRevision: number;
}
export interface NotebookMaterial {
  id: string; name: string; quantity: string;
  source?: MaterialSource;
  content?: NotebookNode;
  children?: NotebookMaterial[];
}
export function materialItems(materials: readonly NotebookMaterial[]): NotebookMaterial[] {
  return materials.flatMap(item => [item, ...materialItems(item.children ?? [])]);
}
/** Shared tree roots for search, templates and navigation; rich content wins over legacy prose. */
export function notebookContentRoots(document: Pick<NotebookDocument, 'content' | 'procedures'>): NotebookNode[] {
  return [document.content, ...(document.procedures ?? []).flatMap(procedure =>
    [procedure.introduction, ...materialItems(procedure.materials).map(item => item.content), ...procedure.steps.map(step => step.content)]
      .filter((node): node is NotebookNode => !!node))];
}
export const procedureKinds = ['header', 'step', 'description', 'image', 'table', 'timer'] as const;
export type ProcedureKind = typeof procedureKinds[number];
/** Manual wall-clock measurement, never an instrument execution receipt. */
export interface ProcedureTimer { elapsedMs: number; startedAt: number | null }
export function procedureElapsed(timer: ProcedureTimer | undefined, now: number): number {
  return timer ? timer.elapsedMs + (timer.startedAt === null ? 0 : Math.max(0, now - timer.startedAt)) : 0;
}
export function procedurePlannedMinutes(procedure: NotebookProcedure): number {
  return procedure.steps.reduce((sum, step) => sum + (step.minutes ?? 0), 0);
}
export interface NotebookProcedureStep {
  /** Absent in older snapshots; interpreted as step. */
  kind?: ProcedureKind;
  /** Authoritative formatted content; legacy text is only a fallback. */
  content?: NotebookNode;
  timer?: ProcedureTimer;
  id: string;
  text: string;
  level: 'step' | 'section' | 'substep';
  critical: boolean;
  pause: boolean;
  /** Planned duration in minutes, not an active timer or execution receipt. */
  minutes: number | null;
  /** A manually recorded checkbox, not a verified experiment result. */
  completed: boolean;
}
export interface NotebookProcedure {
  id: string;
  title: string;
  description: string;
  introduction?: NotebookNode;
  parameters?: ProcedureParameter[];
  materials: NotebookMaterial[];
  steps: NotebookProcedureStep[];
}

export const workspaceLimits = {
  label: 200, tags: 50, tagLength: 100, procedures: 50, materials: 100,
  steps: 500, materialDepth: 4, text: 32768, minutes: 10080,
} as const;

export type ProcedureChange =
  | { type: 'add'; id: string; title: string }
  | { type: 'remove'; id: string }
  | { type: 'edit'; id: string; patch: Partial<Pick<NotebookProcedure, 'title' | 'description' | 'introduction'>> }
  | { type: 'addParameter'; id: string; parameter: ProcedureParameter }
  | { type: 'editParameter'; id: string; parameterId: string; expectedVersion: number; patch: Partial<Omit<ProcedureParameter, 'id' | 'version'>> }
  | { type: 'removeParameter'; id: string; parameterId: string; expectedVersion: number }
  | { type: 'addMaterial'; id: string; materialId: string; parentId?: string }
  | { type: 'removeMaterial'; id: string; materialId: string }
  | { type: 'editMaterial'; id: string; materialId: string; patch: Partial<Pick<NotebookMaterial, 'name' | 'quantity' | 'source' | 'content'>> }
  | { type: 'moveMaterial'; id: string; materialId: string; direction: -1 | 1 }
  | { type: 'addStep'; id: string; stepId: string; kind?: ProcedureKind }
  | { type: 'timer'; id: string; stepId: string; action: 'start' | 'pause' | 'reset'; now: number }
  | { type: 'removeStep'; id: string; stepId: string }
  | { type: 'editStep'; id: string; stepId: string; patch: Partial<Omit<NotebookProcedureStep, 'id'>> }
  | { type: 'moveStep'; id: string; stepId: string; direction: -1 | 1 };
export type ProcedureResult = { status: 'ok'; procedures: NotebookProcedure[] } | { status: 'limit' | 'invalid' | 'missing' | 'stale' };

const validId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id);
const validText = (text: string, limit: number) => [...text].length <= limit;

/** Typed local authoring transitions. Wire validation belongs to the storage boundary. */
export function changeProcedures(procedures: NotebookProcedure[], change: ProcedureChange): ProcedureResult {
  const identities = new Set<string>();
  for (const procedure of procedures) for (const item of [procedure, ...(procedure.parameters ?? []), ...materialItems(procedure.materials), ...procedure.steps]) identities.add(item.id);
  const visit = (node: NotebookNode) => { if (typeof node.attrs?.blockId === 'string') identities.add(node.attrs.blockId); for (const child of node.content ?? []) visit(child); };
  for (const procedure of procedures) for (const root of [procedure.introduction, ...materialItems(procedure.materials).map(item => item.content), ...procedure.steps.map(item => item.content)]) if (root) visit(root);
  if (change.type === 'add') {
    if (procedures.length >= workspaceLimits.procedures) return { status: 'limit' };
    if (!validId(change.id) || identities.has(change.id) || !validText(change.title, workspaceLimits.label)) return { status: 'invalid' };
    return { status: 'ok', procedures: [...procedures, { id: change.id, title: change.title, description: '', materials: [], steps: [] }] };
  }
  const index = procedures.findIndex(item => item.id === change.id);
  if (index < 0) return { status: 'missing' };
  const procedure = procedures[index];
  if (change.type === 'remove') return { status: 'ok', procedures: procedures.filter(item => item.id !== change.id) };
  let next: NotebookProcedure;
  switch (change.type) {
    case 'edit': {
      next = { ...procedure, ...change.patch };
      if (!validText(next.title, workspaceLimits.label) || !validText(next.description, workspaceLimits.text)) return { status: 'invalid' };
      break;
    }
    case 'addParameter':
    case 'editParameter':
    case 'removeParameter': {
      const parameters = [...procedure.parameters ?? []];
      if (change.type === 'addParameter') {
        if (parameters.length >= procedureParameterLimits.parameters) return { status: 'limit' };
        if (identities.has(change.parameter.id) || change.parameter.version !== 1 || !isProcedureParameter(change.parameter)) return { status: 'invalid' };
        if (change.parameter.stepId !== null && !procedure.steps.some(step => step.id === change.parameter.stepId)) return { status: 'missing' };
        parameters.push(change.parameter);
      } else {
        const offset = parameters.findIndex(item => item.id === change.parameterId);
        if (offset < 0) return { status: 'missing' };
        const parameter = parameters[offset];
        if (parameter.version !== change.expectedVersion) return { status: 'stale' };
        if (change.type === 'removeParameter') parameters.splice(offset, 1);
        else {
          const updated = { ...parameter, ...change.patch, version: parameter.version + 1 };
          if (!isProcedureParameter(updated)) return { status: 'invalid' };
          if (updated.stepId !== null && !procedure.steps.some(step => step.id === updated.stepId)) return { status: 'missing' };
          parameters[offset] = updated;
        }
      }
      next = { ...procedure, parameters }; break;
    }
    case 'addMaterial':
    case 'removeMaterial':
    case 'editMaterial':
    case 'moveMaterial': {
      const all = materialItems(procedure.materials);
      if (change.type === 'addMaterial') {
        if (all.length >= workspaceLimits.materials) return { status: 'limit' };
        if (!validId(change.materialId) || identities.has(change.materialId)) return { status: 'invalid' };
      } else if (!all.some(item => item.id === change.materialId)) return { status: 'missing' };
      if (change.type === 'addMaterial' && change.parentId && !all.some(item => item.id === change.parentId)) return { status: 'missing' };
      let tooDeep = false, invalid = false;
      const update = (items: NotebookMaterial[], parentId?: string, depth = 1): NotebookMaterial[] => {
        if (change.type === 'addMaterial' && change.parentId === parentId) {
          if (depth > workspaceLimits.materialDepth) { tooDeep = true; return items; }
          return [...items, { id: change.materialId, name: '', quantity: '' }];
        }
        const next = items.flatMap(item => {
          if (item.id === change.materialId) {
            if (change.type === 'removeMaterial') return [];
            if (change.type === 'editMaterial') {
              const updated = { ...item, ...change.patch };
              if (!validText(updated.name, workspaceLimits.label) || !validText(updated.quantity, workspaceLimits.label)) invalid = true;
              return [updated];
            }
          }
          return [{ ...item, ...(item.children || (change.type === 'addMaterial' && change.parentId === item.id)
            ? { children: update(item.children ?? [], item.id, depth + 1) } : {}) }];
        });
        if (change.type === 'moveMaterial') {
          const index = next.findIndex(item => item.id === change.materialId), target = index + change.direction;
          if (index >= 0 && target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]];
        }
        return next;
      };
      const materials = update(procedure.materials);
      if (tooDeep) return { status: 'limit' };
      if (invalid) return { status: 'invalid' };
      next = { ...procedure, materials };
      break;
    }
    case 'addStep': {
      if (procedure.steps.length >= workspaceLimits.steps) return { status: 'limit' };
      if (!validId(change.stepId) || identities.has(change.stepId)) return { status: 'invalid' };
      next = { ...procedure, steps: [...procedure.steps, { id: change.stepId, ...(change.kind ? { kind: change.kind } : {}), text: '', level: 'step', critical: false, pause: false, minutes: null, completed: false }] };
      break;
    }
    case 'timer':
    case 'removeStep':
    case 'editStep':
    case 'moveStep': {
      const stepIndex = procedure.steps.findIndex(item => item.id === change.stepId);
      if (stepIndex < 0) return { status: 'missing' };
      const steps = [...procedure.steps];
      if (change.type === 'removeStep') steps.splice(stepIndex, 1);
      if (change.type === 'timer') {
        const step = steps[stepIndex], timer = step.timer ?? { elapsedMs: 0, startedAt: null };
        if (step.kind !== 'timer' || !Number.isSafeInteger(change.now) || change.now < 0) return { status: 'invalid' };
        const nextTimer = change.action === 'reset' ? { elapsedMs: 0, startedAt: null }
          : change.action === 'start' ? { ...timer, startedAt: timer.startedAt ?? change.now }
          : { elapsedMs: procedureElapsed(timer, change.now), startedAt: null };
        steps[stepIndex] = { ...step, timer: nextTimer };
      }
      if (change.type === 'editStep') {
        const step = { ...steps[stepIndex], ...change.patch };
        if ((step.kind !== undefined && !procedureKinds.includes(step.kind))
          || (step.timer !== undefined && (step.kind !== 'timer' || !Number.isSafeInteger(step.timer.elapsedMs) || step.timer.elapsedMs < 0 || (step.timer.startedAt !== null && (!Number.isSafeInteger(step.timer.startedAt) || step.timer.startedAt < 0))))
          || !validText(step.text, workspaceLimits.text) || !['step', 'section', 'substep'].includes(step.level)
          || typeof step.critical !== 'boolean' || typeof step.pause !== 'boolean' || typeof step.completed !== 'boolean'
          || (step.minutes !== null && (!Number.isFinite(step.minutes) || step.minutes < 0 || step.minutes > workspaceLimits.minutes))) return { status: 'invalid' };
        steps[stepIndex] = step;
      }
      if (change.type === 'moveStep') {
        const target = stepIndex + change.direction;
        if (target < 0 || target >= steps.length) return { status: 'ok', procedures };
        [steps[target], steps[stepIndex]] = [steps[stepIndex], steps[target]];
      }
      next = { ...procedure, steps };
      break;
    }
  }
  return { status: 'ok', procedures: procedures.map((item, offset) => offset === index ? next : item) };
}

export type MetadataChange = { type: 'project' | 'author'; value: string } | { type: 'addTag'; value: string } | { type: 'removeTag'; index: number };
export type MetadataResult = { status: 'ok'; metadata: NotebookMetadata } | { status: 'limit' | 'invalid' | 'duplicate' };
export function changeMetadata(metadata: NotebookMetadata, change: MetadataChange): MetadataResult {
  if (change.type === 'project' || change.type === 'author') {
    return validText(change.value, workspaceLimits.label) ? { status: 'ok', metadata: { ...metadata, [change.type]: change.value } } : { status: 'invalid' };
  }
  if (change.type === 'removeTag') return { status: 'ok', metadata: { ...metadata, tags: metadata.tags.filter((_, index) => index !== change.index) } };
  const value = change.value.trim();
  if (!value || !validText(value, workspaceLimits.tagLength)) return { status: 'invalid' };
  if (metadata.tags.includes(value)) return { status: 'duplicate' };
  if (metadata.tags.length >= workspaceLimits.tags) return { status: 'limit' };
  return { status: 'ok', metadata: { ...metadata, tags: [...metadata.tags, value] } };
}

export interface NotebookSearchItem {
  id: string;
  kind: string;
  label: string;
  text: string;
  depth: number;
  outline: boolean;
  procedureId?: string;
  ownerId?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const recordedTexts = (...values: unknown[]): string[] => values.flatMap(value =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? [String(value)] : []);
const quantityText = (value: unknown): string[] => {
  const quantity = asRecord(value);
  return quantity ? recordedTexts(quantity.value, quantity.unit) : [];
};
const recipeText = (value: unknown): string[] => {
  const recipe = asRecord(value);
  if (!recipe) return [];
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients.flatMap(ingredient => {
    const item = asRecord(ingredient);
    return item ? recordedTexts(item.reference, item.source, item.mode, ...quantityText(item.target)) : [];
  }) : [];
  return [...recordedTexts(recipe.name, recipe.output, recipe.notes, ...quantityText(recipe.target)), ...ingredients];
};
const elementText = (graph: unknown): string[] => {
  const atoms = asRecord(graph)?.atoms;
  return Array.isArray(atoms) ? atoms.flatMap(atom => recordedTexts(asRecord(atom)?.element)) : [];
};
/** Recorded labels and values for blocks whose content lives in attributes.
 * File bytes, structure coordinates and declaration digests stay out of search. */
function recordedBlockSearch(type: string, attrs: Record<string, unknown>): { label: string; text: string } | null {
  if (type === 'inputTable' || type === 'registrationTable') {
    const table = asRecord(attrs.table);
    const schema = asRecord(table?.schema);
    const columnList = schema && Array.isArray(schema.columns) ? schema.columns : [];
    const rowList = table && Array.isArray(table.rows) ? table.rows : [];
    const columns = columnList.flatMap(column => recordedTexts(asRecord(column)?.name));
    const cells = rowList.flatMap(row => {
      const values = asRecord(asRecord(row)?.cells);
      return values ? Object.values(values).flatMap(cell => recordedTexts(cell)) : [];
    });
    const receipts = Array.isArray(attrs.receipts) ? attrs.receipts.flatMap(receipt => {
      const item = asRecord(receipt), waiver = asRecord(item?.waiver);
      const records = Array.isArray(item?.records) ? item.records.flatMap(record => recordedTexts(asRecord(record)?.rowId, asRecord(record)?.recordId)) : [];
      return [...recordedTexts(waiver?.reason, waiver?.attribution), ...records];
    }) : [];
    const label = recordedTexts(table?.name)[0] ?? '';
    return { label, text: [label, ...columns, ...cells, ...receipts].join(' ') };
  }
  if (type === 'lookupTable') {
    const query = recordedTexts(asRecord(attrs.query)?.text);
    const snapshot = asRecord(attrs.snapshot);
    const records = snapshot && Array.isArray(snapshot.records) ? snapshot.records : [];
    const values = records.flatMap(record => {
      const item = asRecord(record), cells = asRecord(item?.values);
      const typed = cells ? Object.values(cells).flatMap(cell => recordedTexts(asRecord(cell)?.value, asRecord(cell)?.unit)) : [];
      return [...recordedTexts(item?.name, item?.id), ...typed];
    });
    const label = query[0] || values[0] || '';
    return { label, text: [...query, ...values].join(' ') };
  }
  if (type === 'mixturePrep') {
    const mixture = asRecord(attrs.mixture);
    const draft = recipeText(mixture?.draft);
    const saved = mixture && Array.isArray(mixture.recipes) ? mixture.recipes.flatMap(item => recipeText(asRecord(item)?.recipe)) : [];
    const prepared = mixture && Array.isArray(mixture.records) ? mixture.records.flatMap(item => {
      const row = asRecord(item), actual = asRecord(row?.actual);
      return [...recordedTexts(row?.operator, row?.notes, row?.output), ...recipeText(row?.recipe), ...(actual ? Object.values(actual).flatMap(quantityText) : [])];
    }) : [];
    const measurements = asRecord(mixture?.measurements);
    const measured = measurements ? Object.values(measurements).flatMap(quantityText) : [];
    const label = recordedTexts(attrs.label)[0] || draft[0] || '';
    return { label, text: [label, ...draft, ...saved, ...prepared, ...measured].join(' ') };
  }
  if (type === 'chemical') {
    const chemical = asRecord(attrs.chemical), source = asRecord(chemical?.source);
    const label = recordedTexts(chemical?.name)[0] ?? '';
    return { label, text: [label, ...elementText(chemical?.graph), ...recordedTexts(source?.moleculeId, source?.id)].join(' ') };
  }
  if (type === 'reactionScheme') {
    const reaction = asRecord(attrs.reaction);
    const molecules = reaction && Array.isArray(reaction.molecules) ? reaction.molecules.flatMap(molecule => {
      const item = asRecord(molecule);
      return item ? [...recordedTexts(item.name, item.role), ...elementText(item.graph)] : [];
    }) : [];
    const label = recordedTexts(reaction?.name)[0] ?? '';
    return { label, text: [label, ...recordedTexts(reaction?.notes), ...molecules].join(' ') };
  }
  if (type === 'sampleIntake') {
    const intake = asRecord(attrs.intake);
    const bindings = intake && Array.isArray(intake.bindings) ? intake.bindings.flatMap(binding => {
      const item = asRecord(binding), source = asRecord(item?.source), snapshot = asRecord(item?.snapshot);
      const records = snapshot && Array.isArray(snapshot.records) ? snapshot.records : [];
      return [...recordedTexts(source?.input, source?.well, source?.fileName), ...records.flatMap(record => recordedTexts(asRecord(record)?.name, asRecord(record)?.id))];
    }) : [];
    const label = recordedTexts(intake?.name)[0] ?? '';
    return { label, text: [label, ...recordedTexts(intake?.mode, intake?.field, intake?.input, intake?.fileName), ...bindings].join(' ') };
  }
  if (type === 'sourceExcerpt') {
    const excerpt = asRecord(attrs.excerpt), source = asRecord(excerpt?.source);
    const label = recordedTexts(attrs.label)[0] || recordedTexts(source?.filename)[0] || '';
    return { label, text: [label, ...recordedTexts(excerpt?.quote, excerpt?.text, source?.filename, source?.mime)].join(' ') };
  }
  if (type === 'savedSearch') {
    const snapshot = asRecord(attrs.snapshot);
    const results = snapshot && Array.isArray(snapshot.results) ? snapshot.results : [];
    const found = results.flatMap(result => {
      const item = asRecord(result);
      const tags = item && Array.isArray(item.tags) ? item.tags.flatMap(tag => recordedTexts(tag)) : [];
      return [...recordedTexts(item?.title, item?.summary, item?.entryId), ...tags];
    });
    const label = recordedTexts(attrs.label)[0] ?? '';
    return { label, text: [label, ...recordedTexts(attrs.queryId), ...found].join(' ') };
  }
  if (type === 'appCanvas') {
    const binding = asRecord(attrs.binding), inputs = asRecord(binding?.inputs);
    const label = recordedTexts(attrs.label)[0] ?? '';
    return { label, text: [label, ...recordedTexts(binding?.app, binding?.panel, binding?.view, binding?.id), ...(inputs ? Object.values(inputs).flatMap(value => recordedTexts(value)) : [])].join(' ') };
  }
  return null;
}

/** A projection of recorded content, never attachment bytes, coordinates or invented summaries. */
export function notebookSearchItems(content: NotebookNode, procedures: NotebookProcedure[] = []): NotebookSearchItem[] {
  const items: NotebookSearchItem[] = [];
  const inlineText = (node: NotebookNode): string => node.type === 'hardBreak' ? '\n'
    : node.type === 'referenceMention' ? [node.attrs?.label, ...Object.values((node.attrs?.source ?? {}) as ScientificReference)].join(' ')
    : node.text ?? (node.content ?? []).map(inlineText).join('');
  const visit = (node: NotebookNode, depth: number) => {
    const attrs = node.attrs ?? {}, id = attrs.blockId;
    const strings = (...values: unknown[]) => values.filter((value): value is string => typeof value === 'string').join(' ');
    let label = '', text = '', outline = false;
    if (['paragraph', 'heading', 'codeBlock'].includes(node.type)) {
      label = inlineText(node); text = label; outline = node.type === 'heading';
    } else if (node.type === 'section') {
      label = strings(attrs.label); text = strings(label, attrs.date); outline = true;
    } else if (node.type === 'spreadsheet') {
      label = strings(attrs.label); outline = true;
      const cells = (attrs.sheet as { cells: Record<string, string> }).cells;
      text = strings(label, ...Object.entries(cells).map(([address, value]) => `${address} ${value}`));
    } else if (node.type === 'evidence' || node.type === 'experiment') {
      const source = attrs.source as ScientificReference | null;
      label = strings(attrs.label) || source?.id || ''; outline = true;
      const snapshot = attrs.snapshot as { quote?: string; title?: string; verdict?: string } | null;
      text = strings(label, source?.app, source?.kind, source?.id, source?.version, source?.locator, snapshot?.quote, snapshot?.title, snapshot?.verdict);
    } else if (node.type === 'namedReference') {
      label = strings(attrs.name); text = strings(label, attrs.notes); outline = true;
    } else if (node.type === 'finding') {
      label = strings(attrs.claim); text = strings(label, attrs.limitations, ...(attrs.evidenceIds as string[] ?? [])); outline = true;
    } else if (node.type === 'attachment') {
      label = strings(attrs.filename); text = strings(label, attrs.caption, attrs.mime, attrs.sha256); outline = true;
    } else {
      const recorded = recordedBlockSearch(node.type, attrs);
      if (recorded) { label = recorded.label; text = recorded.text; outline = true; }
    }
    if (typeof id === 'string' && (text || outline)) items.push({ id, kind: node.type, label, text, depth, outline });
    for (const child of node.content ?? []) visit(child, depth + (node.type === 'section' ? 1 : 0));
  };
  visit(content, 0);
  for (const procedure of procedures) {
    const start = items.length;
    items.push({ id: procedure.id, kind: 'procedure', label: procedure.title, text: `${procedure.title} ${procedure.introduction ? '' : procedure.description}`, depth: 0, outline: true });
    for (const parameter of procedure.parameters ?? []) items.push({ id: parameter.id, kind: 'parameter', label: parameter.name || parameter.id, text: JSON.stringify(parameter), depth: 1, outline: false, ownerId: parameter.id });
    const rich = (node: NotebookNode | undefined, ownerId: string, depth: number) => {
      if (!node) return;
      const offset = items.length; visit(node, depth);
      for (const item of items.slice(offset)) item.ownerId = ownerId;
    };
    rich(procedure.introduction, procedure.id, 1);
    const materials = (values: NotebookMaterial[], depth: number) => { for (const item of values) {
      items.push({ id: item.id, kind: 'material', label: item.name, text: [item.name, item.quantity, ...Object.values(item.source ?? {})].join(' '), depth, outline: true });
      rich(item.content, item.id, depth + 1); materials(item.children ?? [], depth + 1);
    } };
    materials(procedure.materials, 1);
    for (const step of procedure.steps) {
      items.push({ id: step.id, kind: 'step', label: step.text || step.kind || 'Step', text: step.content ? '' : step.text, depth: 1, outline: true });
      rich(step.content, step.id, 2);
    }
    for (const item of items.slice(start)) item.procedureId = procedure.id;
  }
  return items;
}

export function searchNotebook(items: NotebookSearchItem[], query: string): NotebookSearchItem[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return terms.length ? items.filter(item => terms.every(term => item.text.toLocaleLowerCase().includes(term))) : items.filter(item => item.outline);
}

export interface NotebookRelevantItem {
  id: string;
  kind: 'evidence' | 'experiment' | 'attachment' | 'namedReference';
  notes?: string;
  label: string;
  state: ScientificReferenceState | 'embedded' | 'authored';
  imported: boolean;
  source: ScientificReference | null;
}

export function notebookRelevantItems(content: NotebookNode): NotebookRelevantItem[] {
  const items: NotebookRelevantItem[] = [];
  const visit = (node: NotebookNode) => {
    const attrs = node.attrs ?? {};
    if (typeof attrs.blockId === 'string') {
      if (node.type === 'evidence' || node.type === 'experiment') {
        const source = attrs.source as ScientificReference | null;
        items.push({ id: attrs.blockId, kind: node.type, label: String(attrs.label || source?.id || ''), source,
          state: scientificReferenceState(source), imported: !!attrs.snapshot });
      } else if (node.type === 'namedReference') {
        items.push({ id: attrs.blockId, kind: 'namedReference', label: String(attrs.name), notes: String(attrs.notes), state: 'authored', imported: false, source: null });
      } else if (node.type === 'attachment') {
        items.push({ id: attrs.blockId, kind: 'attachment', label: String(attrs.filename || ''), state: 'embedded', imported: false, source: null });
      }
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(content);
  return items;
}

/** A readable snapshot, not a round-trip replacement for the complete JSON format. */
export function notebookMarkdown(document: NotebookDocument): string {
  const escape = (value: unknown) => String(value ?? '').replace(/([\\`*_\[\]<>])/g, '\\$1');
  const code = (value: unknown) => {
    const text = String(value ?? '');
    const fence = '`'.repeat(Math.max(0, ...[...text.matchAll(/`+/g)].map(match => match[0].length)) + 1);
    return `${fence} ${text} ${fence}`;
  };
  const fenced = (value: string, language = '') => {
    const fence = '`'.repeat(Math.max(2, ...[...value.matchAll(/`+/g)].map(match => match[0].length)) + 1);
    return `${fence}${language}\n${value}\n${fence}`;
  };
  const table = (rows: string[][]) => rows.map((row, index) => {
    const line = `| ${row.map(value => value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')).join(' | ')} |`;
    return index === 0 ? `${line}\n| ${row.map(() => '---').join(' | ')} |` : line;
  }).join('\n');
  const render = (node: NotebookNode): string => {
    const attrs = node.attrs ?? {};
    if (node.type === 'referenceMention') {
      const source = attrs.source as ScientificReference;
      return `${escape(attrs.label)} (${Object.entries(source).map(([key, value]) => `${key}: ${code(value)}`).join('; ')})`;
    }
    if (node.type === 'text') {
      let text = escape(node.text);
      for (const mark of node.marks ?? []) {
        if (mark.type === 'code') text = code(node.text);
        if (mark.type === 'bold') text = `**${text}**`;
        if (mark.type === 'italic') text = `*${text}*`;
        if (mark.type === 'strike') text = `~~${text}~~`;
        if (mark.type === 'link') text = `[${text}](${String(mark.attrs?.href ?? '').replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
      }
      return text;
    }
    const children = node.content ?? [];
    const blocks = () => children.map(render).join('\n\n');
    switch (node.type) {
      case 'namedReference': return `**${escape(attrs.name)}** (entry reference)\n\n${escape(attrs.notes)}`;
      case 'doc': return blocks();
      case 'hardBreak': return '  \n';
      case 'paragraph': return children.map(render).join('');
      case 'heading': return `${'#'.repeat(Number(attrs.level) || 2)} ${children.map(render).join('')}`;
      case 'codeBlock': return fenced(children.map(child => child.text ?? '').join(''), String(attrs.language ?? ''));
      case 'horizontalRule': return '---';
      case 'blockquote': return blocks().split('\n').map(line => `> ${line}`).join('\n');
      case 'bulletList':
      case 'orderedList':
      case 'taskList': return children.map((child, index) => {
        const marker = node.type === 'orderedList' ? `${Number(attrs.start ?? 1) + index}. `
          : node.type === 'taskList' ? `- [${child.attrs?.checked ? 'x' : ' '}] ` : '- ';
        return marker + render(child).replace(/\n/g, `\n${' '.repeat(marker.length)}`);
      }).join('\n');
      case 'listItem': case 'taskItem': return blocks();
      case 'section': return `## ${escape(attrs.label)}${attrs.date ? ` (${escape(attrs.date)})` : ''}\n\n${blocks()}`;
      case 'spreadsheet': {
        const sheet = attrs.sheet as { rows: number; columns: number; cells: Record<string, string> };
        const columnName = (index: number) => index < 26 ? String.fromCharCode(65 + index) : `A${String.fromCharCode(65 + index - 26)}`;
        const rows = [['', ...Array.from({ length: sheet.columns }, (_, index) => columnName(index))],
          ...Array.from({ length: sheet.rows }, (_, row) => [String(row + 1), ...Array.from({ length: sheet.columns }, (_, column) => code(sheet.cells[`${columnName(column)}${row + 1}`] ?? ''))])];
        const annotations = attrs.annotations as Record<string, unknown> | undefined;
        return `### ${escape(attrs.label || 'Spreadsheet')}\n\nRaw cell inputs (including formulas):\n\n${table(rows)}${annotations && Object.keys(annotations).length ? `\n\nCell annotations:\n\n${fenced(JSON.stringify(annotations, null, 2), 'json')}` : ''}`;
      }
      case 'evidence': case 'experiment': {
        const source = attrs.source as ScientificReference | null;
        const identity = source ? Object.entries(source).map(([key, value]) => `- ${key}: ${code(value)}`).join('\n') : 'No source reference.';
        return `### ${escape(attrs.label || node.type)}\n\nBlock ID: ${code(attrs.blockId)}\n\n${identity}${attrs.snapshot ? `\n\nRecorded source snapshot (not live verification):\n\n${fenced(JSON.stringify(attrs.snapshot, null, 2), 'json')}` : ''}`;
      }
      case 'finding': return `### Finding\n\n${escape(attrs.claim)}\n\nLimitations: ${escape(attrs.limitations)}\n\nEvidence block IDs: ${(attrs.evidenceIds as string[]).map(code).join(', ')}`;
      case 'attachment': return `### ${escape(attrs.filename)}\n\n${escape(attrs.caption)}\n\n- MIME: ${code(attrs.mime)}\n- SHA-256: ${code(attrs.sha256)}\n- Block ID: ${code(attrs.blockId)}\n\nFile bytes are included in the JSON snapshot, not this Markdown export.`;
      default: return `### ${escape(node.type)}\n\n${fenced(JSON.stringify(attrs, null, 2), 'json')}${children.length ? `\n\n${blocks()}` : ''}`;
    }
  };
  const renderMaterials = (materials: NotebookMaterial[], depth = 0): string => materials.map(item => {
    const source = item.source ? ` (Local catalog ${code(item.source.catalogId)}, record ${code(item.source.recordId)} v${item.source.version}, schema ${code(item.source.schemaId)} v${item.source.schemaRevision})` : '';
    return `${'  '.repeat(depth)}- ${escape(item.name)}: ${escape(item.quantity)}${source}${item.content ? `\n${render(item.content).split('\n').map(line => `${'  '.repeat(depth + 1)}${line}`).join('\n')}` : ''}${item.children?.length ? `\n${renderMaterials(item.children, depth + 1)}` : ''}`;
  }).join('\n');
  const parts = [`# ${escape(document.title)}`, render(document.content)];
  if (document.metadata) parts.push(`## Metadata\n\nDisplay labels only; not project membership or verified authorship.\n\n- Project: ${escape(document.metadata.project)}\n- Author: ${escape(document.metadata.author)}\n- Tags: ${document.metadata.tags.map(escape).join(', ')}`);
  for (const procedure of document.procedures ?? []) {
    const steps = procedure.steps.map((step, index) => `${index + 1}. [${step.completed ? 'x' : ' '}] ${step.content ? render(step.content) : escape(step.text)}\n   Kind: ${step.kind ?? 'step'}; recorded elapsed milliseconds: ${step.timer?.elapsedMs ?? 0}; running since: ${step.timer?.startedAt ?? 'stopped'};\n   Level: ${step.level}; critical: ${step.critical}; pause: ${step.pause}; planned minutes: ${step.minutes ?? 'unset'}.`).join('\n');
    const parameters = procedure.parameters?.length ? `\n\n### Parameters and step outputs\n\nRecorded draft inputs and version pins, not execution receipts.\n\n${fenced(JSON.stringify(procedure.parameters, null, 2), 'json')}` : '';
    parts.push(`## ${escape(procedure.title)}\n\n${procedure.introduction ? render(procedure.introduction) : escape(procedure.description)}${parameters}\n\n### Materials\n\n${renderMaterials(procedure.materials)}\n\n### Steps\n\nManual completion and annotations, not execution receipts.\n\n${steps}`);
  }
  return `${parts.join('\n\n').trim()}\n`;
}

/** Same-document navigation is view state only; it never rewrites or saves a draft. */
export function notebookLinkHash(entryId: string, targetId: string): string {
  return `#${new URLSearchParams({ 'notebook-entry': entryId, 'notebook-target': targetId })}`;
}
export function parseNotebookLink(hash: string): { entryId: string; targetId: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const entryId = params.get('notebook-entry'), targetId = params.get('notebook-target');
  if (!entryId || !validId(entryId)) return null;
  // Entry-only hashes open the notebook; block targets remain optional view state.
  if (!targetId) return { entryId, targetId: '' };
  return validId(targetId) ? { entryId, targetId } : null;
}
export function notebookTarget(document: NotebookDocument, id: string): { tab: 'notes' | 'procedures'; procedureId?: string; ownerId: string } | null {
  const contains = (node: NotebookNode): boolean => node.attrs?.blockId === id || (node.content ?? []).some(contains);
  if (contains(document.content)) return { tab: 'notes', ownerId: id };
  for (const procedure of document.procedures ?? []) {
    if (procedure.parameters?.some(parameter => parameter.id === id)) return { tab: 'procedures', procedureId: procedure.id, ownerId: id };
    if (procedure.id === id || (procedure.introduction && contains(procedure.introduction))) return { tab: 'procedures', procedureId: procedure.id, ownerId: procedure.id };
    for (const item of [...materialItems(procedure.materials), ...procedure.steps]) if (item.id === id || (item.content && contains(item.content))) return { tab: 'procedures', procedureId: procedure.id, ownerId: item.id };
  }
  return null;
}
