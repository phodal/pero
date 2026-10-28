// Host JSONL protocol between the Electron shell and `pero-host --stdio`.
// Source of truth for protocol/generated/; run `npm run gen:contracts` after edits.
import "@typespec/json-schema";

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
model AttachFilesCommand { action: "attach_files"; paths: string[]; ...Closed }
model AuthenticateCommand { action: "authenticate"; thread_id: string; method_id: string; ...Closed }
model NewSessionCommand { action: "new_session"; thread_id: ThreadId; agent_id: string; ...Closed }
model PromptCommand { action: "prompt"; thread_id: string; @maxLength(64000) text: string; ...Closed }
model CancelCommand { action: "cancel"; thread_id: string; ...Closed }
model PermissionCommand {
  action: "permission";
  thread_id: string;
  request_id: string;
  option_id?: string | null;
  ...Closed;
}
model ModelCommand { action: "model"; thread_id: string; model_id: string; ...Closed }
model CloseCommand { action: "close"; thread_id: string; ...Closed }

/** Run `program` with the allowlisted environment. The interpreter path stays on the Host. */
model RunCodeCommand {
  action: "run_code";
  @minLength(1) @maxLength(128) id: string;
  @minLength(1) @maxLength(64) env_id: string;
  @minLength(1) @maxLength(65536) program: string;
  ...Closed;
}
model CancelCodeCommand {
  action: "cancel_code";
  @minLength(1) @maxLength(128) id: string;
  ...Closed;
}

@oneOf
union HostCommand {
  ListAgentsCommand,
  WorkspaceCommand,
  AttachFilesCommand,
  AuthenticateCommand,
  NewSessionCommand,
  PromptCommand,
  CancelCommand,
  PermissionCommand,
  ModelCommand,
  CloseCommand,
  RunCodeCommand,
  CancelCodeCommand,
}

@oneOf
union HostInput {
  EchoRequest,
  SetLocaleRequest,
  SetRemoteSettingsRequest,
  HostCommand,
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
/** Main-process acknowledgements contain no persisted connection payload. */
model RemoteSettingsSavedEvent { kind: "remote_settings_saved"; ...EventBase }
model RemoteSettingsErrorEvent { kind: "remote_settings_error"; ...EventBase }
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
model WorkspaceEvent { kind: "workspace"; ...EventBase }
model ContextFile { path: string; name: string; text: string; ...Closed }
model ContextFilesEvent { kind: "context_files"; ...EventBase; data: ContextFile[] }
/** Main-process HTTP adapter snapshot; validated by protocol/remote.tsp. */
model RemoteSnapshotPayload is Record<unknown>;
model RemoteStateEvent { kind: "remote_state"; ...EventBase; data: RemoteSnapshotPayload }
/** Open remote tasks from the native Workbench menu or keyboard. */
model RemoteOpenEvent { kind: "remote_open"; ...EventBase }

model SessionCreatedData { agent: string; workspace: string; ...Closed }
model SessionCreatedEvent { kind: "session_created"; ...ThreadEventBase; data: SessionCreatedData }
model UserMessageEvent { kind: "user_message"; ...ThreadEventBase }
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
model SessionErrorEvent { kind: "session_error"; ...ThreadEventBase }
model SessionClosedEvent { kind: "session_closed"; ...ThreadEventBase }

/** `text` is the stop: exit, cancel, deadline, or unknown. */
model CodeRunReceipt {
  stop: "exit" | "cancel" | "deadline" | "unknown";
  exit_code: int32 | null;
  @minLength(64) @maxLength(64) program_digest: string;
  @minLength(1) @maxLength(4096) interpreter: string;
  @minLength(1) @maxLength(4096) prefix: string;
  @maxLength(64) marker_digest: string;
  @maxLength(65536) stdout: string;
  @maxLength(65536) stderr: string;
  truncated: boolean;
  ...Closed;
}
model CodeRunEvent { kind: "code_run"; ...EventBase; data: CodeRunReceipt }

/** Events persisted to the session journal and replayed to the UI. */
@oneOf
union ThreadEvent {
  SessionCreatedEvent,
  UserMessageEvent,
  SessionUpdateEvent,
  SessionReadyEvent,
  ModelChangedEvent,
  TurnFinishedEvent,
  SessionErrorEvent,
  SessionClosedEvent,
}

@oneOf
union HostEvent {
  SettingsEvent,
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
  ContextFilesEvent,
  RemoteStateEvent,
  RemoteOpenEvent,
  ThreadEvent,
  SessionConnectingEvent,
  AgentInfoEvent,
  SessionAuthRequiredEvent,
  SessionAuthErrorEvent,
  SessionAuthenticatedEvent,
  PermissionEvent,
  PromptQueuedEvent,
  CommandRejectedEvent,
  TurnStartedEvent,
  CodeRunEvent,
}
