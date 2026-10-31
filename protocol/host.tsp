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

// Standalone workspace documents are UI content, outside Agent history.
model ConversationOrigin {kind:"conversation";thread_id:string;...Closed}
model FileOrigin {kind:"file";path:string;...Closed}
model AppOrigin {kind:"app";app:string;panel:string;...Closed}
model McpOrigin {kind:"mcp";server:string;thread_id:string;...Closed}
@oneOf union ContentOrigin {ConversationOrigin,FileOrigin,AppOrigin,McpOrigin}
model DocumentSource {id:string;title:string;origin:ContentOrigin;...Closed}
model PlainContentFormat {kind:"json"|"json_lines"|"text"|"markdown";...Closed}
model CodeContentFormat {kind:"code";language:string;...Closed}
@oneOf union ContentFormat {PlainContentFormat,CodeContentFormat}
model DocumentHeader {source:DocumentSource;revision:safeint;format:ContentFormat;...Closed}
model OpenFileDocument {method:"documents";action:"open";request_id:string;path:string;...Closed}
model FollowFileDocument {method:"documents";action:"follow";request_id:string;source:string;href:string;...Closed}
model SaveFileDocument {method:"documents";action:"save";request_id:string;source:string;revision:safeint;text:string;...Closed}
model FileCopy {path:string;text:string;protected_sources:string[];...Closed}
model SaveAsFileDocument {method:"documents";action:"save_as";request_id:string;copy:FileCopy;...Closed}
model SaveDraftFileDocument {method:"documents";action:"save_draft";request_id:string;draft:DraftRef;...Closed}
model SaveAsReferenceFileDocument {method:"documents";action:"save_as_reference";request_id:string;path:string;source:SourceKey;draft:DraftRef|null;protected_sources:string[];...Closed}
model ChooseDocumentSave {action:"choose_document_save";request_id:string;suggested:string;...Closed}
model ReleaseFileDocument {method:"documents";action:"release";source:string;...Closed}
@oneOf union FileDocumentRequest {OpenFileDocument,FollowFileDocument,SaveFileDocument,SaveAsFileDocument,SaveDraftFileDocument,SaveAsReferenceFileDocument,ReleaseFileDocument}
model DocumentSaveChooseEvent {kind:"document_save_choose";...EventBase}
model DocumentSavePathEvent {kind:"document_save_path";...EventBase;data:{path:string;...Closed}}
model DocumentSaveCancelledEvent {kind:"document_save_cancelled";...EventBase}
model DocumentChooseEvent {kind:"document_choose";...EventBase}
model ReaderLocation {record:uint32;...Closed}
model LocatedDocumentHeader {header:DocumentHeader;location:ReaderLocation;...Closed}
model DocumentOpenEvent {kind:"document_open";...EventBase;data:DocumentHeader|LocatedDocumentHeader}
model FileDocumentEvent {kind:"document_file";...EventBase;data:DocumentHeader}
model FileDocumentErrorEvent {kind:"document_error";...EventBase;data:{source:string;reason:"conflict"|"unsupported"|"unavailable"|"read_write";...Closed}}

