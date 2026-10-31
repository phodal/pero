/* Generated from protocol/host.tsp by scripts/codegen/contracts.mjs. Do not edit. */

/**
 * Generated from protocol/host.tsp. Do not edit.
 */
export type HostProtocol = HostInput | HostEvent | WebCommand;
export type HostInput =
  | AutomationRequest
  | McpSettingsRequest
  | IconThemeRequest
  | McpSourceRequest
  | WorkspaceSessionRequest
  | FileDocumentRequest
  | LocalWorkerRequest
  | EchoRequest
  | SetLocaleRequest
  | SetRemoteSettingsRequest
  | GetWorkbenchSettingsRequest
  | SetWorkbenchSettingsRequest
  | HostCommand
  | AppRequest
  | ContributionRequest;
/**
 * Internal execution receipts, reservations and clock ticks are never client commands.
 */
export type AutomationCommand =
  | AutomationQuery
  | AutomationCreateLocal
  | AutomationPutDefinition
  | AutomationPutBinding
  | AutomationPublishInput
  | AutomationAccept
  | AutomationManualInput
  | AutomationCancel
  | AutomationSetControl
  | AutomationRevokeBinding
  | AutomationContinueOld;
export type AutomationTrigger = AutomationManualTrigger | AutomationEventTrigger | AutomationTimeTrigger;
export type AutomationCounter = number;
export type AutomationInputContract = "process_exact" | "recheck_latest";
export type AutomationTarget = AutomationLocalTarget | AutomationUnsupportedTarget;
export type McpSettingsRequest = GetMcpSettingsRequest | SetMcpSettingsRequest;
export type McpTransport = McpStdioTransport | McpHttpTransport;
export type IconThemeRequest = GetIconThemes | InstallIconTheme | SelectIconTheme | RemoveIconTheme;
export type WorkspaceSessionRequest =
  | GetWorkspaceSession
  | SaveWorkspaceSession
  | ReadWorkspaceSource
  | ResetWorkspaceSession
  | BeginWorkspaceSource
  | AppendWorkspaceSource
  | StoreWorkspaceDraft;
export type ContentOrigin = ConversationOrigin | FileOrigin | AppOrigin | McpOrigin;
export type WorkspaceItem = WorkspaceSimpleItem | WorkspaceDocumentItem | WorkspaceAppItem;
export type WorkspaceRoute = WorkspacePageRoute | WorkspaceContentRoute;
export type PaneNode = PaneLeafNode | PaneSplitNode;
export type PaneItemKind = "primary" | "rendered_preview";
export type ContentFormat = PlainContentFormat | CodeContentFormat;
export type FileDocumentRequest =
  | OpenFileDocument
  | FollowFileDocument
  | SaveFileDocument
  | SaveAsFileDocument
  | SaveDraftFileDocument
  | SaveAsReferenceFileDocument
  | ReleaseFileDocument;
export type LocalWorkerRequest = LocalWorkerStartCommand | LocalWorkerStopCommand | LocalWorkerGetCommand;
export type HostCommand =
  | ListAgentsCommand
  | WorkspaceCommand
  | LoadRoadmapCommand
  | AttachFilesCommand
  | SearchContextCommand
  | ResolveContextCommand
  | AuthenticateCommand
  | NewSessionCommand
  | PromptCommand
  | CancelCommand
  | PermissionCommand
  | ModelCommand
  | ConfigureCommand
  | CloseCommand
  | DeleteCommand
  | InsightsCommand;
export type ContextKind =
  "file" | "directory" | "symbol" | "thread" | "skill" | "image" | "selection" | "branch_diff" | "fetch" | "app_object";
export type ThreadId = string;
export type ContextContent = TextContextContent | ImageContextContent;
export type AppRequest = ListApps | InstallApp | EnableApp | DisableApp | UninstallApp | ResolveApp | AgentApp;
export type RequestId = string;
export type AppName = string;
export type AgentRequest = AgentInfoRequest | AgentStartRequest | AgentEventsRequest | AgentCancelRequest;
export type ContributionRequest = ContributionPrepare | ContributionReview | ContributionPublish;
export type HostEvent =
  | McpSettingsEvent
  | McpSettingsErrorEvent
  | DocumentSaveChooseEvent
  | DocumentSavePathEvent
  | DocumentSaveCancelledEvent
  | WorkspaceRestoredEvent
  | WorkspaceSavedEvent
  | WorkspaceErrorEvent
  | WorkspaceSourceEvent
  | WorkspaceSourceErrorEvent
  | WorkspaceResetEvent
  | WorkspaceSourceStoredEvent
  | DraftStoredEvent
  | WebOpenedEvent
  | WebStateEvent
  | WebClosedEvent
  | WebErrorEvent
  | WebChooseEvent
  | WebFocusedEvent
  | IconThemesEvent
  | DocumentOpenEvent
  | McpPermittedEvent
  | McpSourcesEvent
  | McpErrorEvent
  | McpAppOpenedEvent
  | DocumentChooseEvent
  | FileDocumentEvent
  | FileDocumentErrorEvent
  | ContentDocumentEvent
  | LocalWorkerStateEvent
  | ContributorStateEvent
  | ContributorSessionEvent
  | ContributionResultEvent
  | ContributionErrorEvent
  | SettingsEvent
  | WorkbenchSettingsEvent
  | RemoteSettingsSavedEvent
  | RemoteSettingsErrorEvent
  | ReadyEvent
  | DisconnectedEvent
  | NoticeEvent
  | EchoEvent
  | ErrorEvent
  | AgentsEvent
  | ReplayEvent
  | WorkspaceEvent
  | LocalRoadmapEvent
  | ContextFilesEvent
  | ContextCandidatesEvent
  | ContextResolvedEvent
  | ContextErrorEvent
  | RemoteStateEvent
  | RemoteOpenEvent
  | AutomationOpenEvent
  | AutomationResultEvent
  | AutomationErrorEvent
  | AppsResultEvent
  | AppsCatalogEvent
  | AppsErrorEvent
  | AppsOpenedEvent
  | ThreadEvent
  | SessionConnectingEvent
  | AgentInfoEvent
  | SessionAuthRequiredEvent
  | SessionAuthErrorEvent
  | SessionAuthenticatedEvent
  | PermissionEvent
  | PromptQueuedEvent
  | CommandRejectedEvent
  | InsightsEvent;
