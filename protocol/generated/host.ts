/* Generated from protocol/host.tsp by scripts/codegen/contracts.mjs. Do not edit. */

/**
 * Generated from protocol/host.tsp. Do not edit.
 */
export type HostProtocol = HostInput | HostEvent;
export type HostInput = EchoRequest | SetLocaleRequest | SetRemoteSettingsRequest | HostCommand;
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
  | CloseCommand
  | RunCodeCommand
  | CancelCodeCommand;
export type ThreadId = string;
export type HostEvent =
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
  | TurnFinishedEvent
  | SessionErrorEvent
  | SessionClosedEvent;

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
 * Main-process HTTP adapter snapshot; validated by protocol/remote.tsp.
 */
export interface RemoteSnapshotPayload {
  [k: string]: unknown | undefined;
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
