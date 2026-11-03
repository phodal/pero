import React, { useId, useState } from 'react';
import { Button } from '@pero/app-sdk/ui';
import type { LabState } from './types';
import { describeStep, editProtocolStep, operationLabels, readStepEditor, suggestDraftTip } from './protocol-draft';

export function ProtocolEditor({ value, onChange, disabled, state, maxSteps, heading }: {
  value: string; onChange(value: string): void; disabled: boolean; state: LabState; maxSteps: number; heading: string;
}) {
  const [view, setView] = useState<'steps' | 'json'>('steps');
  const [editing, setEditing] = useState<number | null>(null);
  const [removed, setRemoved] = useState<{ before: string; after: string; step: number } | null>(null);
  const resourceList = useId();
  const tipStatus = useId();
  const parsed = readStepEditor(value);
  const document = parsed.kind === 'steps' ? parsed.document : null;
  const nextTip = document ? suggestDraftTip(document, state.available_tips) : undefined;
  const extraFields = document && (Object.keys(document).some(key => !['version', 'initial_revision', 'steps'].includes(key))
    || document.steps.some(step => Object.keys(step).some(key => !['op', 'resource', 'volume_ul'].includes(key))));
  return <section className="protocol-draft" aria-label="Protocol editor">
    <div className="section-toolbar">
      <div><h2>{heading}</h2>{document && <span className="muted">{document.steps.length} / {maxSteps} steps</span>}</div>
      <div className="view-switch" role="group" aria-label="Protocol format">
        <Button aria-pressed={view === 'steps'} onClick={() => setView('steps')}>Steps</Button>
        <Button aria-pressed={view === 'json'} onClick={() => setView('json')}>JSON</Button>
      </div>
    </div>
    {view === 'json' ? <label>Protocol JSON<textarea className="protocol-editor" spellCheck={false} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} /></label> : !document ? <div className="editor-message">
      <p className="error" role="status">{parsed.kind === 'json' && parsed.message}</p>
      <Button onClick={() => setView('json')}>Edit JSON</Button>
    </div> : <>
      {extraFields && <p className="notice">Extra fields retained in JSON.</p>}
      {!document.steps.length && <p className="empty">Add the first step.</p>}
      <ol className="editable-steps">{document.steps.map((step, index) => <li key={index}>
        <div className="step-summary"><strong>{describeStep(step)}</strong><Button variant="ghost" aria-expanded={editing === index} aria-label={`${editing === index ? 'Close' : 'Edit'} step ${index + 1}`} onClick={() => setEditing(editing === index ? null : index)}>{editing === index ? 'Done' : 'Edit'}</Button></div>
        {editing === index && <div className="step-fields">
          <div className="fields">
            <label>Operation<select aria-label={`Step ${index + 1} operation`} value={step.op} disabled={disabled} onChange={event => onChange(editProtocolStep(document, index, 'op', event.target.value))}>
              {!Object.hasOwn(operationLabels, step.op) && <option value={step.op}>{step.op}</option>}
              {Object.entries(operationLabels).map(([operation, label]) => <option key={operation} value={operation}>{label}</option>)}
            </select></label>
            <label>Resource<input aria-label={`Step ${index + 1} resource`} list={resourceList} value={step.resource} disabled={disabled} onChange={event => onChange(editProtocolStep(document, index, 'resource', event.target.value))} /></label>
            {(step.op === 'aspirate' || step.op === 'dispense' || step.volume_ul !== undefined) && <label>Volume (µL)<input aria-label={`Step ${index + 1} volume in microliters`} type="number" step="any" value={step.volume_ul ?? ''} disabled={disabled} onChange={event => onChange(editProtocolStep(document, index, 'volume_ul', event.target.value))} /></label>}
          </div>
          <div className="toolbar step-actions">
            <Button disabled={disabled || index === 0} onClick={() => {
              const steps = [...document.steps]; [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]];
              onChange(JSON.stringify({ ...document, steps }, null, 2)); setEditing(index - 1);
            }}>Move up</Button>
            <Button disabled={disabled || index === document.steps.length - 1} onClick={() => {
              const steps = [...document.steps]; [steps[index + 1], steps[index]] = [steps[index], steps[index + 1]];
              onChange(JSON.stringify({ ...document, steps }, null, 2)); setEditing(index + 1);
            }}>Move down</Button>
            <Button disabled={disabled} onClick={() => {
              const after = JSON.stringify({ ...document, steps: document.steps.filter((_, at) => at !== index) }, null, 2);
              setRemoved({ before: value, after, step: index + 1 }); onChange(after); setEditing(null);
            }}>Remove step</Button>
          </div>
        </div>}
      </li>)}</ol>
      {removed?.after === value && <div className="toolbar editor-message" role="status">Step {removed.step} removed.<Button disabled={disabled} onClick={() => { onChange(removed.before); setRemoved(null); }}>Undo</Button></div>}
      <div className="toolbar"><Button disabled={disabled || !nextTip} aria-describedby={!nextTip ? tipStatus : undefined} onClick={() => {
        if (!nextTip) return;
        onChange(JSON.stringify({ ...document, steps: [...document.steps, { op: 'pickup_tip', resource: nextTip }] }, null, 2)); setEditing(document.steps.length);
      }}>Add step</Button>{!nextTip && <span id={tipStatus} className="muted" role="status">No unused tips in this draft.</span>}</div>
      <datalist id={resourceList}>{[...state.wells.map(well => well.id), ...state.available_tips].map(resource => <option key={resource} value={resource} />)}</datalist>
    </>}
  </section>;
}
