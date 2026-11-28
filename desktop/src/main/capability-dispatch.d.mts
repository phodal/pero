export type CapabilityErrorCode = 'invalid_input' | 'unknown_operation';

export interface CapabilityDispatchError {
  code: CapabilityErrorCode;
  message: string;
  capability?: string;
  operation?: string;
}

export interface CapabilityForward {
  ok: true;
  route: string;
  body: Record<string, unknown>;
  owner: string;
  injectOperation: boolean;
}

export type DispatchDecision = CapabilityForward | { ok: false; error: CapabilityDispatchError };
export type DirectDecision = { ok: true } | { ok: false; error: CapabilityDispatchError };

/** Route a legacy {capability, operation, input} envelope. A route is not a grant. */
export function dispatchEnvelope(value: unknown): DispatchDecision;
/** Admit a direct family body. Insights stays unnamed; automation rejects an injected operation. */
export function directOperation(path: string, body: unknown): DirectDecision;
export function capabilityErrorBody(error: CapabilityDispatchError): {
  code: CapabilityErrorCode;
  message: string;
  capability?: string;
  operation?: string;
};
export function capabilityErrorResponse(error: CapabilityDispatchError): Response;
