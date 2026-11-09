import type { NotebookDocument, NotebookNode } from './document.ts';
import { notebookContentRoots } from './workspace.ts';
import { canonicalStructuredTable, isStructuredColumn, parseTypedCell, validateStructuredColumn, type StructuredColumn, type StructuredTableDraft, type TypedCell } from './structured-table.ts';
import { evaluateWorkbook, formulaFunctions, isExternalFormula } from './spreadsheet.ts';
import { inspectFormulaSyntax } from './formula-syntax.ts';
import type { FormulaSourceNode } from './formula-source-ast.ts';

/** Method inputs and recorded step outputs are local draft data, not execution results.
 * Table bindings pin one exact field and raw value, not its visual row position.
 * Formula slots explicitly pin parameter versions; quantity magnitudes require an
 * exact unit, with no implicit conversion. Only the existing spreadsheet owner calculates.
 */
export const procedureParameterLimits = { parameters: 100, bindings: 25, expression: 4096, depth: 128 } as const;
export interface ProcedureFieldBinding {
  kind: 'table'; blockId: string; tableId: string; rowId: string; columnId: string;
  schemaId: string; schemaRevision: number;
  /** Saved base revision when selected; raw may include unsaved draft edits. */
  observedRevision: number;
  column: StructuredColumn; raw: string;
}
export interface ProcedureParameterReference {
  procedureId: string; parameterId: string; version: number;
  /** Empty for scalar values; exact expected unit when reading a quantity magnitude. */
  unit: string;
}
export interface ProcedureFormula {
  kind: 'formula'; expression: string; bindings: ProcedureParameterReference[];
  /** Explicit result unit, empty for non-quantity output. */
  unit: string;
}
export type ProcedureParameterSource = { kind: 'literal'; raw: string } | ProcedureFieldBinding | ProcedureFormula;
export interface ProcedureParameter extends StructuredColumn {
  version: number; stepId: string | null; source: ProcedureParameterSource;
}
export interface ProcedureFieldChoice { blockId: string; table: StructuredTableDraft; rowId: string; column: StructuredColumn; raw: string }
export type ProcedureParameterFailure = 'missing' | 'stale' | 'ambiguous' | 'cycle' | 'invalid' | 'type' | 'unsupported' | 'limit';
export type ProcedureParameterResult = { status: 'ok'; value: TypedCell } | { status: ProcedureParameterFailure; detail: string };
const fail = (status: ProcedureParameterFailure, detail: string): ProcedureParameterResult => ({ status, detail });
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2147483647;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && [...value].length <= max;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function parameterColumn(parameter: StructuredColumn): StructuredColumn {
  const { id, name, type, required, options, units } = parameter;
  return { id, name, type, required, options, units };
}
/** Storage validation allows unfinished values/formulas, but never malformed references. */
export function isProcedureParameter(value: unknown): value is ProcedureParameter {
  if (!object(value) || !fields(value, ['id', 'name', 'type', 'required', 'options', 'units', 'version', 'stepId', 'source']) ||
    !isStructuredColumn(parameterColumn(value as unknown as StructuredColumn)) || !integer(value.version) || !(value.stepId === null || id(value.stepId))) return false;
  const source = value.source;
  if (!object(source)) return false;
  if (source.kind === 'literal') return fields(source, ['kind', 'raw']) && text(source.raw, 4096);
  if (source.kind === 'table') return fields(source, ['kind', 'blockId', 'tableId', 'rowId', 'columnId', 'schemaId', 'schemaRevision', 'observedRevision', 'column', 'raw']) &&
    ['blockId', 'tableId', 'rowId', 'columnId', 'schemaId'].every(key => id(source[key])) && integer(source.schemaRevision) && integer(source.observedRevision) &&
    isStructuredColumn(source.column) && source.column.id === source.columnId && text(source.raw, 4096);
  return source.kind === 'formula' && fields(source, ['kind', 'expression', 'bindings', 'unit']) && text(source.expression, 4096) && text(source.unit, 200) &&
    Array.isArray(source.bindings) && source.bindings.length <= procedureParameterLimits.bindings && source.bindings.every(binding => object(binding) &&
      fields(binding, ['procedureId', 'parameterId', 'version', 'unit']) && id(binding.procedureId) && id(binding.parameterId) && integer(binding.version) && text(binding.unit, 200));
}

