export interface RunObservationRequest {
  binding: { kind: string; ownerHost: string; project: string; id: string; path?: string };
  request: { operation: string; requestId: string; inputHash: string; consumerClosed?: boolean };
  prompt?: string;
  fallbackHost?: string;
  knownStatus?: string;
}

export interface RunObservation {
  status: string;
  outcome: string;
  effect: string;
  cursor?: number;
  events: number[];
  continuation: string;
}

export interface RunObservationTransport {
  observe(request: RunObservationRequest): Promise<RunObservation & { ownerHost?: string; bindingId?: string }>;
}

export function observeRun(transport: RunObservationTransport, request: RunObservationRequest): Promise<RunObservation>;
