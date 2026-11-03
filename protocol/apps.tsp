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
model AppPluginAssembly { app: AppName; revision: string; instructions: string; tools: AppWriteRoute[]; maxCalls: uint32; ...AppClosed; }
model AgentPluginRevision { name: AppName; version: string; revision: string; ...AppClosed; }
model AgentPluginSummary { ...AgentPluginRevision; enabled: boolean; ...AppClosed; }
model AppRecord {
  name: AppName;
  version: string;
  revision: string;
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
model AppAccess { root: string; entry: string; frameOrigins?: string[]; backend?: BackendAccess; ...AppClosed; }
model AppSdkPermissions {api:string[];events:string[];host:string[];...AppClosed}
model AppSdkContext {name:AppName;version:string;permissions:AppSdkPermissions;...AppClosed}
model AppApiAccess {action:"apiaccess";name:AppName;path:string;...RequestBase}
model AppSdkRequest {action:"sdkcontext";name:AppName;...RequestBase}
model RequestBase { method: "apps"; id: RequestId; ...AppClosed; }
model ListApps { action: "list"; ...RequestBase; }
model InstallApp { action: "install"; path: string; ...RequestBase; }
model ListAgentPlugins { action: "pluginlist"; ...RequestBase; }
model InstallAgentPlugin { action: "plugininstall"; path: string; ...RequestBase; }
model EnableAgentPlugin { action: "pluginenable"; name: AppName; enabled: boolean; ...RequestBase; }
model AgentScope { workspaceId:string; ...AppClosed; }
model AgentRunBinding {scope:AgentScope;requestId:string;harnessId:string;panel:string;runtimeDigest:string;appRevision?:string;createdAt:string;context?:AppDocumentSchema;...AppClosed}
model AgentRunAttempt {requestId:string;text:string;attempt:uint32;updatedAt:string;...AppClosed}
model AgentRunPrepare {operation:"prepare";scope:AgentScope;input:AppDocumentSchema;...AppClosed}
model AgentPreparedContext {context:AppDocumentSchema;...AppClosed}
model AgentRunTerminal {operation:"terminal";scope:AgentScope;runId:string;terminalId?:string;offset?:uint32;count?:uint32;...AppClosed}
model AgentTerminalStatus {kind:string;exitCode?:int32;signal?:string;...AppClosed}
model AgentTerminal {sessionId:string;name?:string;type:string;status:AgentTerminalStatus;...AppClosed}
model AgentTerminalList {terminals:AgentTerminal[];...AppClosed}
model AgentRunStart {operation:"start";scope:AgentScope;requestId:string;text:string;harnessId?:string;context?:AppDocumentSchema;...AppClosed}
model AgentRunLookup {operation:"lookup";scope:AgentScope;requestId:string;...AppClosed}
model AgentRunStatus {operation:"status";scope:AgentScope;runId:string;...AppClosed}
model AgentRunEvents {operation:"events";scope:AgentScope;runId:string;after?:uint64;...AppClosed}
model AgentRunCancel {operation:"cancel";scope:AgentScope;runId:string;...AppClosed}
model AgentRunRetry {operation:"retry";scope:AgentScope;runId:string;requestId:string;text?:string;...AppClosed}
model AgentRunOpen {operation:"open";sessionId:string;...AppClosed}
@oneOf union AgentRunRequest {AgentRunPrepare,AgentRunTerminal,AgentRunStart,AgentRunLookup,AgentRunStatus,AgentRunEvents,AgentRunCancel,AgentRunRetry,AgentRunOpen}
model AgentRunCommand {action:"agentrun";name:AppName;request:AgentRunRequest;...RequestBase}
model AgentCatalogCommand {action:"agentcatalog";name:AppName;path:"/api/workspaces"|"/api/harnesses";...RequestBase}
model AgentRun {id:string;sessionId:string;scope:AgentScope;status:"running"|"needs_input"|"cancelling"|"completed"|"failed"|"cancelled"|"interrupted";attempt:uint32;requestId:string;updatedAt:string;error?:string;stopReason?:string;...AppClosed}
model AgentRunEvent {seq:uint64;type:string;data:unknown;...AppClosed}
model AgentRunTranscript {run:AgentRun;events:AgentRunEvent[];cursor:uint64;...AppClosed}
model AgentRunLookupReply {requestId:string;run:AgentRun|null;...AppClosed}
model AgentRunOpenReply {sessionId:string;...AppClosed}
model AgentWorkspace {workspaceId:string;title:string;path:string;...AppClosed}
model AgentHarness {id:string;name:string;available:boolean;...AppClosed}
model AgentCatalogReply {items:(AgentWorkspace|AgentHarness)[];...AppClosed}
model PrepareApp { action: "prepare"; name: AppName; ...RequestBase; }
model EnableApp { action: "enable"; name: AppName; ...RequestBase; }
model DisableApp { action: "disable"; name: AppName; ...RequestBase; }
model UninstallApp { action: "uninstall"; name: AppName; ...RequestBase; }
model ResolveApp { action: "resolve"; name: AppName; ...RequestBase; }
model ProjectResourcesApp { action: "projectresources"; name: AppName; ...RequestBase; }
/** An App catalog observation; revisions do not claim complete experimental provenance. */
model ProjectResourceReference { app: string; kind: string; id: string; revision: string; ...AppClosed; }
model ProjectResourceSummary { reference: ProjectResourceReference; title: string; summary: string; status: string; verification?: string | null; location: string; ...AppClosed; }
model ProjectResourceCatalog { app: string; resources: ProjectResourceSummary[]; error?: string | null; ...AppClosed; }
model ConnectorsApp { action: "connectors"; name: AppName; ...RequestBase; }
/** Paper may request only saved research identities; Host owns the fixed Data target. */
@minLength(64) @maxLength(64) @pattern("^[a-f0-9]{64}$") scalar ResearchId extends string;
model ResearchAssetStart { operation: "start"; bundleId: ResearchId; assetId: ResearchId; ...AppClosed; }
model ResearchAssetLookup { operation: "status" | "cancel"; bundleId: ResearchId; assetId?: ResearchId; ...AppClosed; }
@oneOf union ResearchAssetsRequest { ResearchAssetStart, ResearchAssetLookup }
model ResearchAssetsApp { action: "research-assets"; name: AppName; request: ResearchAssetsRequest; ...RequestBase; }
/** Data owns the domain source/job/catalog documents. The handoff has no private paths or tokens. */
model ResearchAssetReply {
  source: AppDocumentSchema | null;
  download: AppDocumentSchema | null;
  asset: AppDocumentSchema | null;
  receipt: AppDocumentSchema;
  ...AppClosed;
}
model ResearchBundleReply { bundleId: ResearchId; assets: ResearchAssetReply[]; ...AppClosed; }
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
model AppSessionBinding { app: AppName; requestId: string; agentId: string; prompt: string; run?:AgentRunBinding; ...AppClosed; }
model AutomationApiRequest {method:"GET"|"POST"|"PUT"|"DELETE";path:string;body?:unknown;...AppClosed}
model AutomationApp {action:"automation";name:AppName;request:AutomationApiRequest;...RequestBase}
model AutomationApiReply {status:uint16;body:unknown;...AppClosed}
@oneOf union AppRequest { AppApiAccess, AppSdkRequest, ListApps, InstallApp, ListAgentPlugins, InstallAgentPlugin, EnableAgentPlugin, AgentRunCommand, AgentCatalogCommand, PrepareApp, EnableApp, DisableApp, UninstallApp, ResolveApp, ProjectResourcesApp, AgentApp, ConnectorsApp, AutomationApp, ResearchAssetsApp }
model AppGrant { permitted: true; ...AppClosed; }
model AppSuccess { ok: true; value: AgentPreparedContext | AgentTerminalList | AppSdkContext | AgentRun | AgentRunTranscript | AgentRunLookupReply | AgentRunOpenReply | AgentCatalogReply | AutomationApiReply | AppRecord[] | AgentPluginSummary[] | AgentPluginSummary | AppAccess | ProjectResourceCatalog | AppAgentInfo | AppAgentStarted | AppAgentTranscript | AppAgentCancelled | AppGrant | ResearchAssetReply | ResearchBundleReply; ...AppClosed; }
model AppFailure { ok: false; error: string; ...AppClosed; }
@oneOf union AppResult { AppSuccess, AppFailure }

/** Dependency preparation is separate from backend startup. */
model AppPreparation { name: AppName; phase: "required" | "checking" | "creating" | "installing" | "ready" | "failed"; message: string; ...AppClosed; }
