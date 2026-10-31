import type { AutomationDefinition, AutomationRunRequest, AutomationState } from '../../protocol/generated/host';

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
