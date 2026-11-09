import './mixture.css';
import { useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Feedback, Field, Input, Select, Textarea } from '@pero/app-sdk/ui';
import { displayNumber } from '@pero/notebook/grid-presentation';
import { mixtureUnits, editMixtureRecipe, mixtureDimension, mixtureQSEstimate, saveMixtureRecipe, recordMixturePreparation, type MixturePreparation, type MixtureQuantity, type MixtureRecipe } from '@pero/notebook/mixture';
import { BlockFrame } from './block-frame';

const messages = {
  title: { en: 'Mixture preparation', zh: '配液制备' }, name: { en: 'Recipe name', zh: '配方名称' },
  output: { en: 'Output / batch identifier', zh: '产物 / 批次标识' }, notes: { en: 'Method / notes', zh: '方法 / 备注' },
  target: { en: 'Final target', zh: '最终目标量' }, unit: { en: 'Unit', zh: '单位' },
  add: { en: 'Add ingredient', zh: '添加成分' }, remove: { en: 'Remove ingredient', zh: '移除成分' },
  reference: { en: 'Material / batch reference', zh: '材料 / 批次引用' }, source: { en: 'Source', zh: '来源' },
  mode: { en: 'Planned addition', zh: '计划添加方式' }, quantity: { en: 'Specified quantity', zh: '指定用量' }, qs: { en: 'QS to final volume', zh: '补足至最终体积' },
  planned: { en: 'Planned quantity', zh: '计划用量' }, actual: { en: 'Measured quantity', zh: '实测用量' }, unknown: { en: 'Unknown', zh: '未知' },
  assumption: { en: 'QS planning estimate', zh: 'QS 计划估算' }, off: { en: 'No additive-volume assumption', zh: '不假定体积可加' }, on: { en: 'Assume volumes add (planning only)', zh: '假定体积可加（仅计划）' },
  caveat: { en: 'QS means fill to the final measured volume. Subtraction is only a planning estimate under the stated additive-volume assumption, never an observed addition.', zh: 'QS 表示补足至最终实测体积。相减只是在明确假定体积可加时的计划估算，不是实测添加量。' },
  save: { en: 'Save recipe revision', zh: '保存配方版本' }, record: { en: 'Record actual preparation', zh: '记录实际制备' }, operator: { en: 'Operator (self-reported)', zh: '操作者（自行填写）' },
  local: { en: 'Local user-entered record. No physical execution or inventory deduction. Editing the recipe clears pending measurements. Save the entry to persist these changes.', zh: '本地人工记录，不执行物理操作、不扣减库存。修改配方会清空待记录的实测值。保存记录以持久化这些更改。' },
  dirty: { en: 'Recipe has unsaved changes. Save a recipe revision before recording actual preparation.', zh: '配方有未保存的更改。请先保存配方版本，再记录实际制备。' },
  history: { en: 'Actual preparation records', zh: '实际制备记录' }, empty: { en: 'No actual preparation recorded.', zh: '尚未记录实际制备。' },
  actualOutput: { en: 'Actual output identifier', zh: '实际产物标识' }, actualNotes: { en: 'Actual preparation notes', zh: '实际制备备注' },
};