export function procedureFieldChoices(document: NotebookDocument): ProcedureFieldChoice[] {
  const choices: ProcedureFieldChoice[] = [];
  const visit = (node: NotebookNode) => {
    if (['inputTable', 'registrationTable'].includes(node.type) && typeof node.attrs?.blockId === 'string') {
      const table = node.attrs.table as StructuredTableDraft;
      for (const row of table.rows) for (const column of table.schema.columns) choices.push({ blockId: node.attrs.blockId, table, rowId: row.id, column, raw: row.cells[column.id] ?? '' });
    }
    for (const child of node.content ?? []) visit(child);
  };
  notebookContentRoots(document).forEach(visit);
  return choices;
}
export function pinProcedureField(choice: ProcedureFieldChoice, observedRevision: number): ProcedureFieldBinding {
  return { kind: 'table', blockId: choice.blockId, tableId: choice.table.id, rowId: choice.rowId, columnId: choice.column.id,
    schemaId: choice.table.schema.id, schemaRevision: choice.table.schema.revision, observedRevision, column: structuredClone(choice.column), raw: choice.raw };
}

function typedResult(parameter: ProcedureParameter, raw: string): ProcedureParameterResult {
  if (raw.length > 8192 || !text(raw, 4096)) return fail('limit', 'valueLength');
  if (validateStructuredColumn(parameter).length) return fail('invalid', 'columnRules');
  const parsed = parseTypedCell(parameter, raw);
  return 'error' in parsed ? fail('invalid', parsed.error) : parsed.value.type === 'missing' ? fail('missing', 'value') : { status: 'ok', value: parsed.value };
}
function sameColumn(left: StructuredColumn, right: StructuredColumn): boolean {
  // The table owner's canonical serializer handles property order without a second hash protocol.
  const wrap = (column: StructuredColumn): StructuredTableDraft => ({ id: 'snapshot', name: '', schema: { id: 'schema', revision: 1, columns: [column] }, rows: [] });
  return canonicalStructuredTable(wrap(left)) === canonicalStructuredTable(wrap(right));
}
export function sameProcedureFieldSnapshot(binding: ProcedureFieldBinding, choice: ProcedureFieldChoice): boolean {
  return binding.blockId === choice.blockId && binding.tableId === choice.table.id && binding.rowId === choice.rowId && binding.columnId === choice.column.id
    && choice.table.schema.id === binding.schemaId && choice.table.schema.revision === binding.schemaRevision && sameColumn(choice.column, binding.column) && choice.raw === binding.raw;
}
function formulaReferences(root: FormulaSourceNode, count: number): boolean {
  switch (root.kind) {
    case 'literal': return true;
    case 'reference': { const match = /^\$?A\$?([1-9]\d*)$/i.exec(root.text); return !!match && Number(match[1]) <= count; }
    case 'qualified': case 'intersection': case 'union': return false;
    case 'unary': case 'postfix': return formulaReferences(root.operand, count);
    case 'binary': case 'range': return formulaReferences(root.left, count) && formulaReferences(root.right, count);
    case 'group': return formulaReferences(root.expression, count);
    case 'array': return root.rows.every(row => row.every(item => formulaReferences(item, count)));
    case 'call': return formulaFunctions.some(name => name === root.name.toUpperCase()) && root.arguments.every(item => !item || formulaReferences(item, count));
  }
}
/** One resolver per shown document caches graph results. Reorder/rename never rewires
 * references. Deleted owners, duplicate IDs and changed inputs are visible errors.
 * Cycles take precedence over stale pins; all declared slots are dependencies,
 * including slots in an unselected IF branch. Errors cannot be hidden with IFERROR.
 */