// Durable recovery is separate from tool execution and Desktop preference settings.
model ReaderRange {start:safeint;end:safeint;...Closed}
model ReaderSearch {case_insensitive:boolean;regex:boolean;whole_word:boolean;...Closed}
model ReaderState {source_revision?:safeint|null;source:boolean;selection:ReaderRange;scroll:[float64,float64];preview_scroll:[float64,float64];preview_reveal?:ReaderRange|null;query:string;search_open:boolean;search:ReaderSearch;folded_lines:safeint[];path:ReaderRange[];...Closed}
model WorkspaceSimpleItem {kind:"conversation"|"web"|"project"|"task";value:string;...Closed}
model WorkspaceDocumentItem {kind:"document";value:{origin:ContentOrigin;source:string;...Closed};...Closed}
model WorkspaceAppItem {kind:"app";value:{name:string;panel:string;...Closed};...Closed}
@oneOf union WorkspaceItem {WorkspaceSimpleItem,WorkspaceDocumentItem,WorkspaceAppItem}
scalar WorkbenchPage extends string;
model WorkspacePageRoute {kind:"page";value:"conversation"|"document"|"web"|"projects"|"agents"|"tasks"|"workers"|"apps"|"insights"|"connections";...Closed}
model WorkspaceContentRoute {kind:"content";value:WorkspaceItem;...Closed}
@oneOf union WorkspaceRoute {WorkspacePageRoute,WorkspaceContentRoute}
// Legacy route-only history and one-item leaves migrate only while reading local checkpoints.
union PaneItemKind {"primary","rendered_preview"}
model HistoryEntry {route:WorkspaceRoute;reading?:ReaderState|null;preview?:boolean;view_kind?:PaneItemKind;...Closed}
model WorkspaceHistory {reading:ReaderState|null;preview?:boolean;view_kind?:PaneItemKind;back:HistoryEntry[];forward:HistoryEntry[];...Closed}
model PaneItem {id:safeint;route:WorkspaceRoute;kind?:PaneItemKind;reading?:ReaderState|null;...Closed}
model PaneTabSet {items:PaneItem[];active:safeint|null;preview:safeint|null;pinned_count:safeint;activation_history:safeint[];history:WorkspaceHistory;closed:HistoryEntry[];...Closed}
model PaneLeaf {id:safeint;tabs:PaneTabSet;...Closed}
model PaneLeafNode {kind:"leaf";view:PaneLeaf;...Closed}
model PaneSplitNode {kind:"split";id:safeint;axis:"horizontal"|"vertical";ratio:float64;first:PaneNode;second:PaneNode;...Closed}
@oneOf union PaneNode {PaneLeafNode,PaneSplitNode}
model PaneLayout {root:PaneNode|null;focused:safeint|null;next_id:safeint;next_view_id:safeint;...Closed}
model WorkspaceSnapshot {items:WorkspaceItem[];route:WorkspaceRoute;other:WorkspaceRoute|null;focused:"left"|"right";panes:PaneLayout;...WorkspaceHistory}
model SourceKey {origin:ContentOrigin;source:string;revision:safeint;...Closed}
model DraftRef {source:SourceKey;version:safeint;...Closed}
model DraftEdit {old:ReaderRange;inserted:string;...Closed}
model SavedDocument {header:DocumentHeader;reading:ReaderState;draft:string|null;draft_ref?:DraftRef|null;legacy_draft?:boolean;...Closed}
model InlineHtml {id:string;title:string;html:string;...Closed}
model SavedWeb {id:string;url:string;html?:InlineHtml;...Closed}
model WorkspaceSession {version:1;workspace:string;navigation:WorkspaceSnapshot;documents:SavedDocument[];web:SavedWeb[];...Closed}
model WorkspaceSource {header:DocumentHeader;text:string;...Closed}
model WorkspaceRestore {session:WorkspaceSession|null;sources:WorkspaceSource[];conflicts:string[];unavailable:SourceKey[];...Closed}
model GetWorkspaceSession {method:"workspace";action:"get";...Closed}
model SaveWorkspaceSession {method:"workspace";action:"save";request_id:string;refresh:SourceKey[];session:WorkspaceSession;sources:WorkspaceSource[];...Closed}
model ReadWorkspaceSource {method:"workspace";action:"read";request_id:string;key:SourceKey;...Closed}
model ResetWorkspaceSession {method:"workspace";action:"reset";request_id:string;...Closed}
model SourceChunk {offset:safeint;text:string;done:boolean;...Closed}
model BeginWorkspaceSource {method:"workspace";action:"source_begin";request_id:string;header:DocumentHeader;total_bytes:safeint;...Closed}
model AppendWorkspaceSource {method:"workspace";action:"source_chunk";request_id:string;chunk:SourceChunk;...Closed}
model StoreWorkspaceDraft {method:"workspace";action:"store_draft";request_id:string;base:DraftRef|null;draft:DraftRef;edits:DraftEdit[];...Closed}
@oneOf union WorkspaceSessionRequest {GetWorkspaceSession,SaveWorkspaceSession,ReadWorkspaceSource,ResetWorkspaceSession,BeginWorkspaceSource,AppendWorkspaceSource,StoreWorkspaceDraft}
model WorkspaceRestoredEvent {kind:"workspace_restored";...EventBase;data:WorkspaceRestore}
model WorkspaceSavedEvent {kind:"workspace_saved";...EventBase}
model WorkspaceErrorEvent {kind:"workspace_error";...EventBase}
model WorkspaceSourceEvent {kind:"workspace_source";...EventBase;data:{source:WorkspaceSource;conflict:boolean;draft?:string|null;...Closed}}
model WorkspaceSourceErrorEvent {kind:"workspace_source_error";...EventBase;data:{key:SourceKey;draft?:string|null;...Closed}}
model WorkspaceResetEvent {kind:"workspace_reset";...EventBase}
model WorkspaceSourceStoredEvent {kind:"workspace_source_stored";...EventBase}
model DraftStoredEvent {kind:"draft_stored";...EventBase;data:DraftRef}

