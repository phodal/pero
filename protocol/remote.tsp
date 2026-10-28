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
model Run {
  id: Id;
  task_id: Id;
  generation: safeint;
  worker_id?: string;
  instance_id?: string;
  status: RunStatus;
  lease_expires_at?: string | null;
  spec: TaskSpec;
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
model WorkerCredential { worker: Worker; token: string; ...Closed }
model Dispatch { worker_id?: string; ...Closed }
model Claim { request_id: Id; instance_id: Id; ...Closed }
model ClaimResult { run: Run | null; ...Closed }
model LeaseIdentity { generation: safeint; instance_id: Id; ...Closed }
model RenewResult { cancel_requested: boolean; lease_expires_at: string; ...Closed }
model EventBatch { ...LeaseIdentity; events: RunEvent[]; ...Closed }
model Complete { ...LeaseIdentity; outcome: Outcome; @maxLength(16000) summary: string; ...Closed }
model ErrorResponse { error: string; ...Closed }

@oneOf
union RemoteProtocol { TaskSpec, Task, Run, Worker, RunEvent, RemoteState, TaskPage, EventReceipt, ProvisionWorker, WorkerCredential, ClientCredential, Identity, GitHubStatus, GitHubSyncResult, Dispatch, Claim, ClaimResult, LeaseIdentity, RenewResult, EventBatch, Complete, ErrorResponse }
