/* Generated from protocol/host.tsp by scripts/codegen/contracts.mjs. Do not edit. */

/**
 * Generated from protocol/host.tsp. Do not edit.
 */
export type HostProtocol = HostInput | HostEvent | WebCommand;
export type HostInput =
  | AutomationRequest
  | TerminalRequest
  | McpSettingsRequest
  | IconThemeRequest
  | McpSourceRequest
  | WorkspaceSessionRequest
  | FileDocumentRequest
  | ArtifactRequest
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
  | AutomationContinueOld
  | AutomationReconcile;
export type AutomationTrigger =
  AutomationManualTrigger | AutomationEventTrigger | AutomationTimeTrigger | AutomationCalendarTrigger;
export type AutomationCounter = number;
export type AutomationInputContract = "process_exact" | "recheck_latest";
export type AutomationMethod = AutomationAgentMethod | AutomationResearchWatch;
export type AutomationTarget = AutomationLocalTarget | AutomationUnsupportedTarget;
export type AutomationReconciliationDisposition = "not_started" | "completed" | "failed" | "cancelled";
export type TerminalRequest = OpenTerminal | WriteTerminal | ResizeTerminal | CloseTerminal;
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
export type WorkspaceItem = WorkspaceSimpleItem | WorkspaceDocumentItem | WorkspaceAppItem | WorkspaceComputeItem;
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
export type ArtifactRequest =
  | ListArtifacts
  | RegisterTextArtifact
  | RegisterFileArtifact
  | ReadArtifact
  | ResolveArtifactSnapshot
  | ArtifactContextRequest;
export type ThreadId = string;
export type LocalWorkerRequest = LocalWorkerStartCommand | LocalWorkerStopCommand | LocalWorkerGetCommand;
export type ArtifactView = "icons" | "list" | "gallery";
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
  | AnswerUserQuestionsCommand
  | ModelCommand
  | ConfigureCommand
  | CloseCommand
  | DeleteCommand
  | InsightsCommand;
export type ContextKind =
  "file" | "directory" | "symbol" | "thread" | "skill" | "image" | "selection" | "branch_diff" | "fetch" | "app_object";
export type ContextContent = TextContextContent | ImageContextContent;
export type QuestionReply = AnsweredQuestions | CancelledQuestions;
export type AppRequest =
  | LocalEnvironmentApp
  | EnvironmentInspectionApp
  | AppApiAccess
  | AppSdkRequest
  | ListApps
  | InstallApp
  | ListAgentPlugins
  | InstallAgentPlugin
  | EnableAgentPlugin
  | AgentRunCommand
  | AgentCatalogCommand
  | PrepareApp
  | EnableApp
  | DisableApp
  | UninstallApp
  | ResolveApp
  | ResolveStaticApp
  | ProjectResourcesApp
  | AgentApp
  | ConnectorsApp
  | AutomationApp
  | ResearchAssetsApp;
export type AppName = string;
export type LocalEnvironmentOperation =
  LocalEnvironmentCreate | LocalEnvironmentList | LocalEnvironmentPrepare | LocalEnvironmentBind;
export type RequestId = string;
export type AgentRunRequest =
  | AgentRunPrepare
  | AgentRunTerminal
  | AgentRunStart
  | AgentRunLookup
  | AgentRunStatus
  | AgentRunEvents
  | AgentRunCancel
  | AgentRunRetry
  | AgentRunOpen;
export type AgentRequest = AgentInfoRequest | AgentStartRequest | AgentEventsRequest | AgentCancelRequest;
export type ResearchAssetsRequest = ResearchAssetStart | ResearchAssetLookup;
/**
 * Paper may request only saved research identities; Host owns the fixed Data target.
 */
