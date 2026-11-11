import { useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Checkbox, Dialog, Disclosure, Feedback, Field, Input, Select } from '@pero/app-sdk/ui';
import type { NotebookDocument } from '@pero/notebook';
import { type NotebookProcedure, type ProcedureChange } from '@pero/notebook/workspace';
import { columnTypes, type ColumnType } from '@pero/notebook/structured-table';
import { isProcedureParameter, parameterColumn, pinProcedureField, sameProcedureFieldSnapshot, procedureFieldChoices, procedureParameterLimits, procedureParameterResolver,
  type ProcedureParameter, type ProcedureParameterSource, type ProcedureFormula } from '@pero/notebook/procedure-parameters';
import { useNotebookContext } from './notebook-context';

const messages = {
  title: { en: 'Parameters and step outputs', zh: '参数与步骤输出' }, add: { en: 'Add parameter', zh: '添加参数' }, edit: { en: 'Edit parameter', zh: '编辑参数' },
  remove: { en: 'Remove parameter', zh: '移除参数' }, save: { en: 'Apply parameter', zh: '应用参数' }, cancel: { en: 'Cancel', zh: '取消' }, close: { en: 'Close', zh: '关闭' },
  hint: { en: 'Local method inputs, not verified experiment results. Pins capture the current draft and its saved base revision. Changes require explicit review and rebinding.', zh: '本地方法输入，并非经过验证的实验结果。绑定记录当前草稿及其已保存的基础修订，变更后需明确审阅并重新绑定。' },
  name: { en: 'Parameter name', zh: '参数名称' }, type: { en: 'Parameter type', zh: '参数类型' }, scope: { en: 'Parameter scope', zh: '参数范围' }, procedure: { en: 'Whole procedure', zh: '整个流程' },
  deletedStep: { en: 'Missing step: {id}', zh: '缺失步骤：{id}' }, required: { en: 'Required value', zh: '必填值' }, units: { en: 'Allowed units (one per comma)', zh: '允许的单位（逗号分隔）' }, options: { en: 'Text choices (one per comma)', zh: '文本选项（逗号分隔）' },
  source: { en: 'Parameter source', zh: '参数来源' }, literal: { en: 'Recorded value', zh: '记录值' }, table: { en: 'Pinned table field', zh: '固定表格字段' }, formula: { en: 'Cross-step formula', zh: '跨步骤公式' },
  value: { en: 'Raw value', zh: '原始值' }, field: { en: 'Structured table field', zh: '结构化表格字段' }, choose: { en: 'Choose a field', zh: '选择字段' },
  noFields: { en: 'Add an input or registration table in Notes or rich procedure content first.', zh: '请先在笔记或流程富文本中添加输入表或登记表。' },
  fieldChanged: { en: 'The selected field changed or disappeared. Select it again to review the latest value.', zh: '所选字段已更改或消失，请重新选择并审阅最新值。' },
  expression: { en: 'Formula expression', zh: '公式表达式' }, resultUnit: { en: 'Formula result unit', zh: '公式结果单位' },
  reference: { en: 'Reference for {slot}', zh: '{slot} 的引用' }, chooseReference: { en: 'Choose a parameter', zh: '选择参数' }, addReference: { en: 'Add reference slot', zh: '添加引用槽位' },
  reviewField: { en: 'Review current field', zh: '审阅当前字段' }, removeReference: { en: 'Remove last reference slot', zh: '移除最后一个引用槽位' },
  repin: { en: 'Review and repin references', zh: '审阅并重新固定引用' }, expectedUnit: { en: 'Expected unit for {slot}', zh: '{slot} 的预期单位' },
  formulaHint: { en: 'Use A1…A25 for the reference slots below (for example =A1*2 or =SUM(A1:A2)). Standard Notebook functions only. Quantities use magnitudes in the exact displayed unit; no unit conversion is performed.', zh: '使用 A1…A25 引用下方槽位（例如 =A1*2 或 =SUM(A1:A2)）。仅支持笔记标准函数。物理量以显示的精确单位取数值，不会自动换算单位。' },
  pinHint: { en: 'Selected snapshot: {value}', zh: '已选快照：{value}' }, preview: { en: 'Preview', zh: '预览' }, none: { en: 'No parameters recorded.', zh: '暂无参数记录。' },
  ok: { en: 'Resolved', zh: '已解析' }, missing: { en: 'Missing input or owner', zh: '输入或所属对象缺失' }, stale: { en: 'Changed since binding. Review before rebinding.', zh: '绑定后已更改，请审阅后重新绑定。' }, ambiguous: { en: 'Duplicate identity. Resolve the source before using it.', zh: '身份重复，请先修复来源。' },
  cycle: { en: 'Circular parameter dependency', zh: '参数循环依赖' }, invalid: { en: 'Invalid value or formula', zh: '值或公式无效' }, unsupported: { en: 'Unsupported formula or reference', zh: '不支持的公式或引用' },
  typeError: { en: 'Type or unit mismatch', zh: '类型或单位不匹配' }, limit: { en: 'Parameter or dependency limit reached', zh: '已达到参数或依赖数量限制' },
  staleEditor: { en: 'This parameter changed while the editor was open. Close and reopen it to review the latest version.', zh: '编辑期间此参数已更改，请关闭并重新打开以审阅最新版本。' },
  deleteHint: { en: 'Removing a parameter leaves its dependents visibly missing. Saved revisions remain unchanged.', zh: '移除参数后，引用它的参数将显示缺失。已保存的修订不变。' },
} as const;
const labelValue = (value: ReturnType<ReturnType<typeof procedureParameterResolver>>) => value.status !== 'ok' ? '' : value.value.type === 'missing' ? ''
  : value.value.type === 'quantity' ? `${value.value.value} ${value.value.unit}` : value.value.type === 'object' ? JSON.stringify(value.value.value) : String(value.value.value);
