// Host JSONL protocol between the Electron shell and `pero-host --stdio`.
// Source of truth for protocol/generated/; run `npm run gen:contracts` after edits.
import "@typespec/json-schema";
import "./apps.tsp";
import "./contributions.tsp";

using JsonSchema;

@jsonSchema
namespace Pero.Host;

@minLength(1) @maxLength(128) scalar ThreadId extends string;

/** Catalog key resolved by the UI from locales/*.json. */
scalar MessageKey extends string;

/** ACP payload forwarded unchanged; its shape is owned by the ACP schema. */
model AcpPayload is Record<unknown>;

/** Spread into a model to reject unknown fields, matching serde `deny_unknown_fields`. */
model Closed {
  ...Record<never>;
}

model LocalWorkerBinding {project_id:string; workspace_key:string; path:string; agent_ids:string[]; ...Closed}
model LocalWorkerSummary {id:string; name:string; url:string; bindings:LocalWorkerBinding[]; ...Closed}
model LocalWorkerConfig {id:string; name:string; url:string; token:string; bindings:LocalWorkerBinding[]; ...Closed}
model LocalWorkerStartCommand {action:"local_worker_start"; request_id:string; worker:LocalWorkerConfig; ...Closed}
model LocalWorkerStopCommand {action:"local_worker_stop"; request_id:string; ...Closed}
model LocalWorkerGetCommand {action:"local_worker_get"; request_id:string; ...Closed}
@oneOf union LocalWorkerRequest {LocalWorkerStartCommand,LocalWorkerStopCommand,LocalWorkerGetCommand}

// ---------- Host input: one JSON object per stdin line ----------

/** Bootstrap transport probe. */
model EchoRequest {
  @minLength(1) @maxLength(128) id: string;
  @minLength(1) @maxLength(4096) text: string;
  ...Closed;
}

model SetLocaleRequest {
  method: "settings.locale";
  locale: "en" | "zh-CN";
  ...Closed;
}

model ProjectBinding { @minLength(1) @maxLength(4096) workspace: string; @maxLength(128) project_id: string; ...Closed }
model LayoutPreferences {
  @minValue(320) @maxValue(640) chat_width?: uint16 = 420;
  chat_open?: boolean = false;
  ...Closed;
}
model TypographyPreferences {
  @minValue(12) @maxValue(24) ui_size?: uint8;
  @minValue(12) @maxValue(24) chat_size?: uint8 | null;
  @minValue(12) @maxValue(24) code_size?: uint8 | null;
  ...Closed
}
model WorkbenchPreferences { accent?: "teal" | "blue" | "neutral"; typography?: TypographyPreferences; appearance: "light" | "dark" | "system"; @maxItems(128) projects: ProjectBinding[]; layout?: LayoutPreferences; ...Closed }
model GetWorkbenchSettingsRequest { method: "settings.workbench.get"; ...Closed }
model SetWorkbenchSettingsRequest { method: "settings.workbench"; preferences: WorkbenchPreferences; ...Closed }

/** Internal main-process/runtime preferences; never exposed in renderer snapshots. */
model RemoteConnectionSettings {
  @minLength(1) @maxLength(2048) url: string;
  mode: "client" | "operator";
  @minLength(1) @maxLength(4096) encrypted_token: string;
  ...Closed;
}
model SetRemoteSettingsRequest {
  method: "settings.remote";
  @minLength(1) @maxLength(128) id: string;
  connection: RemoteConnectionSettings | null;
  ...Closed;
}