export type ResearchId = string;
export type ContributionRequest = ContributionPrepare | ContributionReview | ContributionPublish;
export type HostEvent =
  | TerminalEvent
  | McpSettingsEvent
  | McpSettingsErrorEvent
  | McpRuntimeEvent
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
  | ArtifactCatalogEvent
  | ArtifactRegisteredEvent
  | ArtifactDocumentEvent
  | ArtifactContextEvent
  | ArtifactSnapshotResultEvent
  | ArtifactErrorEvent
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
  | AppsPreparationEvent
  | AppsCatalogEvent
  | ProjectResourcesEvent
  | AppsErrorEvent
  | AppsOpenedEvent
  | ThreadEvent
  | SessionConnectingEvent
  | AgentInfoEvent
  | SessionAuthRequiredEvent
  | SessionAuthErrorEvent
  | SessionAuthenticatedEvent
  | PermissionEvent
  | UserQuestionsEvent
  | QuestionsResolvedEvent
  | QuestionsErrorEvent
  | PromptQueuedEvent
  | CommandRejectedEvent
  | InsightsEvent;
export type TerminalData = TerminalOpened | TerminalOutput | TerminalExited | TerminalError;
export type WebLoad = WebLoading | WebReady | WebFailed;
export type ArtifactMedia = ArtifactDocumentMedia | ArtifactSimpleMedia | ArtifactImageMedia;
export type ArtifactImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";
export type ArtifactSource = ArtifactTextSource | ArtifactFileSource;
export type ArtifactSnapshotResult = ArtifactSnapshotSuccess | ArtifactSnapshotFailure;
/**
 * Catalog key resolved by the UI from locales/*.json.
 */
export type MessageKey = string;
/**
 * Events persisted to the session journal and replayed to the UI.
 */
