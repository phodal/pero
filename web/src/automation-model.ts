import type { AutomationCapacityStatus, AutomationControl, AutomationDefinition, AutomationRunRequest, AutomationState } from '../../protocol/generated/host';

export function currentDefinitions(state: AutomationState): AutomationDefinition[] {
  const latest = new Map<string, AutomationDefinition>();
  for (const definition of state.definitions) {
    if ((latest.get(definition.id)?.revision ?? 0) < definition.revision) latest.set(definition.id, definition);
  }
  return [...latest.values()];
}
export function checkInput(content: string, limit: number): void {
  if (!content.trim()) throw new Error('Enter input content.');
  if (new TextEncoder().encode(content).length > limit) throw new Error(`Input exceeds ${limit} bytes.`);
}

// Presentation choices only; Host remains the authority for accepting commands.
export function inputPresentation(definition: AutomationDefinition): { editable: boolean; pinnedRevision: string | null } {
  if (definition.trigger.kind === 'time' && definition.input === 'process_exact') {
    return { editable: false, pinnedRevision: definition.trigger.exact?.revision ?? 'Unavailable' };
  }
  return { editable: true, pinnedRevision: null };
}
export function cancellationLabel(status: string): string | null {
  if (status === 'reconcile') return 'Request cancellation';
  return ['pending', 'input_unavailable', 'definition_changed', 'reserved', 'running', 'cancel_requested'].includes(status) ? 'Cancel' : null;
}

export function requestIdentity(request: Pick<AutomationRunRequest, 'id' | 'reprocess_of'>): string {
  return request.reprocess_of ? `${request.id} · Reprocess of ${request.reprocess_of}` : request.id;
}

export function canReviewOutcome(request: Pick<AutomationRunRequest, 'status' | 'execution_id'>): boolean {
  return !!request.execution_id && ['reconcile', 'cancel_requested'].includes(request.status.kind);
}
export function requestStatus(request: Pick<AutomationRunRequest, 'status' | 'operator_reconciliation'>): string {
  return request.status.kind === 'reconciled' && request.operator_reconciliation
    ? `Reconciled · operator-reported ${request.operator_reconciliation.disposition.replaceAll('_', ' ')}`
    : request.status.kind === 'not_started' ? 'Not started' : request.status.kind;
}
export function checkReconciliation(evidence: string, executionStopped: boolean, effectsChecked: boolean): void {
  if (!evidence.trim()) throw new Error('Describe the evidence for this outcome.');
  if (new TextEncoder().encode(evidence).length > 4096) throw new Error('Evidence exceeds 4096 bytes.');
  if (!executionStopped || !effectsChecked) throw new Error('Confirm both execution and side-effect checks.');
}

const capacityNotes = {
  requests: 'New runs blocked; accepted pending work can still run.',
  events: 'New events blocked; accepted work is retained.',
  snapshots: 'New input snapshots blocked; existing inputs remain usable.',
  definitions: 'New definitions blocked; existing automations are unaffected.',
  dispatches: 'New executions blocked; existing running work is unaffected.',
};
export function capacityPresentation(capacity: AutomationCapacityStatus): {counts:string; notes:string} {
  const keys=['requests','events','snapshots','definitions','dispatches'] as const;
  return {
    counts:keys.map(key=>`${key}: ${capacity[key].used}/${capacity[key].limit}`).join(' · '),
    notes:capacity.exhausted.map(key=>capacityNotes[key]).join(' '),
  };
}
export function definitionStatus(definition: AutomationDefinition, control: AutomationControl | undefined, capacity: AutomationCapacityStatus): string {
  if (control?.revoked) return 'Revoked';
  if (control?.paused) return 'Paused';
  const blocked:string[]=[];
  if(capacity.exhausted.includes('requests')) blocked.push('new runs blocked');
  if(capacity.exhausted.includes('dispatches')) blocked.push('new executions blocked');
  if(definition.trigger.kind==='event' && capacity.exhausted.includes('events')) blocked.push('new events blocked');
  return ['Enabled',...blocked].join(' · ');
}