model ListAgentsCommand { action: "list_agents"; ...Closed }
model WorkspaceCommand { action: "workspace"; path: string; ...Closed }
model LoadRoadmapCommand { action: "load_roadmap"; ...Closed }
model AttachFilesCommand { action: "attach_files"; paths: string[]; ...Closed }
enum ContextKind { file, directory, symbol, thread, skill, image, selection, branch_diff, fetch, app_object }
model TextContextContent { type: "text"; text: string; ...Closed }
model ImageContextContent { type: "image"; data: string; mime_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; ...Closed }
@oneOf union ContextContent {TextContextContent, ImageContextContent}
model ContextCandidate { kind: ContextKind; label: string; source: string; detail: string; ...Closed }
model ContextReference { id: string; kind: ContextKind; label: string; source: string; content: ContextContent; ...Closed }
model SearchContextCommand {action: "search_context"; request_id: string; kind: ContextKind; query: string; ...Closed}
model ResolveContextCommand {action: "resolve_context"; request_id: string; kind: ContextKind; source: string; start_line?: uint32 | null; end_line?: uint32 | null; ...Closed}
model AuthenticateCommand { action: "authenticate"; thread_id: string; method_id: string; ...Closed }
model AppChatScope { app: string; panel: string; ...Closed }
model NewSessionCommand { action: "new_session"; thread_id: ThreadId; agent_id: string; scope?: AppChatScope; ...Closed }
model PromptCommand { action: "prompt"; thread_id: string; @maxLength(64000) text: string; contexts?: ContextReference[]; ...Closed }
model CancelCommand { action: "cancel"; thread_id: string; ...Closed }
model PermissionCommand {
  action: "permission";
  thread_id: string;
  request_id: string;
  option_id?: string | null;
  ...Closed;
}
model ModelCommand { action: "model"; thread_id: string; model_id: string; ...Closed }
model ConfigureCommand { action: "configure"; thread_id: ThreadId; config_id: string; value: string; ...Closed }
model CloseCommand { action: "close"; thread_id: string; ...Closed }
model DeleteCommand { action: "delete"; thread_id: ThreadId; ...Closed }

@oneOf
union HostCommand {
  ListAgentsCommand,
  WorkspaceCommand,
  LoadRoadmapCommand,
  AttachFilesCommand,
  SearchContextCommand,
  ResolveContextCommand,
  AuthenticateCommand,
  NewSessionCommand,
  PromptCommand,
  CancelCommand,
  PermissionCommand,
  ModelCommand,
  ConfigureCommand,
  CloseCommand,
  DeleteCommand,
}

@oneOf
union HostInput {
  LocalWorkerRequest,
  EchoRequest,
  SetLocaleRequest,
  SetRemoteSettingsRequest,
  GetWorkbenchSettingsRequest,
  SetWorkbenchSettingsRequest,
  HostCommand,
  Pero.Apps.AppRequest,
  Pero.Contributions.ContributionRequest,
}

// ---------- Host events: one JSON object per stdout line ----------

model EventBase {
  version: 1;
  request_id: string | null;
  text: string;
  ...Closed;
}

model SystemEventBase {
  ...EventBase;
  message_key?: MessageKey;
}

model ThreadEventBase {
  ...EventBase;
  thread_id: string;
}

/** `text` is the active locale tag. */
model SettingsEvent { kind: "settings"; ...EventBase }
model WorkbenchSettingsEvent { kind: "workbench_settings"; ...EventBase; data: WorkbenchPreferences }
/** Main-process acknowledgements contain no persisted connection payload. */
model RemoteSettingsSavedEvent { kind: "remote_settings_saved"; ...EventBase }
model RemoteSettingsErrorEvent { kind: "remote_settings_error"; ...EventBase }
model LocalWorkerState {
  status:"stopped"|"starting"|"idle"|"running"|"offline"|"stopping"|"needs_attention"|"unavailable";
  enabled:boolean; configuration:LocalWorkerSummary|null; worker_id:string; name:string; url:string;
  message:string; run_id:string|null; attempt:uint32; ...Closed
}
model LocalWorkerStateEvent {kind:"local_worker_state"; ...EventBase; data:LocalWorkerState}
model ReadyEvent { kind: "ready"; ...SystemEventBase }
/** Emitted by Electron when the Host child cannot start or exits. */
model DisconnectedEvent { kind: "disconnected"; ...SystemEventBase }
/** Emitted by Electron from the Workbench menu. */
model NoticeEvent { kind: "notice"; ...SystemEventBase }
model EchoEvent { kind: "echo"; ...EventBase }
model ErrorEvent { kind: "error"; ...SystemEventBase }

