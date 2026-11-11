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
model AppPluginAssembly { app: AppName; revision: string; instructions: string; tools: AppWriteRoute[]; maxCalls: uint32; hostBudgeted?: boolean; ...AppClosed; }
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
model DeclaredAppPanel {id:AppName;title:string;...AppClosed}
model DeclaredAppAction {name:AppName;description:string;...AppClosed}
model DeclaredCanvasView {id:AppName;title:string;inputs:AppDocumentSchema;...AppClosed}
model InstalledAppViews {canvases?:DeclaredCanvasView[];app:AppName;title:string;version:string;revision:string;enabled:boolean;panels:DeclaredAppPanel[];actions:DeclaredAppAction[];...AppClosed}
model AppSdkContext {name:AppName;version:string;permissions:AppSdkPermissions;appViews?:InstalledAppViews[];...AppClosed}
model AppApiAccess {action:"apiaccess";name:AppName;path:string;...RequestBase}
model AppSdkRequest {action:"sdkcontext";name:AppName;...RequestBase}
model CanvasBinding {id:string;app:AppName;panel:AppName;view:AppName;declaration:string;inputs:AppDocumentSchema;...AppClosed}
@minValue(1) @maxValue(2147483647) scalar NotebookRevision extends uint32;
model CanvasSource {entryId:string;revision:NotebookRevision;blockId:string;binding:CanvasBinding;readOnly:boolean;...AppClosed}
model CanvasMount {operation:"mount";source:CanvasSource;...AppClosed}
model CanvasRead {operation:"read";instance:string;...AppClosed}
model CanvasRelease {operation:"release";instance:string;...AppClosed}
model CanvasPrepare {operation:"prepare";instance:string;operationId:string;action:AppName;params:AppDocumentSchema;...AppClosed}
model CanvasDecide {operation:"decide";instance:string;operationId:string;ticket:string;allow:boolean;...AppClosed}
model CanvasStatus {operation:"status";instance:string;operationId:string;...AppClosed}
model CanvasCancel {operation:"cancel";instance:string;operationId:string;...AppClosed}
@oneOf union CanvasOperation {CanvasMount,CanvasRead,CanvasRelease,CanvasPrepare,CanvasDecide,CanvasStatus,CanvasCancel}
model AppCanvasRequest {action:"canvas";name:AppName;request:CanvasOperation;...RequestBase}
model CanvasField {label:string;value:string;...AppClosed}
model CanvasActionInput {name:string;label:string;maxLength:uint32;...AppClosed}
model CanvasAction {name:AppName;label:string;params:AppDocumentSchema;inputs?:CanvasActionInput[];...AppClosed}
model CanvasProjection {title:string;fields:CanvasField[];columns:string[];rows:string[][];notice:string;actions:CanvasAction[];...AppClosed}
model CanvasHistoryItem {operationId:string;action:AppName;state:string;...AppClosed}
model CanvasReply {history?:CanvasHistoryItem[];state?:string;instance?:string;source?:CanvasSource;`projection`?:CanvasProjection;ticket?:string;summary?:string;message?:string;receipt?:AppDocumentSchema;...AppClosed}
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
/** Static UI access without dependency preparation or backend startup. */
model ResolveStaticApp { action: "resolve_static"; name: AppName; ...RequestBase; }
model NotebookProjectLink {projectId:string;entryId:string;revision:NotebookRevision;expectedRevision:string|null;linked:boolean;readOnly:boolean;...AppClosed}
model NotebookProjectsList {operation:"list";...AppClosed}
model NotebookProjectsChange {operation:"review"|"apply";change:NotebookProjectLink;...AppClosed}
@oneOf union NotebookProjectsOperation {NotebookProjectsList,NotebookProjectsChange}
model NotebookProjectsApp {action:"notebook-projects";name:AppName;request:NotebookProjectsOperation;...RequestBase}
model NotebookProjectEntryRef {id:string;revision:string;...AppClosed}
model NotebookProjectSummary {id:string;title:string;entries:NotebookProjectEntryRef[];...AppClosed}
model NotebookSavedEntry {id:string;title:string;revision:string;...AppClosed}
model NotebookProjectsReply {state?:string;summary?:string;projects?:NotebookProjectSummary[];entries?:NotebookSavedEntry[];...AppClosed}
model ProjectResourcesApp { action: "projectresources"; name: AppName; ...RequestBase; }
/** An App catalog observation; revisions do not claim complete experimental provenance. */
model ProjectResourceReference { app: string; kind: string; id: string; revision: string; ...AppClosed; }
model ProjectResourceSummary { reference: ProjectResourceReference; title: string; summary: string; status: string; verification?: string | null; location: string; ...AppClosed; }
model ProjectResourceCatalog { app: string; resources: ProjectResourceSummary[]; error?: string | null; ...AppClosed; }
model ConnectorsApp { action: "connectors"; name: AppName; ...RequestBase; }
/** User-managed inventory; skill instructions do not grant execution permissions. */
@minLength(1) @maxLength(2048) scalar SkillMarketId extends string;
model SkillMarketRead { operation: "catalog" | "installed"; ...AppClosed; }
model SkillMarketEntryOperation { operation: "install" | "remove" | "check-update"; id: SkillMarketId; ...AppClosed; }
@minLength(40) @maxLength(40) @pattern("^[0-9a-fA-F]{40}$") scalar SkillRevision extends string;
@minLength(64) @maxLength(64) @pattern("^[0-9a-fA-F]{64}$") scalar SkillDigest extends string;
/** Update installs exactly the revision and content digest returned by check-update. */
model SkillMarketUpdateOperation { operation: "update"; id: SkillMarketId; revision: SkillRevision; sha256: SkillDigest; ...AppClosed; }
model SkillMarketEnable { operation: "enable"; id: SkillMarketId; enabled: boolean; ...AppClosed; }
model SkillMarketCancel { operation: "cancel"; id: SkillMarketId; ...AppClosed; }
model SkillMarketRollback { operation: "rollback"; id: SkillMarketId; revision?: string; ...AppClosed; }
@oneOf union SkillMarketOperation { SkillMarketRead, SkillMarketEntryOperation, SkillMarketUpdateOperation, SkillMarketEnable, SkillMarketRollback, SkillMarketCancel }
model SkillMarketApp { action: "skillsmarket"; name: AppName; request: SkillMarketOperation; ...RequestBase; }
model SkillMarketCategories is Record<string>;
model SkillMarketCatalog {
  schema_version: uint32; generated_at: string; issue_url: string; source_document: unknown;
  collection_status?: "collecting" | "complete"; categories?: SkillMarketCategories;
  sources: AppDocumentSchema[]; skills: AppDocumentSchema[]; resources: AppDocumentSchema[];
  exclusions: AppDocumentSchema[]; stats: AppDocumentSchema;
  ...AppClosed;
}
model SkillMarketSelection { id: string; revision: string; ...AppClosed; }
model InstalledMarketSkill {
  id: string; revision: string; enabled: boolean; selected: boolean; invocation: string;
  previousRevision?: string; versions: string[]; entry?: AppDocumentSchema;
  ...AppClosed;
}
model SkillMarketInstalled { items: InstalledMarketSkill[]; supportedAgent: "pero"; ...AppClosed; }
model SkillMarketUpdate { id: string; currentRevision: SkillRevision; latestRevision: SkillRevision; latestSha256: SkillDigest; updateAvailable: boolean; ...AppClosed; }
model SkillMarketCancelled { cancelled: true; ...AppClosed; }
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
/** Software observations only; does not allocate or approve scientific execution. */
model EnvironmentInspectionApp {
  action: "environment";
  name: AppName;
  target: "paper-agent.pcgym" | "control-lab.python-control" | "control-lab.ngspice" | "lcms2yield.inference";
  ...RequestBase;
}
model EnvironmentInspectionReport {
  schema: "pero.environment.inspection.v1";
  method: "paper-agent.pcgym" | "control-lab.python-control" | "control-lab.ngspice" | "lcms2yield.inference";
  scope: "configured-interpreter";
  evidence: "metadata_only";
  observed_at_ms: uint64;
  profile: AppDocumentSchema;
  requirements: AppDocumentSchema;
  matched: boolean;
  missing: AppDocumentSchema[];
  ...AppClosed;
}
model LocalEnvironmentCreate { operation:"create";target:"paper-agent.pcgym"|"control-lab.python-control"|"control-lab.ngspice"|"lcms2yield.inference";label:string;...AppClosed; }
model LocalEnvironmentList { operation:"list";compute?:boolean;...AppClosed; }
model LocalEnvironmentPrepare { operation:"prepare";id:AppName;...AppClosed; }
model LocalEnvironmentCancel { operation:"cancel";id:AppName;...AppClosed; }
model LocalEnvironmentPropose { operation:"propose";source:string;...AppClosed; }
model EnvironmentDeclaration {name:string;sha256:string;...AppClosed;}
model EnvironmentProposal {source:string;declarations:EnvironmentDeclaration[];python_requests:string[];dependencies:string[];locked_packages:int32;warnings:string[];status:"review_required";digest:string;...AppClosed;}
model LocalEnvironmentBind { operation:"bind";id:AppName;...AppClosed; }
model LocalEnvironmentCreateLocked { operation:"create_locked";target:"paper-agent.pcgym"|"control-lab.python-control";label:string;...AppClosed; }
model LocalEnvironmentCreateLockedControl { operation:"create_locked_control";label:string;...AppClosed; }
model LocalEnvironmentRebuild { operation:"rebuild";id:AppName;label:string;...AppClosed; }
model LocalEnvironmentBindCompute { operation:"bind_compute";id:AppName;...AppClosed; }
model LocalEnvironmentUnbindCompute { operation:"unbind_compute";target?:"paper-agent.pcgym"|"control-lab.python-control";...AppClosed; }
@oneOf union LocalEnvironmentOperation { LocalEnvironmentCreate,LocalEnvironmentList,LocalEnvironmentPrepare,LocalEnvironmentCancel,LocalEnvironmentPropose,LocalEnvironmentBind,LocalEnvironmentCreateLockedControl,LocalEnvironmentCreateLocked,LocalEnvironmentRebuild,LocalEnvironmentBindCompute,LocalEnvironmentUnbindCompute }
model ComputePackages is Record<string>;
model PythonComputeObservation { version:string;build:string;platform:string;machine:string;executable_sha256:string;packages:ComputePackages;packages_sha256:string;...AppClosed; }
model LockedPythonProfile { root:string;project_sha256:string;lock_sha256:string;python_request:string;python_archive_url:string;python_archive_sha256:string;uv_version:string;uv_sha256:string;observation:PythonComputeObservation;...AppClosed; }
model LocalEnvironmentApp {action:"localenvironment";name:AppName;request:LocalEnvironmentOperation;...RequestBase;}
model PreparationFailure {stage:"bootstrap"|"resolve"|"install"|"observe"|"cancelled"|"interrupted";detail:string;...AppClosed;}
model LocalEnvironmentRecord {failure?:PreparationFailure|null;locked_compute?:boolean;prepared?:LockedPythonProfile|null;id:AppName;label:string;target:"paper-agent.pcgym"|"control-lab.python-control"|"control-lab.ngspice"|"lcms2yield.inference";dependencies:string[];state:"created"|"preparing"|"ready"|"failed";log:string[];error:string|null;bound:boolean;...AppClosed;}
@oneOf union AppRequest { NotebookProjectsApp, AppCanvasRequest, SkillMarketApp, LocalEnvironmentApp, EnvironmentInspectionApp, AppApiAccess, AppSdkRequest, ListApps, InstallApp, ListAgentPlugins, InstallAgentPlugin, EnableAgentPlugin, AgentRunCommand, AgentCatalogCommand, PrepareApp, EnableApp, DisableApp, UninstallApp, ResolveApp, ResolveStaticApp, ProjectResourcesApp, AgentApp, ConnectorsApp, AutomationApp, ResearchAssetsApp }
model AppGrant { permitted: true; ...AppClosed; }
model AppSuccess { ok: true; value: NotebookProjectsReply | CanvasReply | SkillMarketCatalog | SkillMarketInstalled | SkillMarketUpdate | SkillMarketCancelled | LocalEnvironmentRecord[] | EnvironmentProposal | EnvironmentInspectionReport | AgentPreparedContext | AgentTerminalList | AppSdkContext | AgentRun | AgentRunTranscript | AgentRunLookupReply | AgentRunOpenReply | AgentCatalogReply | AutomationApiReply | AppRecord[] | AgentPluginSummary[] | AgentPluginSummary | AppAccess | ProjectResourceCatalog | AppAgentInfo | AppAgentStarted | AppAgentTranscript | AppAgentCancelled | AppGrant | ResearchAssetReply | ResearchBundleReply; ...AppClosed; }
model AppFailure { ok: false; error: string; ...AppClosed; }
@oneOf union AppResult { AppSuccess, AppFailure }

/** Dependency preparation is separate from backend startup. */
model AppPreparation { name: AppName; phase: "required" | "checking" | "creating" | "installing" | "ready" | "failed"; message: string; ...AppClosed; }
