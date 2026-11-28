/* Generated from protocol/capabilities.tsp by scripts/codegen/contracts.mjs. Do not edit. */

/**
 * Generated from protocol/capabilities.tsp. Do not edit.
 */
export type CapabilityProtocol = CapabilityWire;
export type CapabilityWire =
  | AgentStatusCall
  | AgentStatusRequest
  | AgentStatusResponse
  | ResearchAssetsQueriesRequest
  | ResearchAssetsQueriesResponse
  | CapabilityError
  | CapabilityNegotiation
  | CapabilityDescriptor
  | CapabilityAdmission;
/**
 * Data-owned research identity. Same 64 lowercase hex rule as the Host parser.
 */
export type ResearchId = string;
export type CapabilityId = string;
export type OperationName = string;
export type ProtocolVersion = number;

/**
 * POST /host/capability body for the agent status read.
 */
export interface AgentStatusCall {
  capability: "agent";
  operation: "status";
  input: AgentStatusInput;
}
/**
 * Input object inside the legacy capability envelope. The shell adds operation.
 */
export interface AgentStatusInput {
  scope: AgentWorkspaceScope;
  runId: string;
}
/**
 * Host App Agent scope. The executing parser stores only workspaceId.
 * The SDK type also allows projectId; that field is not on this wire.
 */
export interface AgentWorkspaceScope {
  workspaceId: string;
}
/**
 * Body of POST /host/app-agent after the shell merges the envelope operation.
 */
export interface AgentStatusRequest {
  operation: "status";
  scope: AgentWorkspaceScope;
  runId: string;
}
/**
 * Projection returned by the Host App Agent status read.
 * Same fields as the Host Run serializer. No result object is emitted.
 */
export interface AgentStatusResponse {
  id: string;
  sessionId: string;
  scope: AgentWorkspaceScope;
  status: "running" | "needs_input" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
  attempt: number;
  requestId: string;
  updatedAt: string;
  error?: string;
  stopReason?: string;
}
/**
 * Host research-assets read. operation is the Host name `queries`.
 * A queryId reads one saved Data query. Omitting it lists saved queries.
 * protocol/apps.tsp still documents only start, status and cancel.
 */
export interface ResearchAssetsQueriesRequest {
  operation: "queries";
  queryId?: ResearchId;
}
/**
 * Data evidence() object returned unchanged by the Host queries read.
 * acceptance stays needs_review; a successful read is not scientific approval.
 */
export interface ResearchAssetsQueriesResponse {
  id: ResearchId;
  intent: ResearchQueryDocument;
  receipt: ResearchQueryReceipt;
  snapshot: ResearchQueryDocument;
  definition: ResearchQueryDefinition;
  acceptance: "needs_review";
}
/**
 * Domain documents keep their own fields. The envelope itself is closed.
 */
export interface ResearchQueryDocument {
  [k: string]: unknown | undefined;
}
export interface ResearchQueryReceipt {
  queryId: ResearchId;
  status: "completed" | "failed" | "cancelled" | "running" | "interrupted";
  reason: string;
  rows: unknown[];
  rowCount: number | null;
  truncated: boolean;
  elapsedSeconds?: number | null;
  resultId?: ResearchId;
}
export interface ResearchQueryDefinition {
  sql: string;
  unit: string;
  denominator: string;
  [k: string]: unknown | undefined;
}
/**
 * Structured error for the capability contract. Current shells still return text.
 */
export interface CapabilityError {
  code:
    | "missing_version"
    | "version_mismatch"
    | "unknown_operation"
    | "invalid_input"
    | "unavailable"
    | "denied"
    | "failed";
  message: string;
  capability?: CapabilityId;
  operation?: OperationName;
}
/**
 * Negotiation document. protocolVersion is required here and is not added to
 * legacy operation bodies. declaredHost is the existing permissions.host list.
 * advertised records a manifest or provider advertisement. Neither is a grant.
 */
export interface CapabilityNegotiation {
  protocolVersion: ProtocolVersion;
  capability: CapabilityId;
  operation: OperationName;
  declaredHost: string[];
  advertised: boolean;
}
/**
 * Stable capability advertisement. Declaring it grants nothing.
 */
export interface CapabilityDescriptor {
  id: CapabilityId;
  protocolVersion: ProtocolVersion;
  operations: OperationDescriptor[];
  provider: ProviderIdentity;
  availability: ScopedAvailability;
}
export interface OperationDescriptor {
  name: OperationName;
  version: number;
  effect: "read" | "write" | "control" | "observe";
  exposure: "local_only" | "transport_neutral" | "remotely_exposable" | "privileged";
}
export interface ProviderIdentity {
  id: string;
  incarnation: string;
}
/**
 * Advertised scope. state is not authorization.
 */
export interface ScopedAvailability {
  scopeKind: "workspace" | "project" | "app" | "device" | "unscoped";
  scopeId?: string;
  state: "advertised" | "unavailable";
}
/**
 * Successful negotiation still grants nothing.
 */
export interface CapabilityAdmission {
  outcome: "accepted";
  grant: false;
}
