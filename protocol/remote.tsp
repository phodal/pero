// Operator and Worker HTTP protocol. Credentials never enter renderer snapshots.
import "@typespec/json-schema";
using JsonSchema;
@jsonSchema
namespace Pero.Remote;

model Closed { ...Record<never>; }
@minLength(1) @maxLength(128) scalar Id extends string;
union RunStatus { "queued", "running", "cancel_requested", "succeeded", "failed", "cancelled", "reconcile" }
union TaskStatus { "draft", RunStatus }
union Outcome { "succeeded", "failed", "cancelled", "reconcile" }

model Source {
  kind: "github" | "roadmap";
  repository: string;
  issue_number?: safeint;
  url: string;
  revision: string;
  state: "open" | "closed" | "missing";
  updated_at?: string;
  issue_id?: string;
  repository_id: string;
  path?: string;
  item_id?: string;
  parent_item_id?: string;
  line?: safeint;
  depth?: safeint;
  headings?: string[];
  tags?: string[];
  commit_sha?: string;
  blob_sha?: string;
  missing_at_commit?: string;
  ...Closed;
}
model Claimant { id: Id; name: string; ...Closed }
model Identity { id: Id; name: string; role: "operator" | "client"; projects: string[]; ...Closed }
model GitHubRepositoryStatus {
  project_id: string; owner: string; repo: string; auto_dispatch: boolean; required_label: string;
  last_synced_at?: string; partial: boolean; error?: string;
  roadmap_path?: string;
  ...Closed;
}
model GitHubStatus {
  configured: boolean; repositories: GitHubRepositoryStatus[]; errors: string[]; running: boolean;
  ...Closed;
}
model GitHubSyncResult { imported: safeint; updated: safeint; dispatched: safeint; missing?: safeint; partial: boolean; errors: string[]; ...Closed }
model ClientCredential { client: Identity; token: string; ...Closed }

model TaskSpec {
  @minLength(1) @maxLength(240) title: string;
  @minLength(1) @maxLength(64000) prompt: string;
  @minLength(1) @maxLength(16000) acceptance: string;
  project_id: Id;
  workspace_key: Id;
  agent_id: Id;
  source?: Source;
  parent_task_id?: string;
  tags?: string[];
  ...Closed;
}
// Selected by the trusted control plane, never accepted in TaskSpec.
model RemoteExecution { session_id: Id; working_directory: "/workspace/repo"; ...Closed }
model Run {
  id: Id;
  task_id: Id;
  generation: safeint;
  worker_id?: string;
  instance_id?: string;
  status: RunStatus;
  lease_expires_at?: string | null;
  spec: TaskSpec;
  remote_execution?: RemoteExecution;
  summary?: string;
  created_at?: string;
  updated_at?: string;
  ...Closed;
}
model Task {
  ...TaskSpec;
  id: Id;
  state: TaskStatus;
  current_run_id?: string;
  run?: Run | null;
  claimed_by?: Claimant;
  latest_source?: Source;
  created_at?: string;
  updated_at?: string;
  ...Closed;
}
model Worker {
  id: Id;
  name: string;
  projects: string[];
  labels?: string[];
  last_seen_at?: string | null;
  created_at?: string;
  ...Closed;
}
model RunEvent {
  seq: safeint;
  kind: string;
  text: string;
  data?: unknown;
  created_at?: string;
  ...Closed;
}
model Detail {
  task: Task;
  run: Run | null;
  events: RunEvent[];
  events_truncated: boolean;
  events_first_seq: safeint | null;
  events_last_seq: safeint | null;
  ...Closed;
}
model TaskPage { tasks: Task[]; has_more: boolean; next_cursor: string | null; ...Closed }
model EventReceipt { accepted: safeint; last_seq: safeint; ...Closed }
model RemoteState {
  configured: boolean;
  loading: boolean;
  error: string | null;
  tasks: Task[];
  has_more: boolean;
  workers: Worker[];
  selected_task_id: string | null;
  detail: Detail | null;
  identity?: Identity | null;
  github?: GitHubStatus | null;
  connection?: RemoteConnection;
  source_kind?: "" | "github" | "roadmap";
  tag?: string;
  ...Closed;
}
model RemoteConnection {
  url: string;
  mode: "client" | "operator";
  credential_configured: boolean;
  persistence_available: boolean;
  authenticating?: boolean;
  ...Closed;
}
model ProvisionWorker { name: string; projects: string[]; labels?: string[]; ...Closed }
model WorkerCapability { project_id: Id; workspace_key: Id; agent_id: Id; ...Closed }
model EnrollWorker { device_id: Id; request_id: Id; name: string; projects: string[]; capabilities: WorkerCapability[]; @minLength(64) @maxLength(64) enrollment_secret: string; ...Closed }
model DisableWorkerResult { disabled: boolean; ...Closed }
model WorkerCredential { worker: Worker; token: string; ...Closed }
model Dispatch { worker_id?: string; ...Closed }
model Claim { request_id: Id; instance_id: Id; runtime_pod_uid?: Id; ...Closed }
model ClaimResult { run: Run | null; ...Closed }
model LeaseIdentity { generation: safeint; instance_id: Id; ...Closed }
model RenewResult { cancel_requested: boolean; lease_expires_at: string; ...Closed }
model EventBatch { ...LeaseIdentity; events: RunEvent[]; ...Closed }
model Complete { ...LeaseIdentity; outcome: Outcome; @maxLength(16000) summary: string; ...Closed }
model ErrorResponse { error: string; ...Closed }


