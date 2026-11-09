import { scientificReferenceState, type NotebookDocument, type NotebookNode, type ScientificReference, type ScientificReferenceState } from './document.ts';

/** Display labels only. These do not grant project membership or verify authorship. */
export interface NotebookMetadata {
  project: string;
  author: string;
  tags: string[];
}

export interface NotebookMaterial { id: string; name: string; quantity: string }
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
  materials: NotebookMaterial[];
  steps: NotebookProcedureStep[];
}

export const workspaceLimits = {
  label: 200, tags: 50, tagLength: 100, procedures: 50, materials: 100,
  steps: 500, text: 32768, minutes: 10080,
} as const;

export type ProcedureChange =
  | { type: 'add'; id: string; title: string }
  | { type: 'remove'; id: string }
  | { type: 'edit'; id: string; patch: Partial<Pick<NotebookProcedure, 'title' | 'description'>> }
  | { type: 'addMaterial'; id: string; materialId: string }
  | { type: 'removeMaterial'; id: string; materialId: string }
  | { type: 'editMaterial'; id: string; materialId: string; patch: Partial<Pick<NotebookMaterial, 'name' | 'quantity'>> }
  | { type: 'addStep'; id: string; stepId: string; kind?: ProcedureKind }
  | { type: 'timer'; id: string; stepId: string; action: 'start' | 'pause' | 'reset'; now: number }
  | { type: 'removeStep'; id: string; stepId: string }
  | { type: 'editStep'; id: string; stepId: string; patch: Partial<Omit<NotebookProcedureStep, 'id'>> }
  | { type: 'moveStep'; id: string; stepId: string; direction: -1 | 1 };
export type ProcedureResult = { status: 'ok'; procedures: NotebookProcedure[] } | { status: 'limit' | 'invalid' | 'missing' };

const validId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id);
const validText = (text: string, limit: number) => [...text].length <= limit;

/** Typed local authoring transitions. Wire validation belongs to the storage boundary. */
export function changeProcedures(procedures: NotebookProcedure[], change: ProcedureChange): ProcedureResult {
  if (change.type === 'add') {
    if (procedures.length >= workspaceLimits.procedures) return { status: 'limit' };
    if (!validId(change.id) || procedures.some(item => item.id === change.id) || !validText(change.title, workspaceLimits.label)) return { status: 'invalid' };
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
    case 'addMaterial': {
      if (procedure.materials.length >= workspaceLimits.materials) return { status: 'limit' };
      if (!validId(change.materialId) || [...procedure.materials, ...procedure.steps].some(item => item.id === change.materialId)) return { status: 'invalid' };
      next = { ...procedure, materials: [...procedure.materials, { id: change.materialId, name: '', quantity: '' }] };
      break;
    }
    case 'removeMaterial':
    case 'editMaterial': {
      if (!procedure.materials.some(item => item.id === change.materialId)) return { status: 'missing' };
      const materials = change.type === 'removeMaterial' ? procedure.materials.filter(item => item.id !== change.materialId)
        : procedure.materials.map(item => item.id === change.materialId ? { ...item, ...change.patch } : item);
      if (materials.some(item => !validText(item.name, workspaceLimits.label) || !validText(item.quantity, workspaceLimits.label))) return { status: 'invalid' };
      next = { ...procedure, materials };
      break;
    }
    case 'addStep': {
      if (procedure.steps.length >= workspaceLimits.steps) return { status: 'limit' };
      if (!validId(change.stepId) || [...procedure.materials, ...procedure.steps].some(item => item.id === change.stepId)) return { status: 'invalid' };
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
}

/** A projection of recorded content, never attachment bytes or invented summaries. */
export function notebookSearchItems(content: NotebookNode): NotebookSearchItem[] {
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
    } else if (node.type === 'finding') {
      label = strings(attrs.claim); text = strings(label, attrs.limitations, ...(attrs.evidenceIds as string[] ?? [])); outline = true;
    } else if (node.type === 'attachment') {
      label = strings(attrs.filename); text = strings(label, attrs.caption, attrs.mime, attrs.sha256); outline = true;
    }
    if (typeof id === 'string' && (text || outline)) items.push({ id, kind: node.type, label, text, depth, outline });
    for (const child of node.content ?? []) visit(child, depth + (node.type === 'section' ? 1 : 0));
  };
  visit(content, 0);
  return items;
}

export function searchNotebook(items: NotebookSearchItem[], query: string): NotebookSearchItem[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return terms.length ? items.filter(item => terms.every(term => item.text.toLocaleLowerCase().includes(term))) : items.filter(item => item.outline);
}

export interface NotebookRelevantItem {
  id: string;
  kind: 'evidence' | 'experiment' | 'attachment';
  label: string;
  state: ScientificReferenceState | 'embedded';
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
  const parts = [`# ${escape(document.title)}`, render(document.content)];
  if (document.metadata) parts.push(`## Metadata\n\nDisplay labels only; not project membership or verified authorship.\n\n- Project: ${escape(document.metadata.project)}\n- Author: ${escape(document.metadata.author)}\n- Tags: ${document.metadata.tags.map(escape).join(', ')}`);
  for (const procedure of document.procedures ?? []) {
    const steps = procedure.steps.map((step, index) => `${index + 1}. [${step.completed ? 'x' : ' '}] ${step.content ? render(step.content) : escape(step.text)}\n   Kind: ${step.kind ?? 'step'}; recorded elapsed milliseconds: ${step.timer?.elapsedMs ?? 0}; running since: ${step.timer?.startedAt ?? 'stopped'};\n   Level: ${step.level}; critical: ${step.critical}; pause: ${step.pause}; planned minutes: ${step.minutes ?? 'unset'}.`).join('\n');
    parts.push(`## ${escape(procedure.title)}\n\n${escape(procedure.description)}\n\n### Materials\n\n${table([['Material', 'Quantity'], ...procedure.materials.map(item => [escape(item.name), escape(item.quantity)])])}\n\n### Steps\n\nManual completion and annotations, not execution receipts.\n\n${steps}`);
  }
  return `${parts.join('\n\n').trim()}\n`;
}
