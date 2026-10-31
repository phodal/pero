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
model AppSessionBinding { app: AppName; requestId: string; agentId: string; prompt: string; ...AppClosed; }
@oneOf union AppRequest { ListApps, InstallApp, PointConfig, EnableApp, DisableApp, UninstallApp, ResolveApp, AgentApp, ConnectorsApp }
model AppGrant { permitted: true; ...AppClosed; }
model AppSuccess { ok: true; value: PointConfigReply | AppRecord[] | AppAccess | AppAgentInfo | AppAgentStarted | AppAgentTranscript | AppAgentCancelled | AppGrant; ...AppClosed; }
model AppFailure { ok: false; error: string; ...AppClosed; }
@oneOf union AppResult { AppSuccess, AppFailure }

/** Dependency preparation is separate from backend startup. */
model AppPreparation { name: AppName; phase: "checking" | "creating" | "installing" | "ready" | "failed"; message: string; ...AppClosed; }