// Browser engines supply navigation observations; workspace IDs remain stable.
model WebLoading {kind:"loading";...Closed}
model WebReady {kind:"ready";...Closed}
model WebFailed {kind:"failed";message:string;...Closed}
@oneOf union WebLoad {WebLoading,WebReady,WebFailed}
model WebObservation {url:string;title:string;load:WebLoad;can_back:boolean;can_forward:boolean;notice?:string;...Closed}
model WebDocument {id:string;observation:WebObservation;html?:InlineHtml;...Closed}
model WebOpenedEvent {kind:"web_opened";...EventBase;data:WebDocument}
model WebStateEvent {kind:"web_state";...EventBase;data:WebDocument}
model WebClosedEvent {kind:"web_closed";...EventBase;data:{id:string;...Closed}}
model WebErrorEvent {kind:"web_error";...EventBase}
model WebChooseEvent {kind:"web_choose";...EventBase}
model WebOpenCommand {action:"web_open";url:string;...Closed}
model WebHtmlCommand {action:"web_html";source:InlineHtml;...Closed}
model WebRestoreCommand {action:"web_restore";id:string;url:string;html?:InlineHtml|null;...Closed}
model WebNavigateCommand {action:"web_navigate";id:string;url:string;...Closed}
model WebControlCommand {action:"web_back"|"web_forward"|"web_reload"|"web_close";id:string;...Closed}
model SurfaceBounds {x:float64;y:float64;width:float64;height:float64;...Closed}
model WebSurfaceCommand {action:"web_surface";id:string|null;bounds?:SurfaceBounds;...Closed}
model WebSurfaceSlot {id:string;bounds:SurfaceBounds;focused:boolean;...Closed}
model WebSurfacesCommand {action:"web_surfaces";surfaces:WebSurfaceSlot[];...Closed}
model WebFocusedEvent {kind:"web_focused";...EventBase;data:{id:string;...Closed}}
/** Private Desktop/native browser-engine commands, not Host stdin. */
@oneOf union WebCommand {WebOpenCommand,WebHtmlCommand,WebRestoreCommand,WebNavigateCommand,WebControlCommand,WebSurfaceCommand,WebSurfacesCommand}
model IconVariants {light:string;dark?:string;...Closed}
model IconGlyphMap is Record<IconVariants>;
model IconAssociationMap is Record<string>;
model IconThemeAssociations {kinds?:IconAssociationMap;languages?:IconAssociationMap;filenames?:IconAssociationMap;extensions?:IconAssociationMap;apps?:IconAssociationMap;...Closed}
model IconThemePackage {version:1;id:string;name:string;icons:IconGlyphMap;associations:IconThemeAssociations;...Closed}
model IconThemeInfo {id:string;name:string;...Closed}
model IconThemeState {installed:IconThemeInfo[];selected:string|null;theme:IconThemePackage|null;...Closed}
model GetIconThemes {method:"icons";action:"get";request_id:string;...Closed}
model InstallIconTheme {method:"icons";action:"install";request_id:string;path:string;...Closed}
model SelectIconTheme {method:"icons";action:"select";request_id:string;id:string|null;...Closed}
model RemoveIconTheme {method:"icons";action:"remove";request_id:string;id:string;...Closed}
@oneOf union IconThemeRequest {GetIconThemes,InstallIconTheme,SelectIconTheme,RemoveIconTheme}
model IconThemesEvent {kind:"icon_themes"|"icon_themes_error";...EventBase;data:IconThemeState}
model McpSourceRequest {method:"mcp";action:"open";request_id:string;thread_id?:string|null;...Closed}
model McpAppBinding {id:string;server:string;resource_uri:string;tool:string;tool_call:string;thread_id:string;...Closed}
model McpPermittedEvent {kind:"mcp_permitted";...EventBase;thread_id?:string;data:{locale:string;...Closed}}
model McpSourcesEvent {kind:"mcp_sources";...EventBase;thread_id?:string;data:{url:string;...Closed}}
model McpErrorEvent {kind:"mcp_error";...EventBase}
model McpAppOpenedEvent {kind:"mcp_app_opened";...ThreadEventBase;data:McpAppBinding}