model AgentSummary {
  id: string;
  name: string;
  available: boolean;
  command: string;
  `model`: string | null;
  ...Closed;
}
/** `text` is the current workspace path. */
model AgentsEvent { kind: "agents"; ...EventBase; data: AgentSummary[] }
model ReplayData { events: ThreadEvent[]; active: string[]; ...Closed }
model ReplayEvent { kind: "replay"; ...EventBase; data: ReplayData }
/** `text` is the selected workspace path. */
model RepositoryIdentity { host: string; owner: string; name: string; ...Closed }
model WorkspaceIdentity { repository: RepositoryIdentity | null; ...Closed }
model WorkspaceEvent { kind: "workspace"; ...EventBase; data?: WorkspaceIdentity }
model RoadmapItem { line: uint32; parent_line: uint32 | null; title: string; text: string; checked: boolean; headings: string[]; ...Closed }
model LocalRoadmap { workspace: string; path: string; items: RoadmapItem[]; error: "not_found" | "read" | "invalid" | null; ...Closed }
model LocalRoadmapEvent { kind: "local_roadmap"; ...EventBase; data: LocalRoadmap }
model ContextFile { path: string; name: string; text: string; ...Closed }
model ContextCandidatesEvent {kind: "context_candidates"; ...EventBase; data: ContextCandidate[]}
model ContextResolvedEvent {kind: "context_resolved"; ...EventBase; data: ContextReference}
model ContextErrorEvent {kind: "context_error"; ...EventBase}
model ContextFilesEvent { kind: "context_files"; ...EventBase; data: ContextFile[] }
/** Read-only Desktop result-file transport. It never starts an Agent turn. */
model ContentDocumentEvent {kind:"content_document";...ThreadEventBase;data:{tool_call_id:string;artifact_id:string;status:"ready"|"error";...Closed}}

/** Main-process HTTP adapter snapshot; validated by protocol/remote.tsp. */
model RemoteSnapshotPayload is Record<unknown>;
model RemoteStateEvent { kind: "remote_state"; ...EventBase; data: RemoteSnapshotPayload }
/** Open remote tasks from the native Workbench menu or keyboard. */
model RemoteOpenEvent { kind: "remote_open"; ...EventBase }
/** Private acknowledgements intercepted by Desktop main. */
model AppsResultEvent { kind: "apps_result"; ...EventBase; data: Pero.Apps.AppResult }
model AppsCatalogEvent { kind: "apps_catalog"; ...EventBase; data: Pero.Apps.AppRecord[] }
model AppsErrorEvent { kind: "apps_error"; ...EventBase }
model AppOpenedData { name: string; panel: string; url: string; ...Closed; }
model AppsOpenedEvent { kind: "apps_opened"; ...EventBase; data: AppOpenedData }

