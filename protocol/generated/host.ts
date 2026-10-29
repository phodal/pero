/* Generated from protocol/host.tsp by scripts/codegen/contracts.mjs. Do not edit. */

/**
 * Generated from protocol/host.tsp. Do not edit.
 */
export type HostProtocol = HostInput | HostEvent;
export type HostInput =
  | LocalWorkerRequest
  | EchoRequest
  | SetLocaleRequest
  | SetRemoteSettingsRequest
  | GetWorkbenchSettingsRequest
  | SetWorkbenchSettingsRequest
  | HostCommand
  | AppRequest
  | ContributionRequest;
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
  | DeleteCommand;
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
  | CommandRejectedEvent;
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
export type AppResult = AppSuccess | AppFailure;
export type AppAgentStatus = "running" | "text" | "needs_input" | "completed" | "cancelled" | "failed";

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