export type ThreadEvent =
  | TurnStartedEvent
  | AppAgentSessionOpenEvent
  | AppAgentAttemptEvent
  | AppAgentCancelEvent
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
export type AutomationCapacityKind = "requests" | "events" | "snapshots" | "definitions" | "dispatches";
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
export interface AutomationCalendarTrigger {
  kind: "calendar";
  schedule: CalendarSchedule;
  subject: string;
  exact: AutomationExactRef | null;
}
export interface CalendarSchedule {
  rule: string;
  timezone: string;
  first_slot: AutomationCounter;
  max_lateness_seconds: AutomationCounter;
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
  method: AutomationMethod;
  target: AutomationTarget;
}
export interface AutomationAgentMethod {
  kind: "agent";
  agent_id: string;
  workspace: string;
  prompt: string;
}
export interface AutomationResearchWatch {
  kind: "research_watch";
  record_id: string;
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
export interface AutomationReconcile {
  action: "reconcile";
  request_id: string;
  expected_execution_id: string;
  disposition: AutomationReconciliationDisposition;
  evidence: string;
  execution_stopped: true;
  effects_checked: true;
}
export interface OpenTerminal {
  method: "terminal";
  action: "open";
  id: number;
  cwd: string;
  size: TerminalSize;
}
export interface TerminalSize {
  rows: number;
  cols: number;
}
export interface WriteTerminal {
  method: "terminal";
  action: "write";
  id: number;
  bytes: number[];
}
export interface ResizeTerminal {
  method: "terminal";
  action: "resize";
  id: number;
  size: TerminalSize;
}
export interface CloseTerminal {
  method: "terminal";
  action: "close";
  id: number;
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
export interface WorkspaceComputeItem {
  kind: "compute";
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
export interface ListArtifacts {
  action: "list";
  method: "artifacts";
  request_id: string;
  thread_id: ThreadId;
}
export interface RegisterTextArtifact {
  action: "register_text";
  method: "artifacts";
  request_id: string;
  thread_id: ThreadId;
  artifact_id?: string | null;
  source_message_id?: string | null;
  source_tool_call_id?: string | null;
  title: string;
  text: string;
  format?: ContentFormat | null;
}
export interface RegisterFileArtifact {
  action: "register_file";
  method: "artifacts";
  request_id: string;
  thread_id: ThreadId;
  artifact_id?: string | null;
  source_message_id?: string | null;
  source_tool_call_id?: string | null;
  title?: string | null;
  path: string;
}
export interface ReadArtifact {
  action: "read";
  method: "artifacts";
  request_id: string;
  thread_id: ThreadId;
  artifact_id: string;
  version?: number | null;
}
export interface ResolveArtifactSnapshot {
  action: "resolve_snapshot";
  method: "artifacts";
  request_id: string;
  thread_id: ThreadId;
  artifact_id: string;
  version: number;
}
export interface ArtifactContextRequest {
  action: "context";
  method: "artifacts";
  request_id: string;
  thread_id: ThreadId;
  artifact_id: string;
  version: number;
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
  /**
   * @maxItems 128
   */
  research_projects?: ResearchProject[];
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
export interface ResearchProject {
  id: string;
  title: string;
  goal: string;
  workspace: string | null;
  /**
   * @maxItems 256
   */
  resources: ProjectResourceRef[];
}
export interface ProjectResourceRef {
  app: "paper-agent" | "control-lab" | "lab";
  kind: "paper" | "study" | "experiment";
  id: string;
  revision: string;
}
export interface LayoutPreferences {
  chat_width?: number;
  chat_open?: boolean;
  sidebar_width?: number;
  artifact_pane_width?: number;
  sessions_width?: number;
  artifact_view?: ArtifactView;
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
export interface AnswerUserQuestionsCommand {
  action: "answer_user_questions";
  thread_id: string;
  request_id: string;
  reply: QuestionReply;
}
export interface AnsweredQuestions {
  outcome: "answered";
  answers: QuestionAnswer[];
}
export interface QuestionAnswer {
  questionIndex: number;
  selectedOptions?: number[];
  text?: string;
}
export interface CancelledQuestions {
  outcome: "cancelled";
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
export interface LocalEnvironmentApp {
  action: "localenvironment";
  name: AppName;
  request: LocalEnvironmentOperation;
  method: "apps";
  id: RequestId;
}
export interface LocalEnvironmentCreate {
  operation: "create";
  target: "paper-agent.pcgym" | "control-lab.python-control" | "control-lab.ngspice";
  label: string;
}
export interface LocalEnvironmentList {
  operation: "list";
}
export interface LocalEnvironmentPrepare {
  operation: "prepare";
  id: AppName;
}
export interface LocalEnvironmentBind {
  operation: "bind";
  id: AppName;
}
/**
 * Software observations only; does not allocate or approve scientific execution.
 */
export interface EnvironmentInspectionApp {
  action: "environment";
  name: AppName;
  target: "paper-agent.pcgym" | "control-lab.python-control" | "control-lab.ngspice";
  method: "apps";
  id: RequestId;
}
export interface AppApiAccess {
  action: "apiaccess";
  name: AppName;
  path: string;
  method: "apps";
  id: RequestId;
}
export interface AppSdkRequest {
  action: "sdkcontext";
  name: AppName;
  method: "apps";
  id: RequestId;
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
export interface ListAgentPlugins {
  action: "pluginlist";
  method: "apps";
  id: RequestId;
}
export interface InstallAgentPlugin {
  action: "plugininstall";
  path: string;
  method: "apps";
  id: RequestId;
}
export interface EnableAgentPlugin {
  action: "pluginenable";
  name: AppName;
  enabled: boolean;
  method: "apps";
  id: RequestId;
}
export interface AgentRunCommand {
  action: "agentrun";
  name: AppName;
  request: AgentRunRequest;
  method: "apps";
  id: RequestId;
}
export interface AgentRunPrepare {
  operation: "prepare";
  scope: AgentScope;
  input: AppDocumentSchema;
}
export interface AgentScope {
  workspaceId: string;
}
/**
 * Public catalog: no local paths or backend credentials.
 */
export interface AppDocumentSchema {
  [k: string]: unknown | undefined;
}
export interface AgentRunTerminal {
  operation: "terminal";
  scope: AgentScope;
  runId: string;
  terminalId?: string;
  offset?: number;
  count?: number;
}
export interface AgentRunStart {
  operation: "start";
  scope: AgentScope;
  requestId: string;
  text: string;
  harnessId?: string;
  context?: AppDocumentSchema;
}
export interface AgentRunLookup {
  operation: "lookup";
  scope: AgentScope;
  requestId: string;
}
export interface AgentRunStatus {
  operation: "status";
  scope: AgentScope;
  runId: string;
}
export interface AgentRunEvents {
  operation: "events";
  scope: AgentScope;
  runId: string;
  after?: string;
}
export interface AgentRunCancel {
  operation: "cancel";
  scope: AgentScope;
  runId: string;
}
export interface AgentRunRetry {
  operation: "retry";
  scope: AgentScope;
  runId: string;
  requestId: string;
  text?: string;
}
export interface AgentRunOpen {
  operation: "open";
  sessionId: string;
}
export interface AgentCatalogCommand {
  action: "agentcatalog";
  name: AppName;
  path: "/api/workspaces" | "/api/harnesses";
  method: "apps";
  id: RequestId;
}
export interface PrepareApp {
  action: "prepare";
  name: AppName;
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
/**
 * Static UI access without dependency preparation or backend startup.
 */
export interface ResolveStaticApp {
  action: "resolve_static";
  name: AppName;
  method: "apps";
  id: RequestId;
}
export interface ProjectResourcesApp {
  action: "projectresources";
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
export interface ConnectorsApp {
  action: "connectors";
  name: AppName;
  method: "apps";
  id: RequestId;
}
export interface AutomationApp {
  action: "automation";
  name: AppName;
  request: AutomationApiRequest;
  method: "apps";
  id: RequestId;
}
export interface AutomationApiRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
}
export interface ResearchAssetsApp {
  action: "research-assets";
  name: AppName;
  request: ResearchAssetsRequest;
  method: "apps";
  id: RequestId;
}
export interface ResearchAssetStart {
  operation: "start";
  bundleId: ResearchId;
  assetId: ResearchId;
}
export interface ResearchAssetLookup {
  operation: "status" | "cancel";
  bundleId: ResearchId;
  assetId?: ResearchId;
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
export interface TerminalEvent {
  kind: "terminal";
  version: 1;
  request_id: string | null;
  text: string;
  data: TerminalData;
}
export interface TerminalOpened {
  kind: "opened";
  id: number;
  cwd: string;
}
export interface TerminalOutput {
  kind: "output";
  id: number;
  bytes: number[];
}
export interface TerminalExited {
  kind: "exited";
  id: number;
  code: number;
}
export interface TerminalError {
  kind: "error";
  id: number;
  message: string;
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
    sessions: McpRuntimeSession[];
  };
}
export interface McpRuntimeSession {
  incarnation: number;
  agent_id: string;
  thread_id: string;
  session_id: string | null;
  revision: number;
  observable: boolean;
  closed: boolean;
  servers: McpRuntimeServer[];
}
export interface McpRuntimeServer {
  server: string;
  generation: number;
  status: "connecting" | "connected" | "disconnected" | "error" | "closed";
  tools: string[];
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
export interface McpRuntimeEvent {
  kind: "mcp_runtime";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: McpRuntimeSession;
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
export interface ArtifactCatalogEvent {
  kind: "artifact_catalog";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: {
    artifacts: SessionArtifact[];
  };
}
export interface SessionArtifact {
  id: string;
  thread_id: ThreadId;
  title: string;
  /**
   * @minItems 1
   */
  versions: [SessionArtifactVersion, ...SessionArtifactVersion[]];
}
export interface SessionArtifactVersion {
  version: number;
  sha256: string;
  bytes: number;
  format: ContentFormat;
  media?: ArtifactMedia;
  filename?: string;
  source: ArtifactSource;
  source_message_id?: string;
  source_tool_call_id?: string;
  created_at: number;
}
export interface ArtifactDocumentMedia {
  kind: "document";
  format: ContentFormat;
}
export interface ArtifactSimpleMedia {
  kind: "csv" | "tsv" | "pdf" | "html" | "notebook";
}
export interface ArtifactImageMedia {
  kind: "image";
  mime_type: ArtifactImageType;
}
export interface ArtifactTextSource {
  kind: "text";
}
export interface ArtifactFileSource {
  kind: "file";
  path: string;
}
export interface ArtifactRegisteredEvent {
  kind: "artifact_registered";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: {
    artifact: SessionArtifact;
  };
}
export interface ArtifactDocumentEvent {
  kind: "artifact_document";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: DocumentHeader;
}
export interface ArtifactContextEvent {
  kind: "artifact_context";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: ContextReference;
}
/**
 * Main/Native-only descriptor response. Shells consume it before forwarding public events.
 */
export interface ArtifactSnapshotResultEvent {
  kind: "artifact_snapshot_result";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id?: string;
  data: ArtifactSnapshotResult;
}
export interface ArtifactSnapshotSuccess {
  ok: true;
  value: ArtifactSnapshot;
}
/**
 * Shell-private verified snapshot. The local path never enters the App or Wasm event stream.
 */
export interface ArtifactSnapshot {
  thread_id: ThreadId;
  artifact_id: string;
  version: number;
  filename: string;
  media: ArtifactMedia;
  sha256: string;
  bytes: number;
  path: string;
}
export interface ArtifactSnapshotFailure {
  ok: false;
  error: string;
}
export interface ArtifactErrorEvent {
  kind: "artifact_error";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id?: string;
  data: {
    thread_id: string | null;
    artifact_id: string | null;
    reason: "invalid" | "integrity" | "unavailable" | "unsupported" | "outside_workspace" | "read_write";
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
export interface AppAgentSessionOpenEvent {
  kind: "app_agent_session_open";
  version: 1;
  request_id: string | null;
  text: string;
  data: AppAgentSessionOpenData;
}
export interface AppAgentSessionOpenData {
  scope: AppChatScope;
  sessionId: string;
}
export interface AppAgentAttemptEvent {
  kind: "app_agent_attempt";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: AppAgentAttemptData;
}
export interface AppAgentAttemptData {
  attempt: AgentRunAttempt;
  runTime?: string;
}
export interface AgentRunAttempt {
  requestId: string;
  text: string;
  attempt: number;
  updatedAt: string;
}
export interface AppAgentCancelEvent {
  kind: "app_agent_cancel";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: AppAgentCancelData;
}
export interface AppAgentCancelData {
  runTime?: string;
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
  appPlugin?: AppPluginAssembly;
  agentPlugins?: AgentPluginRevision[];
}
export interface AppSessionBinding {
  app: AppName;
  requestId: string;
  agentId: string;
  prompt: string;
  run?: AgentRunBinding;
}
export interface AgentRunBinding {
  scope: AgentScope;
  requestId: string;
  harnessId: string;
  panel: string;
  runtimeDigest: string;
  appRevision?: string;
  createdAt: string;
  context?: AppDocumentSchema;
}
export interface AppPluginAssembly {
  app: AppName;
  revision: string;
  instructions: string;
  tools: AppWriteRoute[];
  maxCalls: number;
}
export interface AppWriteRoute {
  name: AppName;
  description: string;
  path: string;
  schema: AppDocumentSchema;
}
export interface AgentPluginRevision {
  name: AppName;
  version: string;
  revision: string;
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
  capacity: AutomationCapacityStatus;
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
  calendar_slots?: AutomationCalendarSlots;
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
  reprocess_of: string | null;
  operator_reconciliation: AutomationOperatorReconciliation | null;
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
export interface AutomationOperatorReconciliation {
  execution_id: string;
  disposition: AutomationReconciliationDisposition;
  evidence: string;
  recorded_at: AutomationCounter;
  previous_status: AutomationRequestStatus;
  authority: "local_operator";
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
    | "expired"
    | "reconciled"
    | "not_started";
}
export interface AutomationCoveredRequestStatus {
  kind: "covered";
  request_id: string;
}
export interface AutomationCalendarSlots {
  [k: string]: AutomationCounter | undefined;
}
export interface AutomationCapacityStatus {
  requests: AutomationCapacityCount;
  events: AutomationCapacityCount;
  snapshots: AutomationCapacityCount;
  definitions: AutomationCapacityCount;
  dispatches: AutomationCapacityCount;
  exhausted: AutomationCapacityKind[];
}
export interface AutomationCapacityCount {
  used: AutomationCounter;
  limit: AutomationCounter;
}
export interface AutomationCapabilities {
  owner: string;
  workspace: string;
  agents: AutomationAgentSummary[];
  supportedTargets: "local_host"[];
  supportedMethods: ("agent" | "research_watch")[];
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
export interface AppsResultEvent {
  kind: "apps_result";
  version: 1;
  request_id: string | null;
  text: string;
  data: AppResult;
}
export interface AppSuccess {
  ok: true;
  value:
    | LocalEnvironmentRecord[]
    | EnvironmentInspectionReport
    | AgentPreparedContext
    | AgentTerminalList
    | AppSdkContext
    | AgentRun
    | AgentRunTranscript
    | AgentRunLookupReply
    | AgentRunOpenReply
    | AgentCatalogReply
    | AutomationApiReply
    | AppRecord[]
    | AgentPluginSummary[]
    | AgentPluginSummary
    | AppAccess
    | ProjectResourceCatalog
    | AppAgentInfo
    | AppAgentStarted
    | AppAgentTranscript
    | AppAgentCancelled
    | AppGrant
    | ResearchAssetReply
    | ResearchBundleReply;
}
export interface LocalEnvironmentRecord {
  id: AppName;
  label: string;
  target: "paper-agent.pcgym" | "control-lab.python-control" | "control-lab.ngspice";
  dependencies: string[];
  state: "created" | "preparing" | "ready" | "failed";
  log: string[];
  error: string | null;
  bound: boolean;
}
export interface EnvironmentInspectionReport {
  schema: "pero.environment.inspection.v1";
  method: "paper-agent.pcgym" | "control-lab.python-control" | "control-lab.ngspice";
  scope: "configured-interpreter";
  evidence: "metadata_only";
  observed_at_ms: string;
  profile: AppDocumentSchema;
  requirements: AppDocumentSchema;
  matched: boolean;
  missing: AppDocumentSchema[];
}
export interface AgentPreparedContext {
  context: AppDocumentSchema;
}
export interface AgentTerminalList {
  terminals: AgentTerminal[];
}
export interface AgentTerminal {
  sessionId: string;
  name?: string;
  type: string;
  status: AgentTerminalStatus;
}
export interface AgentTerminalStatus {
  kind: string;
  exitCode?: number;
  signal?: string;
}
export interface AppSdkContext {
  name: AppName;
  version: string;
  permissions: AppSdkPermissions;
}
export interface AppSdkPermissions {
  api: string[];
  events: string[];
  host: string[];
}
export interface AgentRun {
  id: string;
  sessionId: string;
  scope: AgentScope;
  status: "running" | "needs_input" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
  attempt: number;
  requestId: string;
  updatedAt: string;
  error?: string;
  stopReason?: string;
}
export interface AgentRunTranscript {
  run: AgentRun;
  events: AgentRunEvent[];
  cursor: string;
}
export interface AgentRunEvent {
  seq: string;
  type: string;
  data: unknown;
}
export interface AgentRunLookupReply {
  requestId: string;
  run: AgentRun | null;
}
export interface AgentRunOpenReply {
  sessionId: string;
}
export interface AgentCatalogReply {
  items: (AgentWorkspace | AgentHarness)[];
}
export interface AgentWorkspace {
  workspaceId: string;
  title: string;
  path: string;
}
export interface AgentHarness {
  id: string;
  name: string;
  available: boolean;
}
export interface AutomationApiReply {
  status: number;
  body: unknown;
}
export interface AppRecord {
  name: AppName;
  version: string;
  revision: string;
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
export interface AgentPluginSummary {
  name: AppName;
  version: string;
  revision: string;
  enabled: boolean;
  [k: string]:
    | {
        [k: string]: unknown | undefined;
      }
    | AppName
    | boolean
    | undefined;
}
export interface AppAccess {
  root: string;
  entry: string;
  frameOrigins?: string[];
  backend?: BackendAccess;
}
/**
 * Host-to-main-process descriptor. Never forwarded to App or Workbench renderers.
 */
export interface BackendAccess {
  url: string;
  token: string;
}
export interface ProjectResourceCatalog {
  app: string;
  resources: ProjectResourceSummary[];
  error?: string | null;
}
export interface ProjectResourceSummary {
  reference: ProjectResourceReference;
  title: string;
  summary: string;
  status: string;
  verification?: string | null;
  location: string;
}
/**
 * An App catalog observation; revisions do not claim complete experimental provenance.
 */
export interface ProjectResourceReference {
  app: string;
  kind: string;
  id: string;
  revision: string;
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
export interface AppGrant {
  permitted: true;
}
/**
 * Data owns the domain source/job/catalog documents. The handoff has no private paths or tokens.
 */
export interface ResearchAssetReply {
  source: AppDocumentSchema | null;
  download: AppDocumentSchema | null;
  asset: AppDocumentSchema | null;
  receipt: AppDocumentSchema;
}
export interface ResearchBundleReply {
  bundleId: ResearchId;
  assets: ResearchAssetReply[];
}
export interface AppFailure {
  ok: false;
  error: string;
}
/**
 * Private acknowledgements intercepted by Desktop main.
 */
export interface AppsPreparationEvent {
  kind: "apps_preparation";
  version: 1;
  request_id: string | null;
  text: string;
  data: AppPreparation;
}
/**
 * Dependency preparation is separate from backend startup.
 */
export interface AppPreparation {
  name: AppName;
  phase: "required" | "checking" | "creating" | "installing" | "ready" | "failed";
  message: string;
}
export interface AppsCatalogEvent {
  kind: "apps_catalog";
  version: 1;
  request_id: string | null;
  text: string;
  data: AppRecord[];
}
export interface ProjectResourcesEvent {
  kind: "project_resources";
  version: 1;
  request_id: string | null;
  text: string;
  data: ProjectResourceCatalog;
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
export interface UserQuestionsEvent {
  kind: "user_questions";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: UserQuestionsData;
}
export interface UserQuestionsData {
  request_id: string;
  sessionId: string;
  toolCallId: string;
  /**
   * @minItems 1
   * @maxItems 4
   */
  questions:
    | [UserQuestion]
    | [UserQuestion, UserQuestion]
    | [UserQuestion, UserQuestion, UserQuestion]
    | [UserQuestion, UserQuestion, UserQuestion, UserQuestion];
}
export interface UserQuestion {
  question: string;
  header: string;
  /**
   * @minItems 2
   * @maxItems 4
   */
  options:
    | [QuestionOption, QuestionOption]
    | [QuestionOption, QuestionOption, QuestionOption]
    | [QuestionOption, QuestionOption, QuestionOption, QuestionOption];
  multiSelect?: boolean;
}
export interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}
export interface QuestionsResolvedEvent {
  kind: "user_questions_resolved";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: QuestionsResolvedData;
}
export interface QuestionsResolvedData {
  request_id: string;
  toolCallId: string;
}
export interface QuestionsErrorEvent {
  kind: "user_questions_error";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
  data: QuestionsErrorData;
}
export interface QuestionsErrorData {
  request_id: string;
  error: string;
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
