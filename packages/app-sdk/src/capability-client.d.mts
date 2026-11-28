export type CapabilityAvailability = 'advertised' | 'unavailable';
export type CapabilityAuthorization = 'declared' | 'denied' | 'consent';
export type CapabilityOutcomeName = 'ready' | 'incompatible' | 'offline' | 'denied' | 'requires-consent' | 'unsupported';

export interface CapabilityOperationVersion { readonly version: number }
export interface CapabilitySnapshot {
  readonly protocolVersion: number;
  readonly providerGeneration: string;
  readonly availability: CapabilityAvailability;
  readonly authorization: CapabilityAuthorization;
  readonly operations: Readonly<Record<string, CapabilityOperationVersion>>;
}
export interface CapabilitySnapshotInput {
  protocolVersion?: number;
  providerGeneration: string;
  availability?: CapabilityAvailability;
  authorization?: CapabilityAuthorization;
  operations: Record<string, CapabilityOperationVersion>;
}
export function createCapabilitySnapshot(input: CapabilitySnapshotInput): CapabilitySnapshot;
export function capabilityOutcome(snapshot: CapabilitySnapshot | null | undefined, capability: string, operation: string): CapabilityOutcomeName;

export type CorrelationResult = 'accepted' | 'late' | 'duplicate';
export interface CorrelationRequestOptions { timeoutMs?: number; generation?: string }
export interface Correlation {
  request(id: string, send: () => void, options?: CorrelationRequestOptions): Promise<unknown>;
  receive(message: unknown): CorrelationResult;
  revoke(generation: string): void;
  dispose(): void;
  pending(): number;
}
export function createCorrelation(): Correlation;

export interface CapabilityCallMeta { correlationId?: string; generation?: string }
export interface CapabilityTransport {
  call(capability: string, operation: string, input: Record<string, unknown>, meta?: CapabilityCallMeta): Promise<unknown>;
  revoke?(generation: string): void;
  dispose?(): void;
}

export interface CapabilityMessageEvent { origin: string; source: unknown; data: unknown }
export interface FrameTransportOptions {
  postMessage: (message: unknown, targetOrigin: string) => void;
  targetOrigin: string;
  source?: unknown;
  addEventListener?: (type: 'message', listener: (event: CapabilityMessageEvent) => void) => void;
  removeEventListener?: (type: 'message', listener: (event: CapabilityMessageEvent) => void) => void;
  timeoutMs?: number;
  correlation?: Correlation;
}
export interface FrameTransport extends CapabilityTransport { readonly correlation: Correlation }
export function createFrameTransport(options: FrameTransportOptions): FrameTransport;
export function createLocalCapabilityTransport(fetchImpl?: typeof globalThis.fetch): Pick<CapabilityTransport, 'call'>;

export interface CapabilityHandle {
  readonly generation: string;
  call(capability: string, operation: string, input?: Record<string, unknown>): Promise<unknown>;
}
export interface ObservedCapabilityCall { capability: string; operation: string; correlationId: string }
export interface CapabilityClient {
  snapshot(): CapabilitySnapshot;
  outcome(capability: string, operation: string): CapabilityOutcomeName;
  handle(): CapabilityHandle;
  call(capability: string, operation: string, input?: Record<string, unknown>): Promise<unknown>;
  rebind(next: CapabilitySnapshot): CapabilitySnapshot;
  subscribe(listener: (event: { type: 'rebind'; previous: CapabilitySnapshot; next: CapabilitySnapshot }) => void): () => void;
  dispose(): void;
  observedCalls(): ObservedCapabilityCall[];
}
export function createCapabilityClient(options: { transport: CapabilityTransport; snapshot: CapabilitySnapshot }): CapabilityClient;
