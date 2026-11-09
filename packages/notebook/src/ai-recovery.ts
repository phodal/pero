import { isStructuredTable } from './structured-table.ts';
import { validateAISources } from './ai-sources.ts';
import type { FrozenGeneration } from './ai-generation.ts';
import type { CellDecision, FrozenTypedGeneration } from './ai-proposals.ts';
export const aiStatuses = ['starting', 'unknown', 'running', 'needs_input', 'cancelling', 'completed', 'failed', 'cancelled', 'unavailable'] as const;
export type AIStatus = typeof aiStatuses[number];
/** A local durable record of Host identity and human review, never a second execution owner. */
export interface AIRecovery {
  frozen: FrozenGeneration | FrozenTypedGeneration;
  sessionId: string;
  status: AIStatus;
  transcript: string;
  decisions: Record<string, CellDecision>;
  application: 'reviewing' | 'applying' | 'applied' | 'dismissed';
}
export interface AIWorkspace { version: number; record: AIRecovery | null }
export function isTypedGeneration(frozen: FrozenGeneration | FrozenTypedGeneration): frozen is FrozenTypedGeneration { return 'mode' in frozen && frozen.mode === 'cells'; }
export function isAIUnresolved(record: AIRecovery): boolean { return !['completed', 'failed', 'cancelled'].includes(record.status); }
export async function recoveredAIWorkspace(raw: unknown): Promise<AIWorkspace> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid AI recovery response.');
  const value = raw as AIWorkspace;
  if (!Number.isSafeInteger(value.version) || value.version < 0 || !(value.record === null || value.record && typeof value.record === 'object' && aiStatuses.includes(value.record.status) && typeof value.record.sessionId === 'string' && typeof value.record.transcript === 'string' && value.record.frozen && typeof value.record.frozen.content === 'string' && typeof value.record.frozen.prompt === 'string' && value.record.frozen.target && typeof value.record.frozen.target.entryId === 'string' && ['reviewing', 'applying', 'applied', 'dismissed'].includes(value.record.application) && value.record.decisions && Object.values(value.record.decisions).every(item => ['pending', 'accepted', 'rejected'].includes(item)))) throw new Error('Stored AI recovery cannot be interpreted. It has not been overwritten.');
  if (value.record && isTypedGeneration(value.record.frozen)) {
    const frozen = value.record.frozen;
    if (!frozen.table || !['inputTable', 'registrationTable'].includes(frozen.table.kind) || typeof frozen.table.blockId !== 'string' || !isStructuredTable(frozen.table.table) || !Array.isArray(frozen.sources) || typeof frozen.goal !== 'string' || typeof frozen.emptyOnly !== 'boolean') throw new Error('Stored typed proposal is invalid. It has not been overwritten.');
    await validateAISources(frozen.sources);
  }
  return value;
}
