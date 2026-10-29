# Remote Worker

The independent Rust Worker pulls one authorized Run at a time from the Go
control plane and executes it through `pero-runtime`'s official ACP integration.
It does not require Electron to remain open.

Build with `node scripts/cargo.mjs build -p pero-worker`. Configure these local
environment variables, then run `target/debug/pero-worker` (`--once` checks the
queue once and exits after at most one execution):

- `PERO_CLOUD_URL`: HTTPS origin. HTTP is accepted only for loopback development.
- `PERO_WORKER_TOKEN`: project-scoped token returned when the operator provisions
  a Worker. It is separate from the operator token.
- `PERO_WORKER_CONFIG`: path to the local configuration below.
- `PERO_WORKER_STATE`: path to a persistent local journal, on durable local storage.

```json
{
  "workspaces": { "default": "/srv/pero/workspaces/example" },
  "agents_file": "agents.json"
}
```

`agents_file` is an array of local `AgentConfig` entries, for example:

```json
[
  { "id": "codex", "name": "Codex", "command": "/usr/local/bin/codex-acp", "args": [], "env": {} }
]
```

Relative configuration paths resolve beside the Worker configuration file. If
`agents_file` is omitted, the existing local ACP registry supplies the allowed
Agents. Cloud tasks supply only `workspace_key` and `agent_id`, never executable
commands or directory paths. Protect local configuration and provider credentials
with the Worker OS account's file permissions.

The Worker persists the claim identity before contacting Cloud and the Run before
launching any Agent. Events are journaled before upload and assigned monotonic
sequence numbers. Completion receipts are retried with the same payload. Each
batch stays below 480 KiB of encoded JSON, including its envelope. Individual
event fields are checked against the Go API's byte limits before journaling.
The supervised execution input accepts up to 512 KiB, including full-length
Unicode prompts and acceptance criteria.
A restart reconciles interrupted execution without replaying its prompt, then
stops so the operator can review effects. The journal has an exclusive process
lock, and the selected checkout has an exclusive `.pero-worker.lock` write lock.

Renewals continue even while the Agent produces no output. An independent
monotonic watchdog stops execution when its lease expires. The Worker first
requests ACP cancellation, then enforces bounded cleanup of its executor and
the Agent's separate SDK process group. The executor also detects supervisor
death. Failure to confirm cleanup produces `reconcile` and stops task intake.
Unattended permission requests are denied by default (see the opt-in native shell
policy below). All `PERO_*` environment variables are
removed from the executor and Agent configuration; provider credentials should
use the provider's own variable names.

The versioned Worker HTTP contract is owned by the Go control plane and is
independent of Kubernetes or another resource provider.

This slice supports Unix hosts with `/bin/ps`; macOS has been exercised, while
deployed Linux acceptance remains pending. It uses an explicitly allowed,
trusted shared checkout. Process groups and workspace locks do not isolate
untrusted code, and deliberately detached processes require a stronger runtime
such as a container/cgroup or VM. Agent success records only the completed turn;
independent verification, acceptance and publication remain separate.

Run `node scripts/cargo.mjs test -p pero-worker` for journal, protocol, subprocess,
permission, cancellation, lease-loss and interrupted-claim checks. The HTTP/ACP
fixtures do not establish production or real model-provider acceptance.


### Opt-in native shell admission

Default unattended permission behavior remains **deny**. A trusted operator may
add `native_approvals` to the Worker config, keyed by an already allowed workspace
key. Each entry must contain `agent_id`, canonical absolute `executable`, lowercase
`sha256`, exact `args` and `env`, `operations: ["shell"]`, and `sandbox_mode`
(`workspace-write` or `read-only`). An explicit `agents_file` is required. The
config, agent allowlist, executable, and their ancestors must be operator-owned,
not group/world writable, and outside every configured writable workspace.
Do not put these files under `/tmp` or a model-editable checkout.

