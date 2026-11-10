import assert from 'node:assert/strict';
import test from 'node:test';
import { changeProcedures, notebookMarkdown, notebookSearchItems, notebookTarget, searchNotebook, type NotebookProcedure } from '../src/workspace.ts';
import type { NotebookDocument } from '../src/document.ts';
import { copyProcedureParameters, isProcedureParameter, pinProcedureField, procedureFieldChoices, procedureParameterResolver, type ProcedureParameter, type ProcedureParameterReference } from '../src/procedure-parameters.ts';
import { instantiateTemplate, type PublishedTemplate } from '../src/templates.ts';
import type { StructuredTableDraft } from '../src/structured-table.ts';

const reference = (parameterId: string, version = 1, unit = ''): ProcedureParameterReference => ({ procedureId: 'method', parameterId, version, unit });
const parameter = (id: string, raw: string, patch: Partial<ProcedureParameter> = {}): ProcedureParameter => ({ id, name: id, type: 'decimal', required: true, options: [], units: [], stepId: null, version: 1, source: { kind: 'literal', raw }, ...patch });
const formula = (id: string, expression: string, bindings: ProcedureParameterReference[], patch: Partial<ProcedureParameter> = {}) => parameter(id, '', { source: { kind: 'formula', expression, bindings, unit: '' }, ...patch });
function fixture(): NotebookDocument {
  const table: StructuredTableDraft = { id: 'table', name: 'Amounts', schema: { id: 'schema', revision: 3, columns: [{ id: 'volume', name: 'Volume', type: 'quantity', required: true, options: [], units: ['mL', 'µL'] }] }, rows: [{ id: 'sample', cells: { volume: '2 mL' } }, { id: 'control', cells: { volume: '1 mL' } }] };
  const step = (id: string) => ({ id, text: id, level: 'step' as const, critical: false, pause: false, minutes: null, completed: false });
  const procedure: NotebookProcedure = { id: 'method', title: 'Dilution', description: '', materials: [], steps: [step('prepare'), step('dilute')], parameters: [parameter('factor', '3', { stepId: 'prepare' }), formula('total', '=A1*2', [reference('factor')], { stepId: 'dilute' })] };
  return { schemaVersion: 1, title: 'Method', content: { type: 'doc', content: [{ type: 'inputTable', attrs: { blockId: 'amounts', table, receipts: [] } }] }, procedures: [procedure] };
}
const resolve = (document: NotebookDocument, id: string) => procedureParameterResolver(document)('method', id);
const edit = (document: NotebookDocument, parameterId: string, patch: Partial<ProcedureParameter>, expectedVersion = 1) => {
  const changed = changeProcedures(document.procedures!, { type: 'editParameter', id: 'method', parameterId, expectedVersion, patch });
  assert.equal(changed.status, 'ok'); if (changed.status === 'ok') document.procedures = changed.procedures;
};

test('typed table bindings pin field identity/schema/raw snapshot and survive reorder, with explicit changed/missing/duplicate errors', () => {
  const document = fixture(), first = procedureFieldChoices(document)[0];
  const bound = parameter('volume-param', '', { type: 'quantity', units: ['mL'], source: pinProcedureField(first, 7) });
  document.procedures![0].parameters!.push(bound);
  const before = structuredClone(document);
  assert.deepEqual(resolve(document, bound.id), { status: 'ok', value: { type: 'quantity', value: '2', unit: 'mL' } });
  assert.deepEqual(document, before, 'resolving never rewrites the draft');
  first.table.rows.reverse(); document.procedures![0].steps.reverse();
  assert.equal(resolve(document, bound.id).status, 'ok');
  first.table.rows.find(row => row.id === 'sample')!.cells.volume = '4 mL';
  assert.equal(resolve(document, bound.id).status, 'stale'); assert.equal((bound.source as any).raw, '2 mL');
  bound.source = pinProcedureField(procedureFieldChoices(document).find(item => item.rowId === 'sample')!, 8);
  assert.deepEqual(resolve(document, bound.id), { status: 'ok', value: { type: 'quantity', value: '4', unit: 'mL' } });
  first.table.schema.revision++;
  assert.equal(resolve(document, bound.id).status, 'stale'); first.table.schema.revision--;
  first.table.schema.columns[0].name = 'Renamed without revision';
  assert.equal(resolve(document, bound.id).status, 'stale'); first.table.schema.columns[0].name = 'Volume';
  document.content.content.push(structuredClone(document.content.content[0]));
  assert.equal(resolve(document, bound.id).status, 'ambiguous'); document.content.content.pop();
  first.table.rows = first.table.rows.filter(row => row.id !== 'sample');
  assert.equal(resolve(document, bound.id).status, 'missing');
});