export type WebLoad = WebLoading | WebReady | WebFailed;
/**
 * Catalog key resolved by the UI from locales/*.json.
 */
export type MessageKey = string;
/**
 * Events persisted to the session journal and replayed to the UI.
 */
export type ThreadEvent =
  | TurnStartedEvent
  | SessionCreatedEvent
  | UserMessageEvent
  | SessionUpdateEvent
  | SessionUsageEvent
  | SessionReadyEvent
  | ModelChangedEvent
  | ConfigurationChangedEvent
  | TurnFinishedEvent
  | SessionErrorEvent
  | SessionClosedEvent
  | SessionDeletedEvent;
export type AutomationIntent = AutomationEventIntent | AutomationManualIntent | AutomationTimeIntent;
export type AutomationRequestStatus = AutomationSimpleRequestStatus | AutomationCoveredRequestStatus;
export type AutomationReceipt = AutomationUpdatedReceipt | AutomationAcceptanceReceipt | AutomationRequestReceipt;
export type AppResult = AppSuccess | AppFailure;
export type AppAgentStatus = "running" | "text" | "needs_input" | "completed" | "cancelled" | "failed";
/**
 * Private Desktop/native browser-engine commands, not Host stdin.
 */
export type WebCommand =
  | WebOpenCommand
  | WebHtmlCommand
  | WebRestoreCommand
  | WebNavigateCommand
  | WebControlCommand
  | WebSurfaceCommand
  | WebSurfacesCommand;