model SessionCreatedData { agent: string; workspace: string; scope?: AppChatScope; appBinding?: Pero.Apps.AppSessionBinding; ...Closed }
model SessionCreatedEvent { kind: "session_created"; ...ThreadEventBase; data: SessionCreatedData }
model UserMessageContext {contexts: ContextReference[]; ...Closed}
model UserMessageEvent { kind: "user_message"; ...ThreadEventBase; data?: UserMessageContext }
model SessionConnectingEvent { kind: "session_connecting"; ...ThreadEventBase }
/** `data` is the ACP InitializeResponse. */
model AgentInfoEvent { kind: "agent_info"; ...ThreadEventBase; data: AcpPayload }
model AuthRequiredData { authMethods: AcpPayload[]; ...Closed }
model SessionAuthRequiredEvent { kind: "session_auth_required"; ...ThreadEventBase; data: AuthRequiredData }
model AuthErrorData { methodId: string; ...Closed }
model SessionAuthErrorEvent { kind: "session_auth_error"; ...ThreadEventBase; data?: AuthErrorData }
model SessionAuthenticatedData { sessionId: string; ...Closed }
model SessionAuthenticatedEvent { kind: "session_authenticated"; ...ThreadEventBase; data: SessionAuthenticatedData }
/** `data` is the ACP NewSessionResponse, with configOptions refreshed after model selection. */
model SessionReadyEvent { kind: "session_ready"; ...ThreadEventBase; data: AcpPayload }
/** `data` is the ACP SessionUpdate. */
model SessionUpdateEvent { kind: "session_update"; ...ThreadEventBase; data: AcpPayload }
/** Provider measurements: context occupancy and cumulative session cost. */
model UsageCost { @minValue(0) amount: float64; @pattern("^[A-Z]{3}$") currency: string; ...Closed }
model SessionUsage {
  @minValue(0) context_used?: integer;
  @minValue(1) context_capacity?: integer;
  @minValue(0) input_tokens?: integer;
  @minValue(0) output_tokens?: integer;
  cost?: UsageCost;
  ...Closed;
}
model SessionUsageEvent { kind: "session_usage"; ...ThreadEventBase; data: SessionUsage }
/** The ACP RequestPermissionRequest plus the Host-issued `permission_id`. */
model PermissionData { ...Record<unknown>; permission_id: string }
model PermissionEvent { kind: "permission"; ...ThreadEventBase; data: PermissionData }
model PromptQueuedData { position: int32; ...Closed }
model PromptQueuedEvent { kind: "prompt_queued"; ...ThreadEventBase; data: PromptQueuedData }
model CommandRejectedData { count: int32; ...Closed }
model CommandRejectedEvent { kind: "command_rejected"; ...ThreadEventBase; data?: CommandRejectedData }
model TurnStartedEvent { kind: "turn_started"; ...ThreadEventBase }
/** `text` is the stop reason; `data` is the ACP PromptResponse. */
model TurnFinishedEvent { kind: "turn_finished"; ...ThreadEventBase; data: AcpPayload }
/** `data` is the ACP SetSessionConfigOptionResponse. */
model ModelChangedEvent { kind: "model_changed"; ...ThreadEventBase; data: AcpPayload }
model SettingChoice { value: string; label: string; description: string; ...Closed }
model SessionSetting { id: string; name: string; category: string; current: string; choices: SettingChoice[]; ...Closed }
model SessionSettings { options: SessionSetting[]; ...Closed }
model ConfigurationChangedEvent { kind: "configuration_changed"; ...ThreadEventBase; data: SessionSettings }
model SessionErrorEvent { kind: "session_error"; ...ThreadEventBase }
model SessionClosedEvent { kind: "session_closed"; ...ThreadEventBase }
model SessionDeletedEvent { kind: "session_deleted"; ...ThreadEventBase }

/** Events persisted to the session journal and replayed to the UI. */
@oneOf
union ThreadEvent {
  TurnStartedEvent,
  SessionCreatedEvent,
  UserMessageEvent,
  SessionUpdateEvent,
  SessionUsageEvent,
  SessionReadyEvent,
  ModelChangedEvent,
  ConfigurationChangedEvent,
  TurnFinishedEvent,
  SessionErrorEvent,
  SessionClosedEvent,
  SessionDeletedEvent,
}

model ContributorStateEvent { kind: "contributor_state"; ...EventBase; data: RemoteSnapshotPayload }
model ContributorSessionData { task_id: string; workspace: string; agent_id?: string; ...Closed }
model ContributorSessionEvent { kind: "contributor_session"; ...ThreadEventBase; data: ContributorSessionData }

@oneOf
union HostEvent {
  ContentDocumentEvent,
  LocalWorkerStateEvent,
  ContributorStateEvent,
  ContributorSessionEvent,
  Pero.Contributions.ContributionResultEvent,
  Pero.Contributions.ContributionErrorEvent,
  SettingsEvent,
  WorkbenchSettingsEvent,
  RemoteSettingsSavedEvent,
  RemoteSettingsErrorEvent,
  ReadyEvent,
  DisconnectedEvent,
  NoticeEvent,
  EchoEvent,
  ErrorEvent,
  AgentsEvent,
  ReplayEvent,
  WorkspaceEvent,
  LocalRoadmapEvent,
  ContextFilesEvent,
  ContextCandidatesEvent,
  ContextResolvedEvent,
  ContextErrorEvent,
  RemoteStateEvent,
  RemoteOpenEvent,
  AppsResultEvent,
  AppsCatalogEvent,
  AppsErrorEvent,
  AppsOpenedEvent,
  ThreadEvent,
  SessionConnectingEvent,
  AgentInfoEvent,
  SessionAuthRequiredEvent,
  SessionAuthErrorEvent,
  SessionAuthenticatedEvent,
  PermissionEvent,
  PromptQueuedEvent,
  CommandRejectedEvent,
}