test('the existing formula owner computes stable cross-step dependencies, with type/unit guarding and no text-as-formula injection', () => {
  const document = fixture(), parameters = document.procedures![0].parameters!;
  assert.deepEqual(resolve(document, 'total'), { status: 'ok', value: { type: 'decimal', value: '6' } });
  document.procedures![0].steps.reverse(); parameters.reverse();
  assert.deepEqual(resolve(document, 'total'), { status: 'ok', value: { type: 'decimal', value: '6' } });
  parameters.push(parameter('amount', '2 mL', { type: 'quantity', units: ['mL'] }));
  parameters.push(formula('double', '=SUM(A1:A2)', [reference('amount', 1, 'mL'), reference('amount', 1, 'mL')], { type: 'quantity', units: ['mL'], source: { kind: 'formula', expression: '=SUM(A1:A2)', bindings: [reference('amount', 1, 'mL'), reference('amount', 1, 'mL')], unit: 'mL' } }));
  assert.deepEqual(resolve(document, 'double'), { status: 'ok', value: { type: 'quantity', value: '4', unit: 'mL' } });
  (parameters.find(item => item.id === 'double')!.source as any).bindings[0].unit = 'µL';
  assert.equal(resolve(document, 'double').status, 'type', 'never silently convert units');
  parameters.push(parameter('label', '=WEBSERVICE("https://invalid")', { type: 'text' }), formula('label-copy', '=A1', [reference('label')], { type: 'text' }));
  assert.deepEqual(resolve(document, 'label-copy'), { status: 'ok', value: { type: 'text', value: '=WEBSERVICE("https://invalid")' } });
  parameters.push(parameter('flag', 'false', { type: 'boolean' }), formula('negate', '=NOT(A1)', [reference('flag')], { type: 'boolean' }));
  assert.deepEqual(resolve(document, 'negate'), { status: 'ok', value: { type: 'boolean', value: true } });
  parameters.push(formula('wrong-type', '="12"', [])); assert.equal(resolve(document, 'wrong-type').status, 'type');
  parameters.push(parameter('long-text', 'x'.repeat(3000), { type: 'text' }), formula('too-long', '=CONCAT(A1,A1)', [reference('long-text')], { type: 'text' }));
  assert.equal(resolve(document, 'too-long').status, 'limit');
  parameters.push(parameter('missing-value', '', { required: false }), formula('cannot-mask', '=IFERROR(A1,0)', [reference('missing-value')]));
  assert.equal(resolve(document, 'cannot-mask').status, 'missing');
});