export interface AutomationRequest {
  method: "automation";
  id: string;
  command: AutomationCommand;
}
export interface AutomationQuery {
  action: "query";
}
export interface AutomationCreateLocal {
  action: "create_local";
  id: string;
  trigger: AutomationTrigger;
  input: AutomationInputContract;
  agent_id: string;
  prompt: string;
}
export interface AutomationManualTrigger {
  kind: "manual";
}
export interface AutomationEventTrigger {
  kind: "event";
  binding_id: string;
  event_kind: string;
}
export interface AutomationTimeTrigger {
  kind: "time";
  subject: string;
  exact: AutomationExactRef | null;
  anchor: AutomationCounter;
  interval_seconds: AutomationCounter;
  max_lateness_seconds: AutomationCounter;
}
export interface AutomationExactRef {
  revision: string;
  digest: string;
}
export interface AutomationPutDefinition {
  action: "put_definition";
  definition: AutomationDefinition;
}
export interface AutomationDefinition {
  id: string;
  revision: AutomationCounter;
  owner: string;
  trigger: AutomationTrigger;
  input: AutomationInputContract;
  input_binding_id: string;
  method: AutomationAgentMethod;
  target: AutomationTarget;
}
export interface AutomationAgentMethod {
  kind: "agent";
  agent_id: string;
  workspace: string;
  prompt: string;
}
export interface AutomationLocalTarget {
  kind: "local_host";
  owner: string;
}
export interface AutomationUnsupportedTarget {
  kind: "shared" | "worker";
}
export interface AutomationPutBinding {
  action: "put_binding";
  binding: AutomationSourceBinding;
}
export interface AutomationSourceBinding {
  id: string;
  owner: string;
  authority: string;
  event_kinds: string[];
}
export interface AutomationPublishInput {
  action: "publish_input";
  binding_id: string;
  subject: string;
  revision: string;
  content: string;
  latest: boolean;
}
export interface AutomationAccept {
  action: "accept";
  event: AutomationEventAssertion;
}
export interface AutomationEventAssertion {
  binding_id: string;
  producer_id: string;
  event_kind: string;
  subject: string;
  exact: AutomationExactRef | null;
}
export interface AutomationManualInput {
  action: "manual_input";
  definition_id: string;
  intent_id: string;
  subject: string;
  content: string;
}
export interface AutomationCancel {
  action: "cancel";
  request_id: string;
}
export interface AutomationSetControl {
  action: "control";
  definition_id: string;
  paused: boolean;
  revoked: boolean;
}
export interface AutomationRevokeBinding {
  action: "revoke_binding";
  binding_id: string;
}
export interface AutomationContinueOld {
  action: "continue_old";
  request_id: string;
}
export interface GetMcpSettingsRequest {
  method: "settings.mcp.get";
  request_id: string;
  agent_id: string;
}
export interface SetMcpSettingsRequest {
  method: "settings.mcp.set";
  request_id: string;
  agent_id: string;
  revision: number;
  servers: McpServerConfig[];
}
export interface McpServerConfig {
  name: string;
  enabled?: boolean;
  transport: McpTransport;
}
export interface McpStdioTransport {
  type: "stdio";
  command: string;
  args?: string[];
}
export interface McpHttpTransport {
  type: "http";
  url: string;
}
export interface GetIconThemes {
  method: "icons";
  action: "get";
  request_id: string;
}
export interface InstallIconTheme {
  method: "icons";
  action: "install";
  request_id: string;
  path: string;
}
export interface SelectIconTheme {
  method: "icons";
  action: "select";
  request_id: string;
  id: string | null;
}
export interface RemoveIconTheme {
  method: "icons";
  action: "remove";
  request_id: string;
  id: string;
}
export interface McpSourceRequest {
  method: "mcp";
  action: "open";
  request_id: string;
  thread_id?: string | null;
}
export interface GetWorkspaceSession {
  method: "workspace";
  action: "get";
}
export interface SaveWorkspaceSession {
  method: "workspace";
  action: "save";
  request_id: string;
  refresh: SourceKey[];
  session: WorkspaceSession;
  sources: WorkspaceSource[];
}
export interface SourceKey {
  origin: ContentOrigin;
  source: string;
  revision: number;
}
export interface ConversationOrigin {
  kind: "conversation";
  thread_id: string;
}
export interface FileOrigin {
  kind: "file";
  path: string;
}
export interface AppOrigin {
  kind: "app";
  app: string;
  panel: string;
}
export interface McpOrigin {
  kind: "mcp";
  server: string;
  thread_id: string;
}
export interface WorkspaceSession {
  version: 1;
  workspace: string;
  navigation: WorkspaceSnapshot;
  documents: SavedDocument[];
  web: SavedWeb[];
}
export interface WorkspaceSnapshot {
  items: WorkspaceItem[];
  route: WorkspaceRoute;
  other: WorkspaceRoute | null;
  focused: "left" | "right";
  panes: PaneLayout;
  reading: ReaderState | null;
  preview?: boolean;
  view_kind?: PaneItemKind;
  back: HistoryEntry[];
  forward: HistoryEntry[];
}
export interface WorkspaceSimpleItem {
  kind: "conversation" | "web" | "project" | "task";
  value: string;
}
export interface WorkspaceDocumentItem {
  kind: "document";
  value: {
    origin: ContentOrigin;
    source: string;
  };
}
export interface WorkspaceAppItem {
  kind: "app";
  value: {
    name: string;
    panel: string;
  };
}
export interface WorkspacePageRoute {
  kind: "page";
  value:
    | "conversation"
    | "document"
    | "web"
    | "projects"
    | "agents"
    | "tasks"
    | "workers"
    | "apps"
    | "insights"
    | "connections";
}
export interface WorkspaceContentRoute {
  kind: "content";
  value: WorkspaceItem;
}
export interface PaneLayout {
  root: PaneNode | null;
  focused: number | null;
  next_id: number;
  next_view_id: number;
}
export interface PaneLeafNode {
  kind: "leaf";
  view: PaneLeaf;
}
export interface PaneLeaf {
  id: number;
  tabs: PaneTabSet;
}
export interface PaneTabSet {
  items: PaneItem[];
  active: number | null;
  preview: number | null;
  pinned_count: number;
  activation_history: number[];
  history: WorkspaceHistory;
  closed: HistoryEntry[];
}
export interface PaneItem {
  id: number;
  route: WorkspaceRoute;
  kind?: PaneItemKind;
  reading?: ReaderState | null;
}
export interface ReaderState {
  source_revision?: number | null;
  source: boolean;
  selection: ReaderRange;
  /**
   * @minItems 2
   * @maxItems 2
   */
  scroll: [unknown, unknown];
  /**
   * @minItems 2
   * @maxItems 2
   */
  preview_scroll: [unknown, unknown];
  preview_reveal?: ReaderRange | null;
  query: string;
  search_open: boolean;
  search: ReaderSearch;
  folded_lines: number[];
  path: ReaderRange[];
}
export interface ReaderRange {
  start: number;
  end: number;
}
export interface ReaderSearch {
  case_insensitive: boolean;
  regex: boolean;
  whole_word: boolean;
}
export interface WorkspaceHistory {
  reading: ReaderState | null;
  preview?: boolean;
  view_kind?: PaneItemKind;
  back: HistoryEntry[];
  forward: HistoryEntry[];
}
export interface HistoryEntry {
  route: WorkspaceRoute;
  reading?: ReaderState | null;
  preview?: boolean;
  view_kind?: PaneItemKind;
}
export interface PaneSplitNode {
  kind: "split";
  id: number;
  axis: "horizontal" | "vertical";
  ratio: number;
  first: PaneNode;
  second: PaneNode;
}
export interface SavedDocument {
  header: DocumentHeader;
  reading: ReaderState;
  draft: string | null;
  draft_ref?: DraftRef | null;
  legacy_draft?: boolean;
}
export interface DocumentHeader {
  source: DocumentSource;
  revision: number;
  format: ContentFormat;
}
export interface DocumentSource {
  id: string;
  title: string;
  origin: ContentOrigin;
}
export interface PlainContentFormat {
  kind: "json" | "json_lines" | "text" | "markdown";
}
export interface CodeContentFormat {
  kind: "code";
  language: string;
}
export interface DraftRef {
  source: SourceKey;
  version: number;
}
export interface SavedWeb {
  id: string;
  url: string;
  html?: InlineHtml;
}
export interface InlineHtml {
  id: string;
  title: string;
  html: string;
}
export interface WorkspaceSource {
  header: DocumentHeader;
  text: string;
}
export interface ReadWorkspaceSource {
  method: "workspace";
  action: "read";
  request_id: string;
  key: SourceKey;
}
export interface ResetWorkspaceSession {
  method: "workspace";
  action: "reset";
  request_id: string;
}
export interface BeginWorkspaceSource {
  method: "workspace";
  action: "source_begin";
  request_id: string;
  header: DocumentHeader;
  total_bytes: number;
}
export interface AppendWorkspaceSource {
  method: "workspace";
  action: "source_chunk";
  request_id: string;
  chunk: SourceChunk;
}
export interface SourceChunk {
  offset: number;
  text: string;
  done: boolean;
}
export interface StoreWorkspaceDraft {
  method: "workspace";
  action: "store_draft";
  request_id: string;
  base: DraftRef | null;
  draft: DraftRef;
  edits: DraftEdit[];
}
export interface DraftEdit {
  old: ReaderRange;
  inserted: string;
}
export interface OpenFileDocument {
  method: "documents";
  action: "open";
  request_id: string;
  path: string;
}
export interface FollowFileDocument {
  method: "documents";
  action: "follow";
  request_id: string;
  source: string;
  href: string;
}
export interface SaveFileDocument {
  method: "documents";
  action: "save";
  request_id: string;
  source: string;
  revision: number;
  text: string;
}
export interface SaveAsFileDocument {
  method: "documents";
  action: "save_as";
  request_id: string;
  copy: FileCopy;
}
export interface FileCopy {
  path: string;
  text: string;
  protected_sources: string[];
}
export interface SaveDraftFileDocument {
  method: "documents";
  action: "save_draft";
  request_id: string;
  draft: DraftRef;
}
export interface SaveAsReferenceFileDocument {
  method: "documents";
  action: "save_as_reference";
  request_id: string;
  path: string;
  source: SourceKey;
  draft: DraftRef | null;
  protected_sources: string[];
}
export interface ReleaseFileDocument {
  method: "documents";
  action: "release";
  source: string;
}
export interface LocalWorkerStartCommand {
  action: "local_worker_start";
  request_id: string;
  worker: LocalWorkerConfig;
}
export interface LocalWorkerConfig {
  id: string;
  name: string;
  url: string;
  token: string;
  bindings: LocalWorkerBinding[];
}
export interface LocalWorkerBinding {
  project_id: string;
  workspace_key: string;
  path: string;
  agent_ids: string[];
}
export interface LocalWorkerStopCommand {
  action: "local_worker_stop";
  request_id: string;
}
export interface LocalWorkerGetCommand {
  action: "local_worker_get";
  request_id: string;
}
/**
 * Bootstrap transport probe.
 */