// User-managed non-secret MCP configuration, scoped to one local ACP Agent.
model McpStdioTransport { type:"stdio";command:string;args?:string[];...Closed }
model McpHttpTransport { type:"http";url:string;...Closed }
@oneOf union McpTransport { McpStdioTransport,McpHttpTransport }
model McpServerConfig {name:string;enabled?:boolean=false;transport:McpTransport;...Closed}
model GetMcpSettingsRequest {method:"settings.mcp.get";request_id:string;agent_id:string;...Closed}
model SetMcpSettingsRequest {method:"settings.mcp.set";request_id:string;agent_id:string;revision:safeint;servers:McpServerConfig[];...Closed}
@oneOf union McpSettingsRequest {GetMcpSettingsRequest,SetMcpSettingsRequest}
model McpSettingsEvent {kind:"mcp_settings";...EventBase;data:{agent_id:string;revision:safeint;servers:McpServerConfig[];...Closed}}
model McpSettingsErrorEvent {kind:"mcp_settings_error";...EventBase;data:{agent_id:string;reason:"conflict"|"invalid"|"unavailable"|"read_write";...Closed}}

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
  @minValue(200) @maxValue(480) sidebar_width?: uint16 = 260;
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
/** Read one saved session and return its Insights analysis. */
model InsightsCommand { action: "insights"; thread_id: ThreadId; ...Closed }

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
  InsightsCommand,
}

@oneOf
union HostInput {
  McpSettingsRequest,
  IconThemeRequest,
  McpSourceRequest,
  WorkspaceSessionRequest,
  FileDocumentRequest,
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
/** Derived session analysis. Not written into the session journal. */
model InsightsSummary {
  turns: uint32;
  completed: uint32;
  failed: uint32;
  stopped: uint32;
  unfinished: uint32;
  unknown_turns: uint32;
  tool_calls: uint32;
  tool_errors: uint32;
  user_messages: uint32;
  request: string;
  response: string;
  `model`: string;
  git_branch: string;
  repository: string;
  resumed: boolean;
  ...Closed;
}
model InsightsEvent { kind: "insights"; ...ThreadEventBase; data: InsightsSummary }

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
  McpSettingsEvent, McpSettingsErrorEvent,
  DocumentSaveChooseEvent,DocumentSavePathEvent,DocumentSaveCancelledEvent,
  WorkspaceRestoredEvent,WorkspaceSavedEvent,WorkspaceErrorEvent,WorkspaceSourceEvent,WorkspaceSourceErrorEvent,WorkspaceResetEvent,WorkspaceSourceStoredEvent,DraftStoredEvent,
  WebOpenedEvent,WebStateEvent,WebClosedEvent,WebErrorEvent,WebChooseEvent,WebFocusedEvent,IconThemesEvent,
  DocumentOpenEvent,
  McpPermittedEvent,McpSourcesEvent,McpErrorEvent,McpAppOpenedEvent,
  DocumentChooseEvent,
  FileDocumentEvent,
  FileDocumentErrorEvent,
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
  InsightsEvent,
}