test('edits increment versions and dependent references stay stale until explicit repinning; deleting owners keeps missing references repairable', () => {
  const document = fixture(), old = structuredClone(document);
  edit(document, 'factor', { source: { kind: 'literal', raw: '4' } });
  assert.equal(document.procedures![0].parameters![0].version, 2);
  assert.equal(resolve(document, 'total').status, 'stale');
  assert.deepEqual(resolve(old, 'total'), { status: 'ok', value: { type: 'decimal', value: '6' } });
  assert.equal(changeProcedures(document.procedures!, { type: 'editParameter', id: 'method', parameterId: 'factor', expectedVersion: 1, patch: { name: 'late edit' } }).status, 'stale');
  edit(document, 'total', { source: { kind: 'formula', expression: '=A1*2', bindings: [reference('factor', 2)], unit: '' } });
  assert.deepEqual(resolve(document, 'total'), { status: 'ok', value: { type: 'decimal', value: '8' } });
  const removed = changeProcedures(document.procedures!, { type: 'removeStep', id: 'method', stepId: 'prepare' });
  assert.equal(removed.status, 'ok'); if (removed.status === 'ok') document.procedures = removed.procedures;
  assert.equal(resolve(document, 'factor').status, 'missing'); assert.equal(resolve(document, 'total').status, 'missing');
  edit(document, 'factor', { stepId: null }, 2);
  assert.equal(resolve(document, 'factor').status, 'ok'); assert.equal(resolve(document, 'total').status, 'stale');
  const result = changeProcedures(document.procedures!, { type: 'removeParameter', id: 'method', parameterId: 'factor', expectedVersion: 3 });
  if (result.status === 'ok') document.procedures = result.procedures;
  assert.equal(resolve(document, 'total').status, 'missing');
});

test('cycles, ambiguous identities, unsupported syntax/functions and dangling slots never fabricate a result', () => {
  const document = fixture(), parameters = document.procedures![0].parameters!;
  parameters.push(formula('a', '=IF(FALSE,A1,9)', [reference('b')]), formula('b', '=IFERROR(A1,0)', [reference('a', 99)]));
  assert.equal(resolve(document, 'a').status, 'cycle'); assert.equal(resolve(document, 'b').status, 'cycle');
  parameters.push(structuredClone(parameters[0])); assert.equal(resolve(document, 'factor').status, 'ambiguous'); parameters.pop();
  document.procedures!.push(structuredClone(document.procedures![0])); assert.equal(resolve(document, 'factor').status, 'ambiguous'); document.procedures!.pop();
  for (const expression of ['=B1', '=A2', "='Other'!A1", '=INDIRECT("A1")', '=WEBSERVICE("x")', '=RAND()', '=A:A']) {
    parameters.push(formula('unsupported', expression, [reference('factor')])); assert.equal(resolve(document, 'unsupported').status, 'unsupported', expression); parameters.pop();
  }
  for (const expression of ['=SUM(', '=1/0']) { parameters.push(formula('invalid', expression, [])); assert.equal(resolve(document, 'invalid').status, 'invalid'); parameters.pop(); }
  parameters.push(formula('gone', '=A1', [{ ...reference('factor'), procedureId: 'deleted' }])); assert.equal(resolve(document, 'gone').status, 'missing');
});

test('parameter references and field pins copy to disjoint stable identities without rewriting source schemas or version snapshots', () => {
  const document = fixture(), procedure = document.procedures![0];
  procedure.parameters!.push(parameter('volume-param', '', { type: 'quantity', units: ['mL'], source: pinProcedureField(procedureFieldChoices(document)[0], 4) }));
  const map = Object.fromEntries(['method', 'prepare', 'dilute', 'factor', 'total', 'volume-param', 'amounts', 'table', 'sample', 'control'].map(id => [id, `copy-${id}`]));
  const copied = structuredClone(document), owner = copied.procedures![0];
  owner.id = map.method; owner.steps.forEach(step => step.id = map[step.id]); owner.parameters = copyProcedureParameters(owner.parameters!, map);
  const block = copied.content.content[0]; block.attrs!.blockId = map.amounts;
  const table = block.attrs!.table as StructuredTableDraft; table.id = map.table; table.rows.forEach(row => row.id = map[row.id]);
  const resolveCopy = procedureParameterResolver(copied);
  assert.deepEqual(resolveCopy(map.method, map.total), { status: 'ok', value: { type: 'decimal', value: '6' } });
  assert.deepEqual(resolveCopy(map.method, map['volume-param']), { status: 'ok', value: { type: 'quantity', value: '2', unit: 'mL' } });
  assert.equal((owner.parameters![2].source as any).columnId, 'volume'); assert.equal((owner.parameters![2].source as any).schemaRevision, 3);
  assert.equal(procedure.parameters![0].id, 'factor');
  const partial = copyProcedureParameters(procedure.parameters!, { factor: 'new-factor' });
  assert.equal((partial[1].source as any).bindings[0].parameterId, 'new-factor');
});