export interface EchoRequest {
  id: string;
  text: string;
}
export interface SetLocaleRequest {
  method: "settings.locale";
  locale: "en" | "zh-CN";
}
export interface SetRemoteSettingsRequest {
  method: "settings.remote";
  id: string;
  connection: RemoteConnectionSettings | null;
}
/**
 * Internal main-process/runtime preferences; never exposed in renderer snapshots.
 */
export interface RemoteConnectionSettings {
  url: string;
  mode: "client" | "operator";
  encrypted_token: string;
}
export interface GetWorkbenchSettingsRequest {
  method: "settings.workbench.get";
}
export interface SetWorkbenchSettingsRequest {
  method: "settings.workbench";
  preferences: WorkbenchPreferences;
}
export interface WorkbenchPreferences {
  accent?: "teal" | "blue" | "neutral";
  typography?: TypographyPreferences;
  appearance: "light" | "dark" | "system";
  /**
   * @maxItems 128
   */
  projects: ProjectBinding[];
  layout?: LayoutPreferences;
}
export interface TypographyPreferences {
  ui_size?: number;
  chat_size?: number | null;
  code_size?: number | null;
}
export interface ProjectBinding {
  workspace: string;
  project_id: string;
}
export interface LayoutPreferences {
  chat_width?: number;
  chat_open?: boolean;
}
export interface ListAgentsCommand {
  action: "list_agents";
}
export interface WorkspaceCommand {
  action: "workspace";
  path: string;
}
export interface LoadRoadmapCommand {
  action: "load_roadmap";
}
export interface AttachFilesCommand {
  action: "attach_files";
  paths: string[];
}
export interface SearchContextCommand {
  action: "search_context";
  request_id: string;
  kind: ContextKind;
  query: string;
}
export interface ResolveContextCommand {
  action: "resolve_context";
  request_id: string;
  kind: ContextKind;
  source: string;
  start_line?: number | null;
  end_line?: number | null;
}
export interface AuthenticateCommand {
  action: "authenticate";
  thread_id: string;
  method_id: string;
}
export interface NewSessionCommand {
  action: "new_session";
  thread_id: ThreadId;
  agent_id: string;
  scope?: AppChatScope;
}
export interface AppChatScope {
  app: string;
  panel: string;
}
export interface PromptCommand {
  action: "prompt";
  thread_id: string;
  text: string;
  contexts?: ContextReference[];
}
export interface ContextReference {
  id: string;
  kind: ContextKind;
  label: string;
  source: string;
  content: ContextContent;
}
export interface TextContextContent {
  type: "text";
  text: string;
}
export interface ImageContextContent {
  type: "image";
  data: string;
  mime_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
}
export interface CancelCommand {
  action: "cancel";
  thread_id: string;
}
export interface PermissionCommand {
  action: "permission";
  thread_id: string;
  request_id: string;
  option_id?: string | null;
}
export interface ModelCommand {
  action: "model";
  thread_id: string;
  model_id: string;
}
export interface ConfigureCommand {
  action: "configure";
  thread_id: ThreadId;
  config_id: string;
  value: string;
}
export interface CloseCommand {
  action: "close";
  thread_id: string;
}
export interface DeleteCommand {
  action: "delete";
  thread_id: ThreadId;
}
/**
 * Read one saved session and return its Insights analysis.
 */