const sourceDefault = (kind: ProcedureParameterSource['kind']): ProcedureParameterSource => kind === 'formula' ? { kind, expression: '=A1*2', bindings: [], unit: '' } : { kind: 'literal', raw: '' };

export function ProcedureParameters({ procedure, readonly, apply }: { procedure: NotebookProcedure; readonly: boolean; apply: (change: ProcedureChange) => void }) {
  const { t } = useAppI18n(messages), context = useNotebookContext();
  const [editing, setEditing] = useState<{ parameter: ProcedureParameter; creating: boolean } | null>(null);
  const [removing, setRemoving] = useState<ProcedureParameter | null>(null), [error, setError] = useState('');
  // Standalone workspace consumers can still author literals; bindings require real content.
  const document = context?.document ?? { schemaVersion: 1, title: '', content: { type: 'doc', content: [] }, procedures: [procedure] } as NotebookDocument;
  const resolve = procedureParameterResolver(document), disabled = readonly || !!context?.readonly;
  const statusText = (status: ReturnType<typeof resolve>['status']) => t(status === 'type' ? 'typeError' : status);
  const current = () => context?.getDocument() ?? document;
  return <section aria-label={t('title')}>
    <div className="notebook-workspace-actions"><h3>{t('title')}</h3>{!disabled && <Button disabled={(procedure.parameters?.length ?? 0) >= procedureParameterLimits.parameters} onClick={() => {
      setError(''); setEditing({ creating: true, parameter: { id: crypto.randomUUID(), name: '', type: 'decimal', required: true, options: [], units: [], version: 1, stepId: null, source: { kind: 'literal', raw: '' } } });
    }}>{t('add')}</Button>}</div>
    <p className="notebook-workspace-hint">{t('hint')}</p>
    {!procedure.parameters?.length && <p>{t('none')}</p>}
    {(procedure.parameters ?? []).map(parameter => { const result = resolve(procedure.id, parameter.id); return <div key={parameter.id} data-parameter-id={parameter.id} id={`notebook-target-${parameter.id}`} tabIndex={-1}>
      <div className="notebook-workspace-actions"><strong>{parameter.name || parameter.id}</strong><Badge>{parameter.type}</Badge><Badge>v{parameter.version}</Badge><Badge>{t(parameter.source.kind)}</Badge>
        {!disabled && <><Button variant="ghost" onClick={() => { setError(''); setEditing({ creating: false, parameter: structuredClone(parameter) }); }}>{t('edit')}</Button>
          <Button variant="ghost" onClick={() => setRemoving(parameter)}>{t('remove')}</Button></>}
      </div>
      <p>{parameter.stepId === null ? t('procedure') : (procedure.steps.some(step => step.id === parameter.stepId) ? procedure.steps.find(step => step.id === parameter.stepId)!.text || parameter.stepId : t('deletedStep', { id: parameter.stepId }))}</p>
      <p role="status">{statusText(result.status)}{result.status === 'ok' ? `: ${labelValue(result)}` : ''}</p>
      {parameter.source.kind === 'table' && <Disclosure variant="inline" summary={t('source')}><p className="notebook-workspace-hint">{parameter.source.blockId} / {parameter.source.rowId} / {parameter.source.column.name} · schema v{parameter.source.schemaRevision} · draft base {parameter.source.observedRevision} · {t('pinHint', { value: parameter.source.raw })}</p></Disclosure>}
    </div>; })}
    {error && <Feedback kind="error">{error}</Feedback>}
    {!disabled && editing && <ParameterEditor key={`${editing.parameter.id}:${editing.parameter.version}`} parameter={editing.parameter} procedure={procedure} document={document} revision={context?.revision ?? 1}
      onClose={() => setEditing(null)} onApply={parameter => {
        if (readonly || context?.readonly) return;
        const live = current(), existing = live.procedures?.find(item => item.id === procedure.id)?.parameters?.find(item => item.id === parameter.id);
        if (!editing.creating && (!existing || existing.version !== editing.parameter.version)) return t('staleEditor');
        if (parameter.source.kind === 'table') {
          const source = parameter.source;
          const matches = procedureFieldChoices(live).filter(item => item.blockId === source.blockId && item.table.id === source.tableId && item.rowId === source.rowId && item.column.id === source.columnId);
          if (matches.length !== 1 || !sameProcedureFieldSnapshot(source, matches[0])) return t('fieldChanged');
        }
        if (!isProcedureParameter(parameter)) return t('invalid');
        if (editing.creating) apply({ type: 'addParameter', id: procedure.id, parameter });
        else { const { id: _id, version: _version, ...patch } = parameter; apply({ type: 'editParameter', id: procedure.id, parameterId: parameter.id, expectedVersion: editing.parameter.version, patch }); }
        setEditing(null); return undefined;
      }} />}
    {!disabled && removing && <Dialog title={t('remove')} closeLabel={t('close')} onClose={() => setRemoving(null)} footer={<>
      <Button variant="ghost" onClick={() => setRemoving(null)}>{t('cancel')}</Button><Button onClick={() => { if (!readonly && !context?.readonly) apply({ type: 'removeParameter', id: procedure.id, parameterId: removing.id, expectedVersion: removing.version }); setRemoving(null); }}>{t('remove')}</Button></>}>
      <p>{t('deleteHint')}</p><strong>{removing.name}</strong>
    </Dialog>}
  </section>;
}

