import { Input, Textarea, Select } from '@pero/app-sdk/ui';
import React, { useId, useState } from 'react';
import { Button, Icon } from '@pero/app-sdk/ui';
import type { LabState } from './types';
import { editProtocolStep, operationLabels, readStepEditor, suggestDraftTip } from './protocol-draft';

export function ProtocolEditor({ value, onChange, disabled, state, maxSteps, heading }: {
  value: string; onChange(value: string): void; disabled: boolean; state: LabState; maxSteps: number; heading: string;
}) {
  const [view, setView] = useState<'steps' | 'json'>('steps');
  const [removed, setRemoved] = useState<{ before: string; after: string; step: number } | null>(null);
  const resourceList = useId();
  const tipStatus = useId();
  const parsed = readStepEditor(value);
  const document = parsed.kind === 'steps' ? parsed.document : null;
  const nextTip = document ? suggestDraftTip(document, state.available_tips) : undefined;
  const extraFields = document && (Object.keys(document).some(key => !['version', 'initial_revision', 'steps'].includes(key))
    || document.steps.some(step => Object.keys(step).some(key => !['op', 'resource', 'volume_ul'].includes(key))));
  return <section className="protocol-draft" aria-label="Protocol editor">
    <div className="section-toolbar editor-toolbar">
      <h2>{heading}</h2>
      <div className="view-switch" role="group" aria-label="Protocol format">
        <Button variant="ghost" aria-pressed={view === 'steps'} onClick={() => setView('steps')}><Icon name="ordered" />Steps</Button>
        <Button variant="ghost" aria-pressed={view === 'json'} onClick={() => setView('json')}><Icon name="code" />JSON</Button>
      </div>
    </div>
    <div className="protocol-body">
    {view === 'json' ? <label className="json-editor-label"><span className="muted">Protocol JSON</span><Textarea className="protocol-editor" spellCheck={false} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} /></label> : !document ? <div className="editor-message">
      <p className="error" role="status">{parsed.kind === 'json' && parsed.message}</p>
      <Button onClick={() => setView('json')}>Edit JSON</Button>
    </div> : <>
      {extraFields && <p className="notice">Extra fields retained in JSON.</p>}
      {!document.steps.length && <p className="empty">Add the first step.</p>}
      <div className="step-table-scroll"><table className="step-table" aria-label="Protocol steps">
        <colgroup><col className="step-number-column" /><col /><col className="step-resource-column" /><col className="step-volume-column" /><col className="step-actions-column" /></colgroup>
        <thead><tr><th scope="col">Step</th><th scope="col">Operation</th><th scope="col">Resource</th><th scope="col">µL</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{document.steps.map((step, index) => <tr key={index}>
          <th scope="row">{index + 1}</th>
          <td><Select label={`Step ${index + 1} operation`} value={step.op} disabled={disabled} onChange={value => onChange(editProtocolStep(document, index, 'op', value))}
              options={[...(!Object.hasOwn(operationLabels, step.op) ? [{value:step.op,label:step.op}] : []), ...Object.entries(operationLabels).map(([value,label]) => ({value,label}))]}/></td>
          <td><Input aria-label={`Step ${index + 1} resource`} list={resourceList} value={step.resource} disabled={disabled} onChange={event => onChange(editProtocolStep(document, index, 'resource', event.target.value))} /></td>
          <td>{(step.op === 'aspirate' || step.op === 'dispense' || step.volume_ul !== undefined) ? <Input aria-label={`Step ${index + 1} volume in microliters`} type="number" step="any" value={step.volume_ul ?? ''} disabled={disabled} onChange={event => onChange(editProtocolStep(document, index, 'volume_ul', event.target.value))} /> : <span className="muted" aria-label="Not applicable">—</span>}</td>
          <td><div className="step-actions">
            <Button className="icon-button" variant="ghost" aria-label={`Move step ${index + 1} up`} title="Move up" disabled={disabled || index === 0} onClick={() => {
              const steps = [...document.steps]; [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]];
              onChange(JSON.stringify({ ...document, steps }, null, 2));
            }}><Icon name="up" /></Button>
            <Button className="icon-button" variant="ghost" aria-label={`Move step ${index + 1} down`} title="Move down" disabled={disabled || index === document.steps.length - 1} onClick={() => {
              const steps = [...document.steps]; [steps[index + 1], steps[index]] = [steps[index], steps[index + 1]];
              onChange(JSON.stringify({ ...document, steps }, null, 2));
            }}><Icon name="down" /></Button>
            <Button className="icon-button" variant="ghost" aria-label={`Remove step ${index + 1}`} title="Remove step" disabled={disabled} onClick={() => {
              const after = JSON.stringify({ ...document, steps: document.steps.filter((_, at) => at !== index) }, null, 2);
              setRemoved({ before: value, after, step: index + 1 }); onChange(after);
            }}><Icon name="trash" /></Button>
          </div></td>
        </tr>)}</tbody>
      </table></div>
      {removed?.after === value && <div className="toolbar editor-message" role="status">Step {removed.step} removed.<Button variant="ghost" disabled={disabled} onClick={() => { onChange(removed.before); setRemoved(null); }}><Icon name="undo" />Undo</Button></div>}
      <div className="toolbar editor-add"><Button variant="ghost" disabled={disabled || !nextTip} aria-describedby={!nextTip ? tipStatus : undefined} onClick={() => {
        if (!nextTip) return;
        onChange(JSON.stringify({ ...document, steps: [...document.steps, { op: 'pickup_tip', resource: nextTip }] }, null, 2));
      }}><Icon name="plus" />Add step</Button><span className="muted">{document.steps.length} / {maxSteps} steps</span>{!nextTip && <span id={tipStatus} className="muted" role="status">No unused tips in this draft.</span>}</div>
      <datalist id={resourceList}>{[...state.wells.map(well => well.id), ...state.available_tips].map(resource => <option key={resource} value={resource} />)}</datalist>
    </>}
    </div>
  </section>;
}
