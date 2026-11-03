/** A lossless document for editing. The Lab backend owns protocol validation. */
export type StepDraft = { op: string; resource: string; volume_ul?: number; [key: string]: unknown };
export type ProtocolDraft = { steps: StepDraft[]; [key: string]: unknown };
export type StepEditorState = { kind: 'steps'; document: ProtocolDraft } | { kind: 'json'; message: string };

export const operationLabels: Record<string, string> = {
  pickup_tip: 'Pick up tip', return_tip: 'Return tip', aspirate: 'Aspirate', dispense: 'Dispense',
};

export function readStepEditor(source: string): StepEditorState {
  let document: unknown;
  try { document = JSON.parse(source); } catch { return { kind: 'json', message: 'Protocol must be valid JSON. Edit the JSON before using the step editor.' }; }
  if (!document || typeof document !== 'object' || Array.isArray(document) || !('steps' in document) || !Array.isArray(document.steps)) {
    return { kind: 'json', message: 'The step editor needs a protocol object with a steps array. Your JSON is unchanged.' };
  }
  if (document.steps.some(step => !step || typeof step !== 'object' || Array.isArray(step)
    || typeof step.op !== 'string' || typeof step.resource !== 'string'
    || ('volume_ul' in step && (typeof step.volume_ul !== 'number' || !Number.isFinite(step.volume_ul))))) {
    return { kind: 'json', message: 'Some step fields need JSON editing. Keep each operation and resource as text, and volume as a number. Your JSON is unchanged.' };
  }
  return { kind: 'steps', document: document as ProtocolDraft };
}

export function editProtocolStep(document: ProtocolDraft, index: number, field: 'op' | 'resource' | 'volume_ul', value: string): string {
  const step = { ...document.steps[index] };
  if (field === 'volume_ul') {
    if (value === '') delete step.volume_ul;
    else {
      const volume = Number(value);
      if (!Number.isFinite(volume)) throw new Error('Volume must be a number.');
      step.volume_ul = volume;
    }
  } else {
    step[field] = value;
    if (field === 'op') {
      if (value === 'pickup_tip' || value === 'return_tip') delete step.volume_ul;
      else if (step.volume_ul === undefined) step.volume_ul = 50;
    }
  }
  return JSON.stringify({ ...document, steps: document.steps.map((item, at) => at === index ? step : item) }, null, 2);
}

export function describeStep(step: Pick<StepDraft, 'op' | 'resource' | 'volume_ul'>): string {
  const label = Object.hasOwn(operationLabels, step.op) ? operationLabels[step.op] : step.op;
  if (step.op === 'aspirate') return `${label} ${step.volume_ul ?? '—'} µL from ${step.resource}`;
  if (step.op === 'dispense') return `${label} ${step.volume_ul ?? '—'} µL into ${step.resource}`;
  return `${label} ${step.resource}`;
}
