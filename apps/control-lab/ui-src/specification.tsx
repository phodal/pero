import React from 'react';
import { useAppContext } from '@pero/app-sdk';
import { Button, Field as FormField, Input } from '@pero/app-sdk/ui';
import type { Field, Template } from './types';
import { fieldLabel } from './presentation';

function Fields({ fields, values, change }: { fields: Field[]; values: Record<string, number>; change(name: string, value: number): void }) {
  const { locale } = useAppContext();
  return <>{fields.map(field => <FormField className="field" key={field.name} label={<>{fieldLabel(field.label, locale)}{field.unit && <small> ({field.unit})</small>}</>}>
    {control => <Input {...control} type="number" required min={field.min} max={field.max} step={field.name === 'samples' ? 1 : 'any'} readOnly={field.min === field.max}
      value={Number.isNaN(values[field.name]) ? '' : values[field.name] ?? field.value} onChange={event => change(field.name, event.target.valueAsNumber)}/>}
  </FormField>)}</>;
}

/** The draft's sole editor for fixed parameters, acceptance criteria and execution budget. */
export function Specification({ template, tunable, parameters, criteria, budget, disabled, generating, formRef, onParameter, onCriterion, onBudget, onGenerate, onCancel, onFreeze }: {
  template: Template; tunable: string[]; parameters: Record<string, number>; criteria: Record<string, number>; budget: number;
  disabled: boolean; generating: boolean; formRef?: React.Ref<HTMLFormElement>; onParameter(name: string, value: number): void; onCriterion(name: string, value: number): void;
  onBudget(value: number): void; onGenerate(): void; onCancel(): void; onFreeze(form: HTMLFormElement | null): void;
}) {
  const { locale } = useAppContext();
  const zh = locale === 'zh-CN';
  const text = (en: string, zhText: string) => zh ? zhText : en;
  return <section className="specification">
    <div className="toolbar"><Button disabled={disabled} onClick={onGenerate}>{generating ? text('Generating…', '正在生成…') : text('Generate parameters', '生成参数')}</Button>{generating && <Button onClick={onCancel}>{text('Cancel', '取消')}</Button>}</div>
    <form ref={formRef} onSubmit={event => event.preventDefault()} onKeyDown={event => {
      if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement) { event.preventDefault(); onFreeze(event.currentTarget); }
    }}>
      <fieldset disabled={disabled}><legend>{text('Plant and simulation', '对象与仿真')}</legend><Fields fields={template.parameters.filter(field => !tunable.includes(field.name))} values={parameters} change={onParameter}/></fieldset>
      <fieldset className="acceptance-fields" disabled={disabled}><legend>{text('Acceptance criteria', '验收条件')}</legend><Fields fields={template.criteria} values={criteria} change={onCriterion}/></fieldset>
      <fieldset disabled={disabled}><FormField label={text('Candidate budget', '候选预算')} description={text('Execution limit: 80 attempts / 40,000 samples.', '执行上限：80 次尝试 / 40,000 个采样。')}>{control => <Input {...control} type="number" required min={1} max={template.candidateBudgetMax} step={1} value={Number.isNaN(budget) ? '' : budget} onChange={event => onBudget(event.target.valueAsNumber)}/>}</FormField></fieldset>
      <small id="run-specification-effect">{text('Running freezes the specification.', '运行后规格即被冻结。')}</small>
    </form>
  </section>;
}
