import "@typespec/json-schema";
using JsonSchema;
@jsonSchema
namespace Pero.Apps;

model AppClosed { ...Record<never>; }
@minLength(1) @maxLength(64) @pattern("^[a-z0-9]+(?:-[a-z0-9]+)*$") scalar AppName extends string;
@minLength(1) @maxLength(128) scalar RequestId extends string;

model AppPanel { id: AppName; title: string; entry: string; ...AppClosed; }
/** Public catalog: no local paths or backend credentials. */
model AppDocumentSchema is Record<unknown>;
model AppWriteRoute { name: AppName; description: string; path: string; schema: AppDocumentSchema; ...AppClosed; }
model AppRecord {
  name: AppName;
  version: string;
  displayName: string;
  description: string;
  enabled: boolean;
  tenure: "optional" | "required";
  panels: AppPanel[];
  writes?: AppWriteRoute[];
  ...AppClosed;
}
/** Host-to-main-process descriptor. Never forwarded to App or Workbench renderers. */
model BackendAccess { url: string; token: string; ...AppClosed; }
model AppAccess { root: string; entry: string; backend?: BackendAccess; ...AppClosed; }
model RequestBase { method: "apps"; id: RequestId; ...AppClosed; }
model ListApps { action: "list"; ...RequestBase; }
model InstallApp { action: "install"; path: string; ...RequestBase; }
model PointConfig { action: "pointconfig"; name: AppName; config?: AppDocumentSchema; ...RequestBase; }
model PointConfigReply { config: AppDocumentSchema; ...AppClosed; }
model PointProjectHeaders is Record<string>;
model PointProjectRequest { method: "GET" | "POST"; path: string; headers?: PointProjectHeaders; body?: unknown; ...AppClosed; }
model PointProjects { action: "pointprojects"; name: AppName; request: PointProjectRequest; ...RequestBase; }
model PointProjectReply { status: int32; headers: PointProjectHeaders; body: unknown; ...AppClosed; }
model PointScope { workspaceId:string; ...AppClosed; }
model PointBinding {scope:PointScope;requestId:string;harnessId:string;panel:string;runtimeDigest:string;createdAt:string;context?:AppDocumentSchema;...AppClosed}
model PointAttempt {requestId:string;text:string;attempt:uint32;updatedAt:string;...AppClosed}
model PointStart {operation:"start";scope:PointScope;requestId:string;text:string;harnessId?:string;context?:AppDocumentSchema;...AppClosed}
model PointLookup {operation:"lookup";scope:PointScope;requestId:string;...AppClosed}
model PointStatus {operation:"status";scope:PointScope;runId:string;...AppClosed}
model PointEvents {operation:"events";scope:PointScope;runId:string;after?:uint64;...AppClosed}
model PointCancel {operation:"cancel";scope:PointScope;runId:string;...AppClosed}
model PointRetry {operation:"retry";scope:PointScope;runId:string;requestId:string;text?:string;...AppClosed}
model PointOpen {operation:"open";sessionId:string;...AppClosed}
@oneOf union PointAgentRequest {PointStart,PointLookup,PointStatus,PointEvents,PointCancel,PointRetry,PointOpen}
model PointAgent {action:"pointagent";name:AppName;request:PointAgentRequest;...RequestBase}
model PointCatalog {action:"pointcatalog";name:AppName;path:"/api/workspaces"|"/api/harnesses";...RequestBase}
model PointRun {id:string;sessionId:string;scope:PointScope;status:"running"|"needs_input"|"cancelling"|"completed"|"failed"|"cancelled"|"interrupted";attempt:uint32;requestId:string;updatedAt:string;error?:string;stopReason?:string;...AppClosed}
model PointProjectedEvent {seq:uint64;type:string;data:unknown;...AppClosed}
model PointTranscript {run:PointRun;events:PointProjectedEvent[];cursor:uint64;...AppClosed}
model PointLookupReply {requestId:string;run:PointRun|null;...AppClosed}
model PointOpenReply {sessionId:string;...AppClosed}
model PointWorkspace {workspaceId:string;title:string;path:string;...AppClosed}
model PointHarness {id:string;name:string;available:boolean;...AppClosed}
model PointCatalogReply {items:(PointWorkspace|PointHarness)[];...AppClosed}
model EnableApp { action: "enable"; name: AppName; ...RequestBase; }
model DisableApp { action: "disable"; name: AppName; ...RequestBase; }
model UninstallApp { action: "uninstall"; name: AppName; ...RequestBase; }
model ResolveApp { action: "resolve"; name: AppName; ...RequestBase; }
model ConnectorsApp { action: "connectors"; name: AppName; ...RequestBase; }
model AgentInfoRequest { operation: "info"; ...AppClosed; }
model AgentStartRequest { operation: "start"; @minLength(1) @maxLength(48) @pattern("^[a-zA-Z0-9_-]+$") requestId: string; @minLength(1) @maxLength(128000) prompt: string; agentId: string; ...AppClosed; }
model AgentEventsRequest { operation: "events"; sessionId: string; after: uint32; ...AppClosed; }
model AgentCancelRequest { operation: "cancel"; sessionId: string; ...AppClosed; }
@oneOf union AgentRequest { AgentInfoRequest, AgentStartRequest, AgentEventsRequest, AgentCancelRequest }
model AgentApp { action: "agent"; name: AppName; request: AgentRequest; ...RequestBase; }
model AppAgentSummary { id: string; name: string; available: boolean; ...AppClosed; }
model AppAgentInfo { available: boolean; workspace: string; agents: AppAgentSummary[]; ...AppClosed; }
model AppAgentStarted { sessionId: string; ...AppClosed; }
enum AppAgentStatus { running, text, needs_input, completed, cancelled, failed }
model AppAgentEvent { kind: AppAgentStatus; text: string; ...AppClosed; }
model AppAgentTranscript { events: AppAgentEvent[]; cursor: uint32; status: AppAgentStatus; text: string; ...AppClosed; }
model AppAgentCancelled { cancelled: true; ...AppClosed; }
model AppSessionBinding { app: AppName; requestId: string; agentId: string; prompt: string; point?:PointBinding; ...AppClosed; }
model AutomationApiRequest {method:"GET"|"POST"|"PUT"|"DELETE";path:string;body?:unknown;...AppClosed}
model AutomationApp {action:"automation";name:AppName;request:AutomationApiRequest;...RequestBase}
model AutomationApiReply {status:uint16;body:unknown;...AppClosed}
@oneOf union AppRequest { ListApps, InstallApp, PointConfig, PointProjects, PointAgent, PointCatalog, EnableApp, DisableApp, UninstallApp, ResolveApp, AgentApp, ConnectorsApp, AutomationApp }
model AppGrant { permitted: true; ...AppClosed; }
model AppSuccess { ok: true; value: PointRun | PointTranscript | PointLookupReply | PointOpenReply | PointCatalogReply | AutomationApiReply | PointProjectReply | PointConfigReply | AppRecord[] | AppAccess | AppAgentInfo | AppAgentStarted | AppAgentTranscript | AppAgentCancelled | AppGrant; ...AppClosed; }
model AppFailure { ok: false; error: string; ...AppClosed; }
@oneOf union AppResult { AppSuccess, AppFailure }

/** Dependency preparation is separate from backend startup. */
model AppPreparation { name: AppName; phase: "checking" | "creating" | "installing" | "ready" | "failed"; message: string; ...AppClosed; }
