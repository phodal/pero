import React from 'react';
import { Button, Field as FormField, Input } from '@pero/app-sdk/ui';
import type { Field, Template } from './types';

function Fields({ fields, values, change }: { fields: Field[]; values: Record<string, number>; change(name: string, value: number): void }) {
  return <>{fields.map(field => <FormField className="field" key={field.name} label={<>{field.label}{field.unit && <small> ({field.unit})</small>}</>}>
    {control => <Input {...control} type="number" required min={field.min} max={field.max} step={field.name === 'samples' ? 1 : 'any'} readOnly={field.min === field.max}
      value={Number.isNaN(values[field.name]) ? '' : values[field.name] ?? field.value} onChange={event => change(field.name, event.target.valueAsNumber)}/>}
  </FormField>)}</>;
}

/** The draft's sole editor for fixed parameters, acceptance criteria and execution budget. */
export function Specification({ template, tunable, parameters, criteria, budget, disabled, generating, canRun, onParameter, onCriterion, onBudget, onGenerate, onCancel, onFreeze, onRun }: {
  template: Template; tunable: string[]; parameters: Record<string, number>; criteria: Record<string, number>; budget: number;
  disabled: boolean; generating: boolean; canRun: boolean; onParameter(name: string, value: number): void; onCriterion(name: string, value: number): void;
  onBudget(value: number): void; onGenerate(): void; onCancel(): void; onFreeze(form: HTMLFormElement | null): void; onRun(): void;
}) {
  return <section className="specification">
    <div className="toolbar"><Button disabled={disabled} onClick={onGenerate}>{generating ? 'Generating…' : 'Generate parameters'}</Button>{generating && <Button onClick={onCancel}>Cancel</Button>}</div>
    <form onSubmit={event => event.preventDefault()} onKeyDown={event => {
      if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement) { event.preventDefault(); onFreeze(event.currentTarget); }
    }}>
      <fieldset disabled={disabled}><legend>Plant and simulation</legend><Fields fields={template.parameters.filter(field => !tunable.includes(field.name))} values={parameters} change={onParameter}/></fieldset>
      <fieldset className="acceptance-fields" disabled={disabled}><legend>Acceptance criteria</legend><Fields fields={template.criteria} values={criteria} change={onCriterion}/></fieldset>
      <fieldset disabled={disabled}><FormField label="Candidate budget" description="Execution limit: 80 attempts / 40,000 samples.">{control => <Input {...control} type="number" required min={1} max={template.candidateBudgetMax} step={1} value={Number.isNaN(budget) ? '' : budget} onChange={event => onBudget(event.target.valueAsNumber)}/>}</FormField></fieldset>
      <div className="spec-actions toolbar">
        <Button variant="primary" disabled={!canRun} aria-describedby="run-specification-effect" onClick={event => {
          if (event.currentTarget.form?.reportValidity()) onRun();
        }}>Run experiment</Button>
        <Button disabled={disabled} onClick={event => onFreeze(event.currentTarget.form)}>Freeze specification</Button>
        <small id="run-specification-effect">Running freezes the specification.</small>
      </div>
    </form>
  </section>;
}