test('authoring and wire bounds enforce unique global IDs, scopes and reference shapes while preserving invalid draft text', () => {
  const document = fixture(), valid = parameter('new', 'unfinished');
  assert.equal(isProcedureParameter(valid), true);
  for (const patch of [{ extra: true }, { version: 0 }, { stepId: 'bad id' }, { source: { kind: 'formula', expression: '=A1', unit: '', bindings: [reference('factor', 0)] } }]) assert.equal(isProcedureParameter({ ...valid, ...patch }), false);
  for (const id of ['method', 'prepare', 'factor']) assert.equal(changeProcedures(document.procedures!, { type: 'addParameter', id: 'method', parameter: { ...valid, id } }).status, 'invalid');
  assert.equal(changeProcedures(document.procedures!, { type: 'addParameter', id: 'method', parameter: { ...valid, stepId: 'deleted' } }).status, 'missing');
  document.procedures![0].parameters = Array.from({ length: 100 }, (_, index) => parameter(`param-${index}`, '1'));
  assert.equal(changeProcedures(document.procedures!, { type: 'addParameter', id: 'method', parameter: valid }).status, 'limit');
});


test('two actual template instances keep disjoint parameter/step/table identities and rewire cross-procedure formulas to each own instance', () => {
  const document = fixture(), procedure = document.procedures![0];
  procedure.parameters!.push(parameter('amount', '', { type: 'quantity', units: ['mL'], source: pinProcedureField(procedureFieldChoices(document)[0], 7) }));
  document.procedures!.push({ id: 'report', title: 'Report', description: '', materials: [], steps: [], parameters: [formula('reported', '=A1+1', [reference('total')])] });
  const template: PublishedTemplate = { id: 'template', name: 'Method', description: '', revision: 1, kind: 'entry', collections: [], archived: false, publishedAt: '2026-11-09T00:00:00Z', parameters: [], document };
  const before = structuredClone(template); let sequence = 0;
  const first = instantiateTemplate(template, {}, () => `first-${++sequence}`), second = instantiateTemplate(template, {}, () => `second-${++sequence}`);
  for (const instance of [first, second]) {
    const map = instance.origin.idMap, owner = instance.document.procedures![0], resolveCopy = procedureParameterResolver(instance.document);
    for (const identity of ['method', 'prepare', 'dilute', 'factor', 'total', 'amount', 'report', 'reported', 'amounts', 'table', 'sample']) assert.ok(map[identity]);
    assert.equal(owner.parameters![0].stepId, map.prepare);
    assert.deepEqual(resolveCopy(map.method, map.total), { status: 'ok', value: { type: 'decimal', value: '6' } });
    assert.deepEqual(resolveCopy(map.method, map.amount), { status: 'ok', value: { type: 'quantity', value: '2', unit: 'mL' } });
    assert.deepEqual(resolveCopy(map.report, map.reported), { status: 'ok', value: { type: 'decimal', value: '7' } });
    assert.equal(owner.parameters![0].version, 1); assert.equal((owner.parameters![2].source as any).schemaId, 'schema');
  }
  const firstIds = new Set(Object.values(first.origin.idMap));
  assert.ok(Object.values(second.origin.idMap).every(id => !firstIds.has(id)));
  assert.deepEqual(template, before);
});


test('search, stable deep-link targets and Markdown export include parameter names, source pins and formulas', () => {
  const document = fixture(), before = structuredClone(document);
  assert.equal(searchNotebook(notebookSearchItems(document.content, document.procedures), 'factor')[0].id, 'factor');
  assert.deepEqual(notebookTarget(document, 'factor'), { tab: 'procedures', procedureId: 'method', ownerId: 'factor' });
  const markdown = notebookMarkdown(document);
  assert.match(markdown, /Parameters and step outputs/); assert.match(markdown, /=A1\*2/); assert.match(markdown, /"procedureId": "method"/); assert.match(markdown, /"version": 1/);
  assert.deepEqual(document, before);
});