function ParameterEditor({ parameter, procedure, document, revision, onClose, onApply }: { parameter: ProcedureParameter; procedure: NotebookProcedure; document: NotebookDocument; revision: number; onClose: () => void; onApply: (parameter: ProcedureParameter) => string | undefined }) {
  const { t } = useAppI18n(messages), [draft, setDraft] = useState(parameter), [mode, setMode] = useState(parameter.source.kind), [error, setError] = useState('');
  const [unitsRaw, setUnitsRaw] = useState(parameter.units.join(', ')), [optionsRaw, setOptionsRaw] = useState(parameter.options.join(', '));
  const fields = procedureFieldChoices(document), resolve = procedureParameterResolver(document);
  const references = (document.procedures ?? []).flatMap(owner => (owner.parameters ?? []).map(item => ({ owner, item })));
  const patch = (value: Partial<ProcedureParameter>) => { setError(''); setDraft(previous => ({ ...previous, ...value })); };
  const formula = draft.source.kind === 'formula' ? draft.source : null;
  const patchFormula = (value: Partial<ProcedureFormula>) => { if (formula) patch({ source: { ...formula, ...value } }); };
  const previewDocument = { ...document, procedures: (document.procedures ?? []).map(owner => owner.id !== procedure.id ? owner : { ...owner, parameters: [...(owner.parameters ?? []).filter(item => item.id !== draft.id), draft] }) };
  const preview = procedureParameterResolver(previewDocument)(procedure.id, draft.id);
  const fieldKey = (choice: typeof fields[number]) => `${choice.blockId}/${choice.table.id}/${choice.rowId}/${choice.column.id}`;
  const source = draft.source, selectedField = source.kind === 'table' ? `${source.blockId}/${source.tableId}/${source.rowId}/${source.columnId}` : '';
  const selectReference = (index: number, key: string) => {
    if (!formula) return;
    const choice = references.find(({ owner, item }) => `${owner.id}/${item.id}` === key); if (!choice) return;
    const result = resolve(choice.owner.id, choice.item.id), unit = result.status === 'ok' && result.value.type === 'quantity' ? result.value.unit : '';
    patchFormula({ bindings: formula.bindings.map((item, offset) => offset === index ? { procedureId: choice.owner.id, parameterId: choice.item.id, version: choice.item.version, unit } : item) });
  };
  return <Dialog title={t('edit')} closeLabel={t('close')} size="lg" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button><Button disabled={mode !== draft.source.kind} onClick={() => { const failure = onApply(draft); if (failure) setError(failure); }}>{t('save')}</Button></>}>
    <div className="notebook-workspace-form">
      <Field label={t('name')}>{control => <Input {...control} maxLength={200} value={draft.name} onChange={event => patch({ name: event.target.value })} />}</Field>
      <Select label={t('scope')} value={draft.stepId ?? ''} options={[{ value: '', label: t('procedure') }, ...procedure.steps.map((step, index) => ({ value: step.id, label: `${index + 1}. ${step.text || step.id}` })), ...(draft.stepId && !procedure.steps.some(step => step.id === draft.stepId) ? [{ value: draft.stepId, label: t('deletedStep', { id: draft.stepId }) }] : [])]} onChange={value => patch({ stepId: value || null })} />
      <Select label={t('type')} value={draft.type} options={columnTypes.map(type => ({ value: type, label: type }))} onChange={value => { setUnitsRaw(''); setOptionsRaw(''); patch({ type: value as ColumnType, options: [], units: [] }); }} />
      <label><Checkbox checked={draft.required} onCheckedChange={value => patch({ required: value === true })} />{t('required')}</label>
      {draft.type === 'quantity' && <Field label={t('units')}>{control => <Input {...control} value={unitsRaw} onChange={event => { setUnitsRaw(event.target.value); patch({ units: event.target.value.split(',').map(item => item.trim()).filter(Boolean) }); }} />}</Field>}
      {draft.type === 'text' && <Field label={t('options')}>{control => <Input {...control} value={optionsRaw} onChange={event => { setOptionsRaw(event.target.value); patch({ options: event.target.value.split(',').map(item => item.trim()).filter(Boolean) }); }} />}</Field>}
      <Select label={t('source')} value={mode} options={(['literal', 'table', 'formula'] as const).map(kind => ({ value: kind, label: t(kind) }))} onChange={value => { const kind = value as ProcedureParameterSource['kind']; setMode(kind); if (kind !== draft.source.kind) patch({ source: sourceDefault(kind) }); }} />
      {mode === 'literal' && source.kind === 'literal' && <Field label={t('value')}>{control => <Input {...control} maxLength={4096} value={source.raw} onChange={event => patch({ source: { kind: 'literal', raw: event.target.value } })} />}</Field>}
      {mode === 'table' && <>
        {!fields.length ? <p>{t('noFields')}</p> : <Select label={t('field')} showHint value={selectedField} options={[{ value: '', label: t('choose') }, ...fields.map(choice => {
          const rowIndex = choice.table.rows.findIndex(row => row.id === choice.rowId);
          const nameColumn = choice.table.schema.columns.find(column => column.type === 'text');
          const rowName = nameColumn && choice.table.rows[rowIndex]?.cells[nameColumn.id];
          return { value: fieldKey(choice), label: `${choice.column.name} · ${choice.raw || '∅'}`,
            hint: `${choice.table.name || choice.table.id} · ${rowName || `#${rowIndex + 1}`}` };
        })]} onChange={key => {
          const choice = fields.find(item => fieldKey(item) === key); if (choice) { setUnitsRaw(choice.column.units.join(', ')); setOptionsRaw(choice.column.options.join(', ')); patch({ ...parameterColumn(choice.column), id: draft.id, name: draft.name || choice.column.name, source: pinProcedureField(choice, revision) }); }
        }} />}
        {source.kind === 'table' && <><p>{t('pinHint', { value: source.raw })} · {source.column.type} · schema v{source.schemaRevision}</p>
          <Button variant="ghost" onClick={() => {
            const matches = fields.filter(choice => fieldKey(choice) === selectedField);
            if (matches.length !== 1) { setError(t('fieldChanged')); return; }
            patch({ source: pinProcedureField(matches[0], revision) });
          }}>{t('reviewField')}</Button></>}
      </>}
      {mode === 'formula' && formula && <>
        <p>{t('formulaHint')}</p>
        <Field label={t('expression')}>{control => <Input {...control} maxLength={4096} value={formula.expression} onChange={event => patchFormula({ expression: event.target.value })} />}</Field>
        {draft.type === 'quantity' && <Select label={t('resultUnit')} value={formula.unit} options={[{ value: '', label: t('choose') }, ...draft.units.map(unit => ({ value: unit, label: unit }))]} onChange={unit => patchFormula({ unit })} />}
        {formula.bindings.map((binding, index) => {
          const key = `${binding.procedureId}/${binding.parameterId}`, exists = references.some(({ owner, item }) => `${owner.id}/${item.id}` === key);
          return <div key={index}>
            <Select label={t('reference', { slot: `A${index + 1}` })} value={key} options={[...references.map(({ owner, item }) => ({ value: `${owner.id}/${item.id}`, label: `${owner.title} · ${item.stepId === null ? t('procedure') : item.stepId} · ${item.name || item.id} (${item.id}) · v${item.version} · ${labelValue(resolve(owner.id, item.id))}` })), ...(!exists ? [{ value: key, label: t('chooseReference') }] : [])]} onChange={value => selectReference(index, value)} />
            <p>{`A${index + 1}: ${binding.procedureId}/${binding.parameterId} · v${binding.version}`}</p>
            <Field label={t('expectedUnit', { slot: `A${index + 1}` })}>{control => <Input {...control} maxLength={200} value={binding.unit} onChange={event => patchFormula({ bindings: formula.bindings.map((item, offset) => offset === index ? { ...item, unit: event.target.value } : item) })} />}</Field>
          </div>;
        })}
        <Button disabled={formula.bindings.length >= 25} onClick={() => patchFormula({ bindings: [...formula.bindings, { procedureId: procedure.id, parameterId: 'unselected', version: 1, unit: '' }] })}>{t('addReference')}</Button>
        {!!formula.bindings.length && <Button variant="ghost" onClick={() => patchFormula({ bindings: formula.bindings.slice(0, -1) })}>{t('removeReference')}</Button>}
        {!!formula.bindings.length && <Button variant="ghost" onClick={() => patchFormula({ bindings: formula.bindings.map(binding => {
          const found = references.find(({ owner, item }) => owner.id === binding.procedureId && item.id === binding.parameterId); return found ? { ...binding, version: found.item.version } : binding;
        }) })}>{t('repin')}</Button>}
      </>}
      <p role="status">{t('preview')}: {t(preview.status === 'type' ? 'typeError' : preview.status)}{preview.status === 'ok' ? `: ${labelValue(preview)}` : ''}</p>
      {error && <Feedback kind="error">{error}</Feedback>}
    </div>
  </Dialog>;
}