export interface InsightsCommand {
  action: "insights";
  thread_id: ThreadId;
}
export interface ListApps {
  action: "list";
  method: "apps";
  id: RequestId;
}
export interface InstallApp {
  action: "install";
  path: string;
  method: "apps";
  id: RequestId;
}
export interface EnableApp {
  action: "enable";
  name: AppName;
  method: "apps";
  id: RequestId;
}
export interface DisableApp {
  action: "disable";
  name: AppName;
  method: "apps";
  id: RequestId;
}
export interface UninstallApp {
  action: "uninstall";
  name: AppName;
  method: "apps";
  id: RequestId;
}
export interface ResolveApp {
  action: "resolve";
  name: AppName;
  method: "apps";
  id: RequestId;
}
export interface AgentApp {
  action: "agent";
  name: AppName;
  request: AgentRequest;
  method: "apps";
  id: RequestId;
}
export interface AgentInfoRequest {
  operation: "info";
}
export interface AgentStartRequest {
  operation: "start";
  requestId: string;
  prompt: string;
  agentId: string;
}
export interface AgentEventsRequest {
  operation: "events";
  sessionId: string;
  after: number;
}
export interface AgentCancelRequest {
  operation: "cancel";
  sessionId: string;
}
export interface ContributionPrepare {
  method: "contribution";
  id: string;
  task_id: string;
  operation: "prepare";
  repository: string;
  parent: string;
  title: string;
  source_url: string;
  source_revision: string;
}
export interface ContributionReview {
  method: "contribution";
  id: string;
  task_id: string;
  operation: "review" | "status";
  workspace: string;
}
export interface ContributionPublish {
  method: "contribution";
  id: string;
  task_id: string;
  operation: "publish";
  workspace: string;
  review_token: string;
}
export interface McpSettingsEvent {
  kind: "mcp_settings";
  version: 1;
  request_id: string | null;
  text: string;
  data: {
    agent_id: string;
    revision: number;
    servers: McpServerConfig[];
  };
}
export interface McpSettingsErrorEvent {
  kind: "mcp_settings_error";
  version: 1;
  request_id: string | null;
  text: string;
  data: {
    agent_id: string;
    reason: "conflict" | "invalid" | "unavailable" | "read_write";
  };
}
export interface DocumentSaveChooseEvent {
  kind: "document_save_choose";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface DocumentSavePathEvent {
  kind: "document_save_path";
  version: 1;
  request_id: string | null;
  text: string;
  data: {
    path: string;
  };
}
export interface DocumentSaveCancelledEvent {
  kind: "document_save_cancelled";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface WorkspaceRestoredEvent {
  kind: "workspace_restored";
  version: 1;
  request_id: string | null;
  text: string;
  data: WorkspaceRestore;
}
export interface WorkspaceRestore {
  session: WorkspaceSession | null;
  sources: WorkspaceSource[];
  conflicts: string[];
  unavailable: SourceKey[];
}
export interface WorkspaceSavedEvent {
  kind: "workspace_saved";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface WorkspaceErrorEvent {
  kind: "workspace_error";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface WorkspaceSourceEvent {
  kind: "workspace_source";
  version: 1;
  request_id: string | null;
  text: string;
  data: {
    source: WorkspaceSource;
    conflict: boolean;
    draft?: string | null;
  };
}
export interface WorkspaceSourceErrorEvent {
  kind: "workspace_source_error";
  version: 1;
  request_id: string | null;
  text: string;
  data: {
    key: SourceKey;
    draft?: string | null;
  };
}
export interface WorkspaceResetEvent {
  kind: "workspace_reset";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface WorkspaceSourceStoredEvent {
  kind: "workspace_source_stored";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface DraftStoredEvent {
  kind: "draft_stored";
  version: 1;
  request_id: string | null;
  text: string;
  data: DraftRef;
}
export interface WebOpenedEvent {
  kind: "web_opened";
  version: 1;
  request_id: string | null;
  text: string;
  data: WebDocument;
}
export interface WebDocument {
  id: string;
  observation: WebObservation;
  html?: InlineHtml;
}
export interface WebObservation {
  url: string;
  title: string;
  load: WebLoad;
  can_back: boolean;
  can_forward: boolean;
  notice?: string;
}
export interface WebLoading {
  kind: "loading";
}
export interface WebReady {
  kind: "ready";
}
export interface WebFailed {
  kind: "failed";
  message: string;
}
export interface WebStateEvent {
  kind: "web_state";
  version: 1;
  request_id: string | null;
  text: string;
  data: WebDocument;
}
export interface WebClosedEvent {
  kind: "web_closed";
  version: 1;
  request_id: string | null;
  text: string;
  data: {
    id: string;
  };
}
export interface WebErrorEvent {
  kind: "web_error";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface WebChooseEvent {
  kind: "web_choose";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface WebFocusedEvent {
  kind: "web_focused";
  version: 1;
  request_id: string | null;
  text: string;
  data: {
    id: string;
  };
}
export interface IconThemesEvent {
  kind: "icon_themes" | "icon_themes_error";
  version: 1;
  request_id: string | null;
  text: string;
  data: IconThemeState;
}
export interface IconThemeState {
  installed: IconThemeInfo[];
  selected: string | null;
  theme: IconThemePackage | null;
}
export interface IconThemeInfo {
  id: string;
  name: string;
}
export interface IconThemePackage {
  version: 1;
  id: string;
  name: string;
  icons: IconGlyphMap;
  associations: IconThemeAssociations;
}
export interface IconGlyphMap {
  [k: string]: IconVariants | undefined;
}
export interface IconVariants {
  light: string;
  dark?: string;
}
export interface IconThemeAssociations {
  kinds?: IconAssociationMap;
  languages?: IconAssociationMap;
  filenames?: IconAssociationMap;
  extensions?: IconAssociationMap;
  apps?: IconAssociationMap;
}
export interface IconAssociationMap {
  [k: string]: string | undefined;
}
export interface DocumentOpenEvent {
  kind: "document_open";
  version: 1;
  request_id: string | null;
  text: string;
  data: DocumentHeader | LocatedDocumentHeader;
}
export interface LocatedDocumentHeader {
  header: DocumentHeader;
  location: ReaderLocation;
}
export interface ReaderLocation {
  record: number;
}
export interface McpPermittedEvent {
  kind: "mcp_permitted";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id?: string;
  data: {
    locale: string;
  };
}
export interface McpSourcesEvent {
  kind: "mcp_sources";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id?: string;
  data: {
    url: string;
  };
}
export interface McpErrorEvent {
  kind: "mcp_error";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface McpAppOpenedEvent {
  kind: "mcp_app_opened";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: McpAppBinding;
}
export interface McpAppBinding {
  id: string;
  server: string;
  resource_uri: string;
  tool: string;
  tool_call: string;
  thread_id: string;
}
export interface DocumentChooseEvent {
  kind: "document_choose";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface FileDocumentEvent {
  kind: "document_file";
  version: 1;
  request_id: string | null;
  text: string;
  data: DocumentHeader;
}
export interface FileDocumentErrorEvent {
  kind: "document_error";
  version: 1;
  request_id: string | null;
  text: string;
  data: {
    source: string;
    reason: "conflict" | "unsupported" | "unavailable" | "read_write";
  };
}
/**
 * Read-only Desktop result-file transport. It never starts an Agent turn.
 */
export interface ContentDocumentEvent {
  kind: "content_document";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: {
    tool_call_id: string;
    artifact_id: string;
    status: "ready" | "error";
  };
}
export interface LocalWorkerStateEvent {
  kind: "local_worker_state";
  version: 1;
  request_id: string | null;
  text: string;
  data: LocalWorkerState;
}
export interface LocalWorkerState {
  status: "stopped" | "starting" | "idle" | "running" | "offline" | "stopping" | "needs_attention" | "unavailable";
  enabled: boolean;
  configuration: LocalWorkerSummary | null;
  worker_id: string;
  name: string;
  url: string;
  message: string;
  run_id: string | null;
  attempt: number;
}
export interface LocalWorkerSummary {
  id: string;
  name: string;
  url: string;
  bindings: LocalWorkerBinding[];
}
export interface ContributorStateEvent {
  kind: "contributor_state";
  version: 1;
  request_id: string | null;
  text: string;
  data: RemoteSnapshotPayload;
}
/**
 * Main-process HTTP adapter snapshot; validated by protocol/remote.tsp.
 */
export interface RemoteSnapshotPayload {
  [k: string]: unknown | undefined;
}
export interface ContributorSessionEvent {
  kind: "contributor_session";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: ContributorSessionData;
}
export interface ContributorSessionData {
  task_id: string;
  workspace: string;
  agent_id?: string;
}
export interface ContributionResultEvent {
  version: 1;
  kind: "contribution_result";
  request_id: string | null;
  text: string;
  data: ContributionSnapshot;
}
export interface ContributionSnapshot {
  task_id: string;
  repository: string;
  workspace: string;
  branch: string;
  base: string;
  base_head: string;
  title: string;
  source_url: string;
  source_revision: string;
  pr_url: string | null;
  head: string;
  review_token: string;
  diff: string;
  changed_files: string[];
  status: string;
  gh_available: boolean;
  gh_authenticated: boolean;
}
export interface ContributionErrorEvent {
  version: 1;
  kind: "contribution_error";
  request_id: string | null;
  text: string;
  data: ContributionErrorData;
}
export interface ContributionErrorData {
  code: string;
  message: string;
  task_id: string;
}
/**
 * `text` is the active locale tag.
 */
export interface SettingsEvent {
  kind: "settings";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface WorkbenchSettingsEvent {
  kind: "workbench_settings";
  version: 1;
  request_id: string | null;
  text: string;
  data: WorkbenchPreferences;
}
/**
 * Main-process acknowledgements contain no persisted connection payload.
 */
export interface RemoteSettingsSavedEvent {
  kind: "remote_settings_saved";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface RemoteSettingsErrorEvent {
  kind: "remote_settings_error";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface ReadyEvent {
  kind: "ready";
  version: 1;
  request_id: string | null;
  text: string;
  message_key?: MessageKey;
}
/**
 * Emitted by Electron when the Host child cannot start or exits.
 */
export interface DisconnectedEvent {
  kind: "disconnected";
  version: 1;
  request_id: string | null;
  text: string;
  message_key?: MessageKey;
}
/**
 * Emitted by Electron from the Workbench menu.
 */
export interface NoticeEvent {
  kind: "notice";
  version: 1;
  request_id: string | null;
  text: string;
  message_key?: MessageKey;
}
export interface EchoEvent {
  kind: "echo";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface ErrorEvent {
  kind: "error";
  version: 1;
  request_id: string | null;
  text: string;
  message_key?: MessageKey;
}
/**
 * `text` is the current workspace path.
 */
export interface AgentsEvent {
  kind: "agents";
  version: 1;
  request_id: string | null;
  text: string;
  data: AgentSummary[];
}
export interface AgentSummary {
  id: string;
  name: string;
  available: boolean;
  command: string;
  model: string | null;
}
export interface ReplayEvent {
  kind: "replay";
  version: 1;
  request_id: string | null;
  text: string;
  data: ReplayData;
}
export interface ReplayData {
  events: ThreadEvent[];
  active: string[];
}
export interface TurnStartedEvent {
  kind: "turn_started";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
}
export interface SessionCreatedEvent {
  kind: "session_created";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: SessionCreatedData;
}
export interface SessionCreatedData {
  agent: string;
  workspace: string;
  scope?: AppChatScope;
  appBinding?: AppSessionBinding;
}
export interface AppSessionBinding {
  app: AppName;
  requestId: string;
  agentId: string;
  prompt: string;
}
export interface UserMessageEvent {
  kind: "user_message";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data?: UserMessageContext;
}
export interface UserMessageContext {
  contexts: ContextReference[];
}
/**
 * `data` is the ACP SessionUpdate.
 */
export interface SessionUpdateEvent {
  kind: "session_update";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: AcpPayload;
}
/**
 * ACP payload forwarded unchanged; its shape is owned by the ACP schema.
 */
export interface AcpPayload {
  [k: string]: unknown | undefined;
}
export interface SessionUsageEvent {
  kind: "session_usage";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: SessionUsage;
}
export interface SessionUsage {
  context_used?: number;
  context_capacity?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost?: UsageCost;
}
/**
 * Provider measurements: context occupancy and cumulative session cost.
 */
export interface UsageCost {
  amount: number;
  currency: string;
}
/**
 * `data` is the ACP NewSessionResponse, with configOptions refreshed after model selection.
 */
export interface SessionReadyEvent {
  kind: "session_ready";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: AcpPayload;
}
/**
 * `data` is the ACP SetSessionConfigOptionResponse.
 */
export interface ModelChangedEvent {
  kind: "model_changed";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: AcpPayload;
}
export interface ConfigurationChangedEvent {
  kind: "configuration_changed";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: SessionSettings;
}
export interface SessionSettings {
  options: SessionSetting[];
}
export interface SessionSetting {
  id: string;
  name: string;
  category: string;
  current: string;
  choices: SettingChoice[];
}
export interface SettingChoice {
  value: string;
  label: string;
  description: string;
}
/**
 * `text` is the stop reason; `data` is the ACP PromptResponse.
 */
export interface TurnFinishedEvent {
  kind: "turn_finished";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: AcpPayload;
}
export interface SessionErrorEvent {
  kind: "session_error";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
}
export interface SessionClosedEvent {
  kind: "session_closed";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
}
export interface SessionDeletedEvent {
  kind: "session_deleted";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
}
export interface WorkspaceEvent {
  kind: "workspace";
  version: 1;
  request_id: string | null;
  text: string;
  data?: WorkspaceIdentity;
}
export interface WorkspaceIdentity {
  repository: RepositoryIdentity | null;
}
/**
 * `text` is the selected workspace path.
 */
export interface RepositoryIdentity {
  host: string;
  owner: string;
  name: string;
}
export interface LocalRoadmapEvent {
  kind: "local_roadmap";
  version: 1;
  request_id: string | null;
  text: string;
  data: LocalRoadmap;
}
export interface LocalRoadmap {
  workspace: string;
  path: string;
  items: RoadmapItem[];
  error: "not_found" | "read" | "invalid" | null;
}
export interface RoadmapItem {
  line: number;
  parent_line: number | null;
  title: string;
  text: string;
  checked: boolean;
  headings: string[];
}
export interface ContextFilesEvent {
  kind: "context_files";
  version: 1;
  request_id: string | null;
  text: string;
  data: ContextFile[];
}
export interface ContextFile {
  path: string;
  name: string;
  text: string;
}
export interface ContextCandidatesEvent {
  kind: "context_candidates";
  version: 1;
  request_id: string | null;
  text: string;
  data: ContextCandidate[];
}
export interface ContextCandidate {
  kind: ContextKind;
  label: string;
  source: string;
  detail: string;
}
export interface ContextResolvedEvent {
  kind: "context_resolved";
  version: 1;
  request_id: string | null;
  text: string;
  data: ContextReference;
}
export interface ContextErrorEvent {
  kind: "context_error";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface RemoteStateEvent {
  kind: "remote_state";
  version: 1;
  request_id: string | null;
  text: string;
  data: RemoteSnapshotPayload;
}
/**
 * Open remote tasks from the native Workbench menu or keyboard.
 */
export interface RemoteOpenEvent {
  kind: "remote_open";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface AutomationOpenEvent {
  kind: "automation_open";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface AutomationResultEvent {
  kind: "automation_result";
  version: 1;
  request_id: string | null;
  text: string;
  data: AutomationResult;
}
export interface AutomationResult {
  state: AutomationState;
  capabilities: AutomationCapabilities;
  receipt?: AutomationReceipt;
  attention: AutomationAttention;
  fault: string | null;
  evidence: AutomationEvidence;
}
export interface AutomationState {
  owner: string;
  limits: AutomationLimits;
  bindings: AutomationSourceBinding[];
  definitions: AutomationDefinition[];
  controls: AutomationControls;
  revoked_bindings: string[];
  snapshots: AutomationCandidateRef[];
  latest: AutomationCandidateRef[];
  events: AutomationAcceptedEvent[];
  decisions: AutomationDecision[];
  requests: AutomationRunRequest[];
  dispatch_count: AutomationCounter;
}
export interface AutomationLimits {
  max_events: number;
  max_requests: number;
  max_snapshots: number;
  max_definitions: number;
  max_fanout: number;
  max_event_bytes: number;
  max_active: number;
  max_dispatches: AutomationCounter;
}
export interface AutomationControls {
  [k: string]: AutomationControl | undefined;
}
export interface AutomationControl {
  paused: boolean;
  revoked: boolean;
}
export interface AutomationCandidateRef {
  binding_id: string;
  subject: string;
  revision: string;
  digest: string;
  content_ref: string;
}
export interface AutomationAcceptedEvent {
  id: string;
  input: AutomationEventInput;
  position: AutomationCounter;
  accepted_at: AutomationCounter;
}
export interface AutomationEventInput {
  binding_id: string;
  producer_id: string;
  event_kind: string;
  subject: string;
  exact: AutomationExactRef | null;
  digest: string;
}
export interface AutomationDecision {
  acceptance_id: string;
  definition_id: string;
  revision: AutomationCounter;
  request_id: string;
}
export interface AutomationRunRequest {
  id: string;
  definition: AutomationDefinition;
  intent: AutomationIntent;
  subject: string;
  exact: AutomationExactRef | null;
  created_at: AutomationCounter;
  through_position: AutomationCounter;
  snapshot: AutomationCandidateRef | null;
  execution_id: string | null;
  status: AutomationRequestStatus;
  continued_revision: boolean;
  cancel_requested: boolean;
}
export interface AutomationEventIntent {
  kind: "event";
}
export interface AutomationManualIntent {
  kind: "manual";
  id: string;
}
export interface AutomationTimeIntent {
  kind: "time";
  slot: AutomationCounter;
}
export interface AutomationSimpleRequestStatus {
  kind:
    | "pending"
    | "input_unavailable"
    | "definition_changed"
    | "reserved"
    | "running"
    | "cancel_requested"
    | "reconcile"
    | "completed"
    | "failed"
    | "cancelled"
    | "expired";
}
export interface AutomationCoveredRequestStatus {
  kind: "covered";
  request_id: string;
}
export interface AutomationCapabilities {
  owner: string;
  workspace: string;
  agents: AutomationAgentSummary[];
  supportedTargets: "local_host"[];
  supportedMethods: "agent"[];
  sourceBindingId: string;
  sourceKind: "local_published_registry";
  maxInputBytes: number;
  available: boolean;
  unsupported: string[];
}
export interface AutomationAgentSummary {
  id: string;
  name: string;
  available: boolean;
}
export interface AutomationUpdatedReceipt {
  kind: "updated";
}
export interface AutomationAcceptanceReceipt {
  kind: "acceptance";
  id: string;
  duplicate: boolean;
  matched: number;
}
export interface AutomationRequestReceipt {
  kind: "request";
  id: string;
  duplicate: boolean;
}
export interface AutomationAttention {
  [k: string]: string | undefined;
}
export interface AutomationEvidence {
  admissions: AutomationAdmissionEntry[];
  observations: AutomationObservationEntry[];
}
export interface AutomationAdmissionEntry {
  execution_id: string;
  record: AutomationAdmission;
}
export interface AutomationAdmission {
  admittedAt: AutomationCounter;
  authority: AutomationAuthority;
  candidate: AutomationCandidateRef;
}
export interface AutomationAuthority {
  agentId: string;
  workspace: string;
  configurationDigest: string;
  model: string | null;
  permissionPolicy: string;
  appUse: boolean;
}
export interface AutomationObservationEntry {
  execution_id: string;
  record: AutomationObservation | AutomationAdmissionFailure;
}
export interface AutomationObservation {
  kind: string;
  observedAt: AutomationCounter;
}
export interface AutomationAdmissionFailure {
  admissionFailure: string;
}
export interface AutomationErrorEvent {
  kind: "automation_error";
  version: 1;
  request_id: string | null;
  text: string;
}
/**
 * Private acknowledgements intercepted by Desktop main.
 */
export interface AppsResultEvent {
  kind: "apps_result";
  version: 1;
  request_id: string | null;
  text: string;
  data: AppResult;
}
export interface AppSuccess {
  ok: true;
  value: AppRecord[] | AppAccess | AppAgentInfo | AppAgentStarted | AppAgentTranscript | AppAgentCancelled;
}
export interface AppRecord {
  name: AppName;
  version: string;
  displayName: string;
  description: string;
  enabled: boolean;
  tenure: "optional" | "required";
  panels: AppPanel[];
  writes?: AppWriteRoute[];
}
export interface AppPanel {
  id: AppName;
  title: string;
  entry: string;
}
export interface AppWriteRoute {
  name: AppName;
  description: string;
  path: string;
  schema: AppDocumentSchema;
}
/**
 * Public catalog: no local paths or backend credentials.
 */
export interface AppDocumentSchema {
  [k: string]: unknown | undefined;
}
export interface AppAccess {
  root: string;
  entry: string;
  backend?: BackendAccess;
}
/**
 * Host-to-main-process descriptor. Never forwarded to App or Workbench renderers.
 */
export interface BackendAccess {
  url: string;
  token: string;
}
export interface AppAgentInfo {
  available: boolean;
  workspace: string;
  agents: AppAgentSummary[];
}
export interface AppAgentSummary {
  id: string;
  name: string;
  available: boolean;
}
export interface AppAgentStarted {
  sessionId: string;
}
export interface AppAgentTranscript {
  events: AppAgentEvent[];
  cursor: number;
  status: AppAgentStatus;
  text: string;
}
export interface AppAgentEvent {
  kind: AppAgentStatus;
  text: string;
}
export interface AppAgentCancelled {
  cancelled: true;
}
export interface AppFailure {
  ok: false;
  error: string;
}
export interface AppsCatalogEvent {
  kind: "apps_catalog";
  version: 1;
  request_id: string | null;
  text: string;
  data: AppRecord[];
}
export interface AppsErrorEvent {
  kind: "apps_error";
  version: 1;
  request_id: string | null;
  text: string;
}
export interface AppsOpenedEvent {
  kind: "apps_opened";
  version: 1;
  request_id: string | null;
  text: string;
  data: AppOpenedData;
}
export interface AppOpenedData {
  name: string;
  panel: string;
  url: string;
}
export interface SessionConnectingEvent {
  kind: "session_connecting";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
}
/**
 * `data` is the ACP InitializeResponse.
 */
export interface AgentInfoEvent {
  kind: "agent_info";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: AcpPayload;
}
export interface SessionAuthRequiredEvent {
  kind: "session_auth_required";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: AuthRequiredData;
}
export interface AuthRequiredData {
  authMethods: AcpPayload[];
}
export interface SessionAuthErrorEvent {
  kind: "session_auth_error";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data?: AuthErrorData;
}
export interface AuthErrorData {
  methodId: string;
}
export interface SessionAuthenticatedEvent {
  kind: "session_authenticated";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: SessionAuthenticatedData;
}
export interface SessionAuthenticatedData {
  sessionId: string;
}
export interface PermissionEvent {
  kind: "permission";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: PermissionData;
}
/**
 * The ACP RequestPermissionRequest plus the Host-issued `permission_id`.
 */
export interface PermissionData {
  permission_id: string;
  [k: string]: unknown | undefined;
}
export interface PromptQueuedEvent {
  kind: "prompt_queued";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: PromptQueuedData;
}
export interface PromptQueuedData {
  position: number;
}
export interface CommandRejectedEvent {
  kind: "command_rejected";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data?: CommandRejectedData;
}
export interface CommandRejectedData {
  count: number;
}
export interface InsightsEvent {
  kind: "insights";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: InsightsSummary;
}
/**
 * Derived session analysis. Not written into the session journal.
 */
export interface InsightsSummary {
  turns: number;
  completed: number;
  failed: number;
  stopped: number;
  unfinished: number;
  unknown_turns: number;
  tool_calls: number;
  tool_errors: number;
  user_messages: number;
  request: string;
  response: string;
  model: string;
  git_branch: string;
  repository: string;
  resumed: boolean;
}
export interface WebOpenCommand {
  action: "web_open";
  url: string;
}
export interface WebHtmlCommand {
  action: "web_html";
  source: InlineHtml;
}
export interface WebRestoreCommand {
  action: "web_restore";
  id: string;
  url: string;
  html?: InlineHtml | null;
}
export interface WebNavigateCommand {
  action: "web_navigate";
  id: string;
  url: string;
}
export interface WebControlCommand {
  action: "web_back" | "web_forward" | "web_reload" | "web_close";
  id: string;
}
export interface WebSurfaceCommand {
  action: "web_surface";
  id: string | null;
  bounds?: SurfaceBounds;
}
export interface SurfaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WebSurfacesCommand {
  action: "web_surfaces";
  surfaces: WebSurfaceSlot[];
}
export interface WebSurfaceSlot {
  id: string;
  bounds: SurfaceBounds;
  focused: boolean;
}