The executable pin is checked before dispatch and again in the supervised child.
Opted-in executions inherit **no environment**; configure necessary provider
settings explicitly in the operator-owned agent environment. Never pin a general
interpreter or a launcher that loads model-writable plugins/config/code. The
operator must trust the pinned native agent to implement this contract; a digest
alone does not certify agent behavior. Installation replacement requires stopping
Workers first; this is not an executable-file locking mechanism.

Only live ACP requests from that process, matching the active session and exact
workspace, may select one `allow_once` option. A version-1 descriptor under ACP
`_meta["pero.dev/native-approval"]` must carry `operation: "shell"`, the canonical
`workspace`, matching `sandbox_mode`, `enforcement: "required"`, and
`network: "deny"`. This describes a required plan, **not proof that a command has
already run in a sandbox**. The native executor must refuse dispatch if actual OS
enforcement is unavailable. Permission requests without this native shell
descriptor (including write/edit or MCP-origin approval requests) remain denied.
This policy does not sandbox or disable separately configured MCP servers.
Titles, model arguments, permission names, and MCP hints are never authority.
Replayed calls, unknown sessions, ambiguous/persistent options and requests after
cancellation or completion are denied. Only a redacted decision event is uploaded;
no approval controls or tool arguments are sent to the coordinator.

Strict sandbox admission also requires operator-controlled workspace ancestors and
runtime mounts, with no concurrent external host mutation during admission/launch.
The native sandbox's workspace scan rejects hardlinked files and special endpoints;
it does not provide an adversarial filesystem snapshot. Do not enroll untrusted
shared checkouts or runtime mounts in this opt-in policy.

### Trusted Agent Sandbox pool identity

When launched from the fixed Agent Sandbox template, `PERO_RUNTIME_POD_UID` is
provided by Kubernetes' Downward API. The Worker persists it in each pending claim
and reuses that original value after a lost response or restart, even if the
current environment differs. Old journals without the field remain readable.
The control plane admits only the matching ready RuntimeBinding and rejects
changed claim identity; this is not Pod attestation or untrusted-code isolation.
The existing lease, journal, permission-denial and no-prompt-replay behavior is
unchanged. See [deployment/agent-sandbox](../../deployment/agent-sandbox/README.md).

### External Worker with isolated Agent

For the separate `isolated-agent-v1` profile, install `pero-acp-bridge` beside the
trusted Worker, **outside** the Agent Pod. Its operator-owned configuration may be
remote-only:

```json
{ "remote_bridge": "/opt/pero/bin/pero-acp-bridge" }
```

Build the bridge with `go -C server build ./cmd/pero-acp-bridge`. Protect the
installed executable, Worker configuration and journal from Agent writes. The
control plane selects `Run.remote_execution`; Tasks cannot provide its command,
URL, session or working directory. This mode does not set `PERO_RUNTIME_POD_UID`.
A remote Run without a configured bridge fails closed rather than launching a
local Agent. Local `native_approvals` are incompatible with remote execution;
permission requests remain denied. Host MCP servers and host fs/terminal callbacks
are rejected, and only ACP `session/new.cwd` is rewritten to `/workspace/repo`.

Before channel issuance, the Worker persists a random, exact-Run secret in the
private journal. The bridge receives only this scoped secret, not the Worker
bearer or inherited provider credentials. This is the sole deliberate `PERO_*`
exception to local Agent filtering. Recovery reconciles the original grant and
Run without reopening a stream or replaying a prompt. A channel is single-use,
bounded to 15 minutes, 256 KiB per JSONL message and 64 MiB total in both directions.

The Pod contains `pero-agent-connect` and the fixed Go ACP executable, not this
Worker. Its projected Kubernetes token is usable by hostile Pod code, but the
control plane authenticates and restricts it to the original Run/Pod/audience;
it is not a Worker token or a provider API key. Provider requests use a fixed
server-owned endpoint/model and budget. EOF closes local processes, while actual
hostile-writer quiescence and retained-volume export belong to the Kubernetes
runtime and trusted collector, not Unix process groups or the Worker receipt.
EOF after a confirmed ACP `end_turn` can precede the ordinary completion receipt;
transport closure itself does not decide the Run outcome.