// Operator-only resource bindings are audit evidence, never execution grants.
model RuntimeReference { kind: string; id: string; revision?: string; digest?: string; ...Closed }
model RuntimeOwner { kind: string; id: string; ...Closed }
model RuntimeResource { owner: RuntimeOwner; kind: string; scope: string; id: string; incarnation: string; ...Closed }
model RuntimeCondition { status: "True" | "False" | "Unknown"; reason: string; ...Closed }
model RuntimeAttributes { ...Record<string>; }
model RuntimeObservation {
  resource: RuntimeResource; runtime?: RuntimeReference; receipt: RuntimeReference;
  observedAt: string; ready: RuntimeCondition; states?: RuntimeReference[];
  artifacts?: RuntimeReference[]; attributes?: RuntimeAttributes; leaseExpiresAt?: string;
  ...Closed;
}
model SandboxConfig {
  profile?: "trusted-worker-pod" | "isolated-agent-v1";
  runtime_class?: string; service_account?: string; service_account_uid?: string;
  audience?: string; control_url?: string; control_ca_file?: string; image_ref?: string;
  `model`?: string; storage_class?: string; storage_access_mode?: string; volume_size?: string;
  cluster_id: Id; `namespace`: string; warm_pool: string; worker_id: Id; project_id: Id;
  workspace_key: Id; agent_id: Id; image_digest: string; workspace_revision: string;
  template_digest: string; ttl_seconds: safeint;
  ...Closed;
}
model RuntimeVolumeBinding { resource: RuntimeResource; volume_name?: string; provider_digest: string; ...Closed }
model RuntimeBinding {
  run_id: Id; request_id: Id; version: safeint; config: SandboxConfig;
  phase: "pending" | "ready" | "reconcile" | "cleanup_pending" | "released";
  reason: string; created_at: string; resource?: RuntimeResource;
  snapshot?: RuntimeObservation; valid_until?: string; release_requested: boolean;
  volume?: RuntimeVolumeBinding; compute_receipt?: RuntimeReference;
  cleanup_receipt?: RuntimeReference;
  ...Closed;
}
model SandboxDispatchResult { run: Run; runtime: RuntimeBinding; ...Closed }

@oneOf
union RemoteProtocol { TaskSpec, Task, Run, Worker, RunEvent, RemoteState, TaskPage, EventReceipt, ProvisionWorker, EnrollWorker, WorkerCapability, DisableWorkerResult, WorkerCredential, ClientCredential, Identity, GitHubStatus, GitHubSyncResult, Dispatch, Claim, ClaimResult, LeaseIdentity, RenewResult, EventBatch, Complete, RuntimeBinding, SandboxDispatchResult, ErrorResponse }