export function MixturePrepView(view: NodeViewProps) {
  const { t } = useAppI18n(messages);
  const state = view.node.attrs.mixture as MixturePreparation;
  const [error, setError] = useState(''), [operator, setOperator] = useState(''), [output, setOutput] = useState(''), [notes, setNotes] = useState('');
  const editable = view.editor.isEditable, draft = state.draft;
  const update = (next: MixturePreparation) => view.updateAttributes({ mixture: next });
  const changeRecipe = (patch: Partial<MixtureRecipe>) => { setError(''); update(editMixtureRecipe(state, { ...draft, ...patch })); };
  const run = (action: () => void) => { try { action(); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  const saved = state.recipes.at(-1), dirty = !saved || JSON.stringify(saved.recipe) !== JSON.stringify(draft);
  const shownAmount = (value: number | null | undefined) => value == null ? t('unknown') : displayNumber(value);
  const quantity = (label: string, q: MixtureQuantity, onChange: (q: MixtureQuantity) => void, units = Object.keys(mixtureUnits), noValue = false) => <div className="notebook-mixture-quantity">
    <Field label={label}>{control => <Input {...control} type="number" min="0" max="1000000000000" step="any" disabled={!editable || noValue} placeholder={t('unknown')} value={q.value ?? ''} onChange={event => onChange({ ...q, value: event.target.value === '' ? null : Number(event.target.value) })} />}</Field>
    <Select label={`${label}: ${t('unit')}`} disabled={!editable} value={q.unit} options={units.map(unit => ({ value: unit, label: unit }))} onChange={unit => onChange({ ...q, unit })} />
  </div>;
  let estimate: MixtureQuantity | null = null, estimateError = '';
  try { estimate = mixtureQSEstimate(draft); } catch (cause) { estimateError = cause instanceof Error ? cause.message : String(cause); }
  return <BlockFrame view={view} kind="mixturePrep" title={<strong>{draft.name || t('title')}</strong>} caption={saved && <Badge>v{saved.revision}</Badge>}>
    <p className="notebook-note">{t('local')}</p>
    {error && <Feedback kind="error">{error}</Feedback>}
    <div className="notebook-mixture-form">
      <Field label={t('name')}>{control => <Input {...control} disabled={!editable} maxLength={200} value={draft.name} onChange={event => changeRecipe({ name: event.target.value })} />}</Field>
      <Field label={t('output')}>{control => <Input {...control} disabled={!editable} maxLength={200} value={draft.output} onChange={event => changeRecipe({ output: event.target.value })} />}</Field>
      {quantity(t('target'), draft.target, target => changeRecipe({ target }), Object.keys(mixtureUnits).filter(unit => !draft.ingredients.some(i => i.mode === 'qs') || mixtureDimension(unit) === 'volume'))}
      <Field label={t('notes')}>{control => <Textarea {...control} disabled={!editable} maxLength={4000} value={draft.notes} onChange={event => changeRecipe({ notes: event.target.value })} />}</Field>
    </div>
    {draft.ingredients.map((ingredient, index) => <fieldset key={ingredient.id} className="notebook-mixture-ingredient"><legend>{index + 1}. {ingredient.reference || t('reference')}</legend>
      <div className="notebook-mixture-form">
        <Field label={t('reference')}>{control => <Input {...control} disabled={!editable} maxLength={200} value={ingredient.reference} onChange={event => changeRecipe({ ingredients: draft.ingredients.map(i => i.id === ingredient.id ? { ...i, reference: event.target.value } : i) })} />}</Field>
        <Field label={t('source')}>{control => <Input {...control} disabled={!editable} maxLength={1000} value={ingredient.source} onChange={event => changeRecipe({ ingredients: draft.ingredients.map(i => i.id === ingredient.id ? { ...i, source: event.target.value } : i) })} />}</Field>
        <Select label={t('mode')} value={ingredient.mode} disabled={!editable} options={[{ value: 'quantity', label: t('quantity') }, ...(!draft.ingredients.some(i => i.mode === 'qs' && i.id !== ingredient.id) && mixtureDimension(draft.target.unit) === 'volume' ? [{ value: 'qs', label: t('qs') }] : [])]} onChange={value => {
          const mode = value as 'quantity' | 'qs'; const target = mode === 'qs' ? { value: null, unit: draft.target.unit } : ingredient.target;
          changeRecipe({ ingredients: draft.ingredients.map(i => i.id === ingredient.id ? { ...i, mode, target } : i) });
        }} />
        {quantity(t('planned'), ingredient.target, target => {
          changeRecipe({ ingredients: draft.ingredients.map(i => i.id === ingredient.id ? { ...i, target } : i) });
        }, Object.keys(mixtureUnits).filter(unit => ingredient.mode !== 'qs' || mixtureDimension(unit) === 'volume'), ingredient.mode === 'qs')}
        {quantity(t('actual'), state.measurements[ingredient.id] ?? { value: null, unit: ingredient.target.unit }, measured => update({ ...state, measurements: { ...state.measurements, [ingredient.id]: measured } }), Object.keys(mixtureUnits).filter(unit => mixtureDimension(unit) === mixtureDimension(ingredient.target.unit)))}
      </div>
      {editable && <Button variant="ghost" onClick={() => { changeRecipe({ ingredients: draft.ingredients.filter(i => i.id !== ingredient.id) }); }}>{t('remove')}</Button>}
    </fieldset>)}
    {editable && <Button disabled={draft.ingredients.length >= 100} onClick={() => changeRecipe({ ingredients: [...draft.ingredients, { id: crypto.randomUUID(), reference: '', source: '', mode: 'quantity', target: { value: null, unit: draft.target.unit } }] })}>{t('add')}</Button>}
    {draft.ingredients.some(i => i.mode === 'qs') && <>
      <Select label={t('assumption')} disabled={!editable} value={draft.additiveVolumes ? 'yes' : 'no'} options={[{ value: 'no', label: t('off') }, { value: 'yes', label: t('on') }]} onChange={value => changeRecipe({ additiveVolumes: value === 'yes' })} />
      <p>{t('caveat')}</p><p>{t('assumption')}: {shownAmount(estimate?.value)} {estimate?.unit}</p>
      {estimateError && <Feedback kind="error">{estimateError}</Feedback>}
    </>}
    {editable && <><Button disabled={!dirty || state.recipes.length >= 100} onClick={() => run(() => update(saveMixtureRecipe(state)))}>{t('save')}</Button>
      {dirty && <p>{t('dirty')}</p>}
      <div className="notebook-mixture-form">
        <Field label={t('operator')}>{control => <Input {...control} maxLength={200} value={operator} onChange={event => setOperator(event.target.value)} />}</Field>
        <Field label={t('actualOutput')}>{control => <Input {...control} maxLength={200} value={output} onChange={event => setOutput(event.target.value)} />}</Field>
        <Field label={t('actualNotes')}>{control => <Textarea {...control} maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} />}</Field>
      </div>
      <Button disabled={dirty || !operator.trim() || state.records.length >= 100} onClick={() => run(() => update(recordMixturePreparation(state, { id: crypto.randomUUID(), expectedRecipeRevision: saved!.revision, expectedDraft: structuredClone(draft), operator, recordedAt: new Date().toISOString(), output, notes })))}>{t('record')}</Button>
    </>}
    <h4>{t('history')}</h4>{!state.records.length && <p>{t('empty')}</p>}
    {state.records.map(record => <details key={record.id}><summary>{record.operator} · {record.recordedAt} · v{record.recipeRevision} · {record.output}</summary>
      <p>{record.id} · {record.recipe.name} · {record.notes}</p><p>{record.recipe.notes}</p>
      <p>{t('target')}: {shownAmount(record.recipe.target.value)} {record.recipe.target.unit}</p>
      <ul>{record.recipe.ingredients.map(i => <li key={i.id}>{i.reference} · {i.source} · {t('planned')}: {i.mode === 'qs' ? t('qs') : `${shownAmount(i.target.value)} ${i.target.unit}`} · {t('actual')}: {shownAmount(record.actual[i.id].value)} {record.actual[i.id].unit}</li>)}</ul>
    </details>)}
  </BlockFrame>;
}
