import type { AutomationDefinition, AutomationState } from '../../protocol/generated/host';

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
