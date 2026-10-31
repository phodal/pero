import type { Discovery, DirectoryEntry, Reply } from './connector-types';

export type ConnectorDetailState = {
  phase: 'closed' | 'editing'; generation: number; request: number; activeRequest: 'discover' | 'install.run' | null; editRevision: number; discardArmed: boolean;
  detailConnectorId: string | null; detailProviderId: string | null; connectorIdField: string;
  definitionText: string; baseline: string; editMode: 'form' | 'json';
  secretReference: string; fieldError: { field?: string; message: string } | null; discovery: Discovery;
};
export type InstallJob = { state: 'running' | 'done' | 'failed' | 'cancelled'; log: string; exitCode: number | null };
export type DetailField = 'connectorIdField' | 'definitionText' | 'editMode' | 'secretReference' | 'fieldError';
export type DetailRequest = { kind: 'request'; operation: 'discover' | 'install.run'; providerId: string;
  generation: number; request: number; editRevision: number };
export type DetailEffect = DetailRequest | { kind: 'notice'; key: 'busy' | 'unsaved'; error: boolean } | { kind: 'closed' }
  | { kind: 'poll'; providerId: string; generation: number } | { kind: 'cancel'; providerId: string };
export type DetailEvent = { type: 'opened'; initial: Partial<ConnectorDetailState>; discover?: boolean }
  | { type: 'close.requested'; busy: boolean; force?: boolean }
  | { type: 'field.changed'; field: DetailField; value: ConnectorDetailState[DetailField] }
  | { type: 'saved'; generation: number; connectorId: string; text: string }
  | { type: 'manual.requested' | 'discovery.requested' | 'install.requested' }
  | { type: 'request.completed'; effect: DetailRequest; reply: Reply; error?: string; provider?: DirectoryEntry }
  | { type: 'install.progress'; generation: number; job: InstallJob | null } | { type: 'install.cancel' };
export function emptyDiscovery(): Discovery;
export function initialConnectorDetail(): ConnectorDetailState;
export function updateConnectorDetail(state: ConnectorDetailState, event: DetailEvent): { state: ConnectorDetailState; effects: DetailEffect[] };