export function procedureParameterResolver(document: NotebookDocument): (procedureId: string, parameterId: string) => ProcedureParameterResult {
  const choices = procedureFieldChoices(document), cache = new Map<string, ProcedureParameterResult>(), active = new Set<string>();
  const resolve = (procedureId: string, parameterId: string): ProcedureParameterResult => {
    const key = `${procedureId}/${parameterId}`;
    if (active.has(key)) return fail('cycle', key);
    const cached = cache.get(key); if (cached) return cached;
    if (active.size >= procedureParameterLimits.depth) return fail('limit', 'dependencyDepth');
    const procedures = (document.procedures ?? []).filter(item => item.id === procedureId);
    if (procedures.length !== 1) return fail(procedures.length ? 'ambiguous' : 'missing', 'procedure');
    const procedure = procedures[0], parameters = (procedure.parameters ?? []).filter(item => item.id === parameterId);
    if (parameters.length !== 1) return fail(parameters.length ? 'ambiguous' : 'missing', 'parameter');
    const parameter = parameters[0];
    if (parameter.stepId !== null) {
      const steps = procedure.steps.filter(step => step.id === parameter.stepId);
      if (steps.length !== 1) return fail(steps.length ? 'ambiguous' : 'missing', 'step');
    }
    active.add(key);
    const result = calculate(parameter);
    active.delete(key); cache.set(key, result); return result;
  };
  const calculate = (parameter: ProcedureParameter): ProcedureParameterResult => {
    const source = parameter.source;
    if (source.kind === 'literal') return typedResult(parameter, source.raw);
    if (source.kind === 'table') {
      const matching = choices.filter(choice => choice.blockId === source.blockId && choice.table.id === source.tableId && choice.rowId === source.rowId && choice.column.id === source.columnId);
      if (matching.length !== 1) return fail(matching.length ? 'ambiguous' : 'missing', 'field');
      const choice = matching[0];
      if (!sameProcedureFieldSnapshot(source, choice)) return fail('stale', 'fieldSnapshot');
      if (choice.column.type !== parameter.type || validateStructuredColumn(choice.column).length) return fail('type', 'fieldType');
      const ownerValue = parseTypedCell(choice.column, choice.raw);
      if ('error' in ownerValue) return fail('invalid', ownerValue.error);
      return typedResult(parameter, source.raw);
    }
    const dependencies = source.bindings.map(binding => resolve(binding.procedureId, binding.parameterId));
    const cycle = dependencies.find(item => item.status === 'cycle'); if (cycle) return cycle;
    for (let index = 0; index < dependencies.length; index++) {
      const result = dependencies[index], binding = source.bindings[index];
      if (result.status !== 'ok') return result;
      const target = document.procedures!.find(item => item.id === binding.procedureId)!.parameters!.find(item => item.id === binding.parameterId)!;
      if (target.version !== binding.version) return fail('stale', `A${index + 1}`);
    }
    const syntax = inspectFormulaSyntax(source.expression);
    if (isExternalFormula(source.expression) || syntax.sourceAst.status === 'unsupported') return fail('unsupported', 'formula');
    if (syntax.sourceAst.status !== 'supported' || syntax.error) return fail('invalid', 'formula');
    if (!formulaReferences(syntax.sourceAst.root, source.bindings.length)) return fail('unsupported', 'formulaReferences');
    const cells: Record<string, string> = { B1: source.expression };
    for (let index = 0; index < dependencies.length; index++) {
      const result = dependencies[index]; if (result.status !== 'ok') return result;
      const value = result.value, unit = source.bindings[index].unit;
      if (value.type === 'missing') return fail('missing', `A${index + 1}`);
      if (value.type === 'object' || (value.type === 'quantity' ? value.unit !== unit : !!unit)) return fail('type', `A${index + 1}`);
      cells[`A${index + 1}`] = value.type === 'text' || value.type === 'date' ? `'${value.value}` : String(value.value);
    }
    let engineError = false;
    const calculated = evaluateWorkbook([{ name: 'Parameters', sheet: { rows: Math.max(1, dependencies.length), columns: 2, cells } }], {
      result(source, _value, error) { if (source.address === 'B1') engineError = error; },
    }).Parameters.B1;
    if (engineError) return fail('invalid', String(calculated));
    if ((parameter.type === 'quantity' || parameter.type === 'decimal') && typeof calculated !== 'number' || parameter.type === 'boolean' && typeof calculated !== 'boolean'
      || (parameter.type === 'text' || parameter.type === 'date') && typeof calculated !== 'string' || parameter.type === 'object' || parameter.type === 'missing') return fail('type', 'formulaResult');
    if (parameter.type !== 'quantity' && source.unit) return fail('type', 'resultUnit');
    return typedResult(parameter, parameter.type === 'quantity' ? `${calculated} ${source.unit}` : String(calculated));
  };
  return resolve;
}

/** Copy integration calls this before/after remapping the owning procedure IDs.
 * Only map identities actually included in the copy. Uncopied references retain
 * their original identity and resolve as missing if unavailable; never retarget
 * by a display name or row offset.
 */
export function copyProcedureParameters(parameters: readonly ProcedureParameter[], idMap: Readonly<Record<string, string>>): ProcedureParameter[] {
  const remap = (id: string) => idMap[id] ?? id;
  return parameters.map(parameter => ({ ...structuredClone(parameter), id: remap(parameter.id), stepId: parameter.stepId === null ? null : remap(parameter.stepId),
    source: parameter.source.kind === 'table' ? { ...structuredClone(parameter.source), blockId: remap(parameter.source.blockId), tableId: remap(parameter.source.tableId), rowId: remap(parameter.source.rowId) }
      : parameter.source.kind === 'formula' ? { ...parameter.source, bindings: parameter.source.bindings.map(binding => ({ ...binding, procedureId: remap(binding.procedureId), parameterId: remap(binding.parameterId) })) }
      : { ...parameter.source } }));
}
