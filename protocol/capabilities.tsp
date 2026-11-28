// Canonical capability metadata and the P0.1 wire samples.
// Source of truth for protocol/generated/capabilities.*. Run `npm run gen:contracts`.
// This file does not import protocol/host.tsp. Host JSONL stays the shell protocol.
// It does not rename CapabilitySelection, ComposerCapabilities, or WorkerCapability.
import "@typespec/json-schema";
using JsonSchema;

@jsonSchema
namespace Pero.Capabilities;

/** Spread to reject unknown fields, matching serde deny_unknown_fields. */
model Closed { ...Record<never>; }

/** Data-owned research identity. Same 64 lowercase hex rule as the Host parser. */
@minLength(64) @maxLength(64) @pattern("^[a-f0-9]{64}$") scalar ResearchId extends string;

@minLength(1) @maxLength(64) scalar CapabilityId extends string;
@minLength(1) @maxLength(64) scalar OperationName extends string;
@minValue(0) @maxValue(4294967295) scalar ProtocolVersion extends uint32;

/**
 * Host App Agent scope. The executing parser stores only workspaceId.
 * The SDK type also allows projectId; that field is not on this wire.
 */
model AgentWorkspaceScope {
  workspaceId: string;
  ...Closed;
}

/** Body of POST /host/app-agent after the shell merges the envelope operation. */
model AgentStatusRequest {
  operation: "status";
  scope: AgentWorkspaceScope;
  runId: string;
  ...Closed;
}

/** Input object inside the legacy capability envelope. The shell adds operation. */
model AgentStatusInput {
  scope: AgentWorkspaceScope;
  runId: string;
  ...Closed;
}

/** POST /host/capability body for the agent status read. */
model AgentStatusCall {
  capability: "agent";
  operation: "status";
  input: AgentStatusInput;
  ...Closed;
}

/**
 * Projection returned by the Host App Agent status read.
 * Same fields as the Host Run serializer. No result object is emitted.
 */
model AgentStatusResponse {
  id: string;
  sessionId: string;
  scope: AgentWorkspaceScope;
  status: "running" | "needs_input" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
  @minValue(0) @maxValue(4294967295) attempt: uint32;
  requestId: string;
  updatedAt: string;
  error?: string;
  stopReason?: string;
  ...Closed;
}

/**
 * Host research-assets read. operation is the Host name `queries`.
 * A queryId reads one saved Data query. Omitting it lists saved queries.
 * protocol/apps.tsp still documents only start, status and cancel.
 */
model ResearchAssetsQueriesRequest {
  operation: "queries";
  queryId?: ResearchId;
  ...Closed;
}

model ResearchQueryReceipt {
  queryId: ResearchId;
  status: "completed" | "failed" | "cancelled" | "running" | "interrupted";
  reason: string;
  rows: unknown[];
  rowCount: uint32 | null;
  truncated: boolean;
  elapsedSeconds?: float64 | null;
  resultId?: ResearchId;
  ...Closed;
}

/** Domain documents keep their own fields. The envelope itself is closed. */
model ResearchQueryDocument is Record<unknown>;

model ResearchQueryDefinition {
  sql: string;
  unit: string;
  denominator: string;
  ...Record<unknown>;
}

/**
 * Data evidence() object returned unchanged by the Host queries read.
 * acceptance stays needs_review; a successful read is not scientific approval.
 */
model ResearchAssetsQueriesResponse {
  id: ResearchId;
  intent: ResearchQueryDocument;
  receipt: ResearchQueryReceipt;
  snapshot: ResearchQueryDocument;
  definition: ResearchQueryDefinition;
  acceptance: "needs_review";
  ...Closed;
}

/** Structured error for the capability contract. Current shells still return text. */
model CapabilityError {
  code: "missing_version" | "version_mismatch" | "unknown_operation" | "invalid_input" | "unavailable" | "denied" | "failed";
  message: string;
  capability?: CapabilityId;
  operation?: OperationName;
  ...Closed;
}

model ProviderIdentity {
  id: string;
  incarnation: string;
  ...Closed;
}

/** Advertised scope. state is not authorization. */
model ScopedAvailability {
  scopeKind: "workspace" | "project" | "app" | "device" | "unscoped";
  scopeId?: string;
  state: "advertised" | "unavailable";
  ...Closed;
}

model OperationDescriptor {
  name: OperationName;
  @minValue(1) @maxValue(4294967295) version: uint32;
  effect: "read" | "write" | "control" | "observe";
  exposure: "local_only" | "transport_neutral" | "remotely_exposable" | "privileged";
  ...Closed;
}

/** Stable capability advertisement. Declaring it grants nothing. */
model CapabilityDescriptor {
  id: CapabilityId;
  protocolVersion: ProtocolVersion;
  operations: OperationDescriptor[];
  provider: ProviderIdentity;
  availability: ScopedAvailability;
  ...Closed;
}

/**
 * Negotiation document. protocolVersion is required here and is not added to
 * legacy operation bodies. declaredHost is the existing permissions.host list.
 * advertised records a manifest or provider advertisement. Neither is a grant.
 */
model CapabilityNegotiation {
  protocolVersion: ProtocolVersion;
  capability: CapabilityId;
  operation: OperationName;
  declaredHost: string[];
  advertised: boolean;
  ...Closed;
}

/** Successful negotiation still grants nothing. */
model CapabilityAdmission {
  outcome: "accepted";
  grant: false;
  ...Closed;
}

@oneOf
union CapabilityWire {
  AgentStatusCall,
  AgentStatusRequest,
  AgentStatusResponse,
  ResearchAssetsQueriesRequest,
  ResearchAssetsQueriesResponse,
  CapabilityError,
  CapabilityNegotiation,
  CapabilityDescriptor,
  CapabilityAdmission,
}
