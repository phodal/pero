/* Generated from protocol/remote.tsp by scripts/codegen/contracts.mjs. Do not edit. */

/**
 * Generated from protocol/remote.tsp. Do not edit.
 */
export type RemoteProtocol = RemoteProtocol1;
export type RemoteProtocol1 =
  | TaskSpec
  | Task
  | Run
  | Worker
  | RunEvent
  | RemoteState
  | TaskPage
  | EventReceipt
  | ProvisionWorker
  | EnrollWorker
  | WorkerCapability
  | DisableWorkerResult
  | WorkerCredential
  | ClientCredential
  | Identity
  | GitHubStatus
  | GitHubSyncResult
  | Dispatch
  | Claim
  | ClaimResult
  | LeaseIdentity
  | RenewResult
  | EventBatch
  | Complete
  | RuntimeBinding
  | SandboxDispatchResult
  | ErrorResponse;
export type Id = string;
export type TaskStatus = "draft" | RunStatus;
export type RunStatus = "queued" | "running" | "cancel_requested" | "succeeded" | "failed" | "cancelled" | "reconcile";
export type Outcome = "succeeded" | "failed" | "cancelled" | "reconcile";

export interface TaskSpec {
  title: string;
  prompt: string;
  acceptance: string;
  project_id: Id;
  workspace_key: Id;
  agent_id: Id;
  source?: Source;
  parent_task_id?: string;
  tags?: string[];
}
export interface Source {
  kind: "github" | "roadmap";
  repository: string;
  issue_number?: number;
  url: string;
  revision: string;
  state: "open" | "closed" | "missing";
  updated_at?: string;
  issue_id?: string;
  repository_id: string;
  path?: string;
  item_id?: string;
  parent_item_id?: string;
  line?: number;
  depth?: number;
  headings?: string[];
  tags?: string[];
  commit_sha?: string;
  blob_sha?: string;
  missing_at_commit?: string;
}
export interface Task {
  title: string;
  prompt: string;
  acceptance: string;
  project_id: Id;
  workspace_key: Id;
  agent_id: Id;
  source?: Source;
  parent_task_id?: string;
  tags?: string[];
  id: Id;
  state: TaskStatus;
  current_run_id?: string;
  run?: Run | null;
  claimed_by?: Claimant;
  latest_source?: Source;
  created_at?: string;
  updated_at?: string;
  [k: string]:
    | {
        [k: string]: unknown | undefined;
      }
    | string
    | Source
    | string[]
    | TaskStatus
    | Run
    | null
    | Claimant
    | undefined;
}
export interface Run {
  id: Id;
  task_id: Id;
  generation: number;
  worker_id?: string;
  instance_id?: string;
  status: RunStatus;
  lease_expires_at?: string | null;
  spec: TaskSpec;
  summary?: string;
  created_at?: string;
  updated_at?: string;
}
export interface Claimant {
  id: Id;
  name: string;
}
export interface Worker {
  id: Id;
  name: string;
  projects: string[];
  labels?: string[];
  last_seen_at?: string | null;
  created_at?: string;
}
export interface RunEvent {
  seq: number;
  kind: string;
  text: string;
  data?: unknown;
  created_at?: string;
}
export interface RemoteState {
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
}
export interface Detail {
  task: Task;
  run: Run | null;
  events: RunEvent[];
  events_truncated: boolean;
  events_first_seq: number | null;
  events_last_seq: number | null;
}
export interface Identity {
  id: Id;
  name: string;
  role: "operator" | "client";
  projects: string[];
}
export interface GitHubStatus {
  configured: boolean;
  repositories: GitHubRepositoryStatus[];
  errors: string[];
  running: boolean;
}
export interface GitHubRepositoryStatus {
  project_id: string;
  owner: string;
  repo: string;
  auto_dispatch: boolean;
  required_label: string;
  last_synced_at?: string;
  partial: boolean;
  error?: string;
  roadmap_path?: string;
}
export interface RemoteConnection {
  url: string;
  mode: "client" | "operator";
  credential_configured: boolean;
  persistence_available: boolean;
  authenticating?: boolean;
}
export interface TaskPage {
  tasks: Task[];
  has_more: boolean;
  next_cursor: string | null;
}
export interface EventReceipt {
  accepted: number;
  last_seq: number;
}
export interface ProvisionWorker {
  name: string;
  projects: string[];
  labels?: string[];
}
export interface EnrollWorker {
  device_id: Id;
  request_id: Id;
  name: string;
  projects: string[];
  capabilities: WorkerCapability[];
  enrollment_secret: string;
}
export interface WorkerCapability {
  project_id: Id;
  workspace_key: Id;
  agent_id: Id;
}
export interface DisableWorkerResult {
  disabled: boolean;
}
export interface WorkerCredential {
  worker: Worker;
  token: string;
}
export interface ClientCredential {
  client: Identity;
  token: string;
}
export interface GitHubSyncResult {
  imported: number;
  updated: number;
  dispatched: number;
  missing?: number;
  partial: boolean;
  errors: string[];
}
export interface Dispatch {
  worker_id?: string;
}
export interface Claim {
  request_id: Id;
  instance_id: Id;
  runtime_pod_uid?: Id;
}
export interface ClaimResult {
  run: Run | null;
}
export interface LeaseIdentity {
  generation: number;
  instance_id: Id;
}
export interface RenewResult {
  cancel_requested: boolean;
  lease_expires_at: string;
}
export interface EventBatch {
  generation: number;
  instance_id: Id;
  events: RunEvent[];
  [k: string]:
    | {
        [k: string]: unknown | undefined;
      }
    | number
    | Id
    | RunEvent[]
    | undefined;
}
export interface Complete {
  generation: number;
  instance_id: Id;
  outcome: Outcome;
  summary: string;
  [k: string]:
    | {
        [k: string]: unknown | undefined;
      }
    | number
    | Id
    | Outcome
    | undefined;
}
export interface RuntimeBinding {
  run_id: Id;
  request_id: Id;
  version: number;
  config: SandboxConfig;
  phase: "pending" | "ready" | "reconcile" | "cleanup_pending" | "released";
  reason: string;
  created_at: string;
  resource?: RuntimeResource;
  snapshot?: RuntimeObservation;
  valid_until?: string;
  release_requested: boolean;
  cleanup_receipt?: RuntimeReference;
}
export interface SandboxConfig {
  cluster_id: Id;
  namespace: string;
  warm_pool: string;
  worker_id: Id;
  project_id: Id;
  workspace_key: Id;
  agent_id: Id;
  image_digest: string;
  workspace_revision: string;
  template_digest: string;
  ttl_seconds: number;
}
export interface RuntimeResource {
  owner: RuntimeOwner;
  kind: string;
  scope: string;
  id: string;
  incarnation: string;
}
export interface RuntimeOwner {
  kind: string;
  id: string;
}
export interface RuntimeObservation {
  resource: RuntimeResource;
  runtime?: RuntimeReference;
  receipt: RuntimeReference;
  observedAt: string;
  ready: RuntimeCondition;
  states?: RuntimeReference[];
  artifacts?: RuntimeReference[];
  attributes?: RuntimeAttributes;
  leaseExpiresAt?: string;
}
export interface RuntimeReference {
  kind: string;
  id: string;
  revision?: string;
  digest?: string;
}
export interface RuntimeCondition {
  status: "True" | "False" | "Unknown";
  reason: string;
}
export interface RuntimeAttributes {
  [k: string]: string | undefined;
}
export interface SandboxDispatchResult {
  run: Run;
  runtime: RuntimeBinding;
}
export interface ErrorResponse {
  error: string;
}
