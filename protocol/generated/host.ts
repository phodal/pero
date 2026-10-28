/* Generated from protocol/host.tsp by scripts/codegen/contracts.mjs. Do not edit. */

/**
 * Generated from protocol/host.tsp. Do not edit.
 */
export type HostProtocol = HostInput | HostEvent;
export type HostInput =
  EchoRequest | SetLocaleRequest | SetRemoteSettingsRequest | HostCommand | AppRequest | ContributionRequest;
export type HostCommand =
  | ListAgentsCommand
  | WorkspaceCommand
  | AttachFilesCommand
  | AuthenticateCommand
  | NewSessionCommand
  | PromptCommand
  | CancelCommand
  | PermissionCommand
  | ModelCommand
  | ConfigureCommand
  | CloseCommand
  | RunCodeCommand
  | CancelCodeCommand;
export type ThreadId = string;
export type AppRequest = ListApps | InstallApp | EnableApp | DisableApp | UninstallApp | ResolveApp;
export type RequestId = string;
export type AppName = string;
export type ContributionRequest = ContributionPrepare | ContributionReview | ContributionPublish;
export type HostEvent =
  | ContributorStateEvent
  | ContributorSessionEvent
  | ContributionResultEvent
  | ContributionErrorEvent
  | SettingsEvent
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
  | ContextFilesEvent
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
  | CommandRejectedEvent
  | TurnStartedEvent
  | CodeRunEvent;
/**
 * Catalog key resolved by the UI from locales/*.json.
 */
export type MessageKey = string;
/**
 * Events persisted to the session journal and replayed to the UI.
 */
export type ThreadEvent =
  | SessionCreatedEvent
  | UserMessageEvent
  | SessionUpdateEvent
  | SessionReadyEvent
  | ModelChangedEvent
  | ConfigurationChangedEvent
  | TurnFinishedEvent
  | SessionErrorEvent
  | SessionClosedEvent;
export type AppResult = AppSuccess | AppFailure;

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
export interface ListAgentsCommand {
  action: "list_agents";
}
export interface WorkspaceCommand {
  action: "workspace";
  path: string;
}
export interface AttachFilesCommand {
  action: "attach_files";
  paths: string[];
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
}
export interface PromptCommand {
  action: "prompt";
  thread_id: string;
  text: string;
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
/**
 * Run `program` with the allowlisted environment. The interpreter path stays on the Host.
 */
export interface RunCodeCommand {
  action: "run_code";
  id: string;
  env_id: string;
  program: string;
}
export interface CancelCodeCommand {
  action: "cancel_code";
  id: string;
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
}
export interface UserMessageEvent {
  kind: "user_message";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
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
/**
 * `text` is the selected workspace path.
 */
export interface WorkspaceEvent {
  kind: "workspace";
  version: 1;
  request_id: string | null;
  text: string;
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
  value: AppRecord[] | AppAccess;
}
/**
 * Public catalog: no local paths or backend credentials.
 */
export interface AppRecord {
  name: AppName;
  version: string;
  displayName: string;
  description: string;
  enabled: boolean;
  panels: AppPanel[];
}
export interface AppPanel {
  id: AppName;
  title: string;
  entry: string;
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
export interface TurnStartedEvent {
  kind: "turn_started";
  version: 1;
  request_id: string | null;
  text: string;
  thread_id: string;
}
export interface CodeRunEvent {
  kind: "code_run";
  version: 1;
  request_id: string | null;
  text: string;
  data: CodeRunReceipt;
}
/**
 * `text` is the stop: exit, cancel, deadline, or unknown.
 */
export interface CodeRunReceipt {
  stop: "exit" | "cancel" | "deadline" | "unknown";
  exit_code: number | null;
  program_digest: string;
  interpreter: string;
  prefix: string;
  marker_digest: string;
  stdout: string;
  stderr: string;
  truncated: boolean;
}
