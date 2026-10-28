# Headless Go agent harness

Independent Go module `github.com/phodal/pero/harness/go` (Go 1.25+).
The native DSH-derived agent loop, durable sessions, provider routing and ACP
stdio server are reused; this is not the Point application with its UI disabled.

## Build and run

```sh
cd harness/go
go test -count=1 ./...
go test -race -count=1 ./...
go vet ./...
go build -o pero-agent-acp ./cmd/pero-agent-acp
./pero-agent-acp \
  --endpoint https://YOUR-PROVIDER/v1 --model YOUR-MODEL \
  --session-dir /private/path/to/sessions \
  --workspace /absolute/workspace --enable-shell --approval ask
```

No endpoint, model or credential is discovered from Point settings or accounts.
Credentials are read only from the named environment variable (`--api-key-env`),
not a CLI secret argument. The selected variable is cleared from this process
after reading so MCP children do not inherit it. The explicit endpoint must be HTTPS (loopback HTTP is
permitted for local protocol tests). Stdout is ACP NDJSON only; diagnostics use
stderr. Session files contain prompts, tool results and model output: use a
private directory, and define your own retention policy.

An [isolated Bazel build](BAZEL.md) is available from `harness/go`. Its build
graph is separate from the root server pilot; the server Go version and
dependencies are unchanged. Native Go commands above remain supported.


## Explicit budgets and compatible-provider options

Provider calls are unbounded by default. For a small authorized smoke test, use
`--max-requests 4 --max-tokens 512 --max-retries 0`: the request cap spans the
Agent process lifetime and includes failed attempts; the output cap applies to
each request. SDK retries are disabled independently. Omitted retry configuration
retains the Harness policy, so set zero explicitly when paid retries are unwanted.

For compatible DeepSeek Chat Completions, `--disable-thinking` explicitly sends
`thinking: {"type":"disabled"}`; it is omitted by default. Do not rely on
`--reasoning-effort none` as a substitute for this Chat Completions toggle.
Other providers receive no host-inferred extensions.

Connections are direct by default. `--use-env-proxy` explicitly uses the existing
HTTP_PROXY/HTTPS_PROXY/NO_PROXY settings. TLS verification remains enabled using
system trust and any existing standard SSL_CERT_FILE/SSL_CERT_DIR configuration.
Do not add proxy credentials to Agent JSON, disable TLS validation, or create
new trust roots just to make a test pass. Keep localhost/127.0.0.1/::1 excluded
when using local Cloud/provider fixtures.

Set provider credentials securely in the launching process environment; the
example above assumes AGENT_PROVIDER_API_KEY is already present. Under the Rust
Worker, do not use a PERO_-prefixed provider variable because those are removed;
select a supported inherited name explicitly with `--api-key-env`.

## ACP and authority boundary

The executable supports ACP v1 initialize, new/load/resume/list/close sessions,
prompt and cancel. Resume does not replay history; load does. Model selection is
fixed by default (`configOptions` is empty). Explicit `--selectable-model` IDs
opt into an idle-only, durable ACP model selector; see [model selection](acp/README.md).
All selected models share operator-declared context/output/reasoning settings.
The current provider is explicitly
text-only; image, audio, embedded contexts and provider extensions are not
silently coerced into text. Unsupported inputs fail closed.

Without `--workspace`, no native tools are registered. An explicit workspace
enables bounded read/write/edit/list/search; `--enable-shell` separately enables
approved foreground Bash. Writes, edits and every shell call require approval.
Optional `--sandbox strict-workspace-write` or `strict-read-only`, with explicit
`--sandbox-runtime` paths, requires the strict backend and denies network access.
Unsupported backends fail closed. See `sandbox/README.md` and
`nativetools/README.md` for workspace trust assumptions and limits. Skills are
default-off; explicit `--skills-root` enables the [read-only catalog](skills/README.md).
Web tools remain absent. Optional in-process delegation is described below.
An ACP client can explicitly supply MCP stdio/HTTP servers in `session/new`.
That client is trusted: MCP stdio starts the supplied executable, inherits the
process environment with configured additions, and HTTP reaches the supplied
URL. `cwd` is a working directory, **not a sandbox**. Do not accept MCP server
configuration from an untrusted caller or expose this stdio process as a public
service. Deploy process/container and network isolation separately.

`--approval ask` is the default. `--approval never` rejects tools marked
`RequiresApproval`. The existing unattended Rust Worker still rejects permission
requests; changing this CLI default does not grant unattended execution.
`--approval ask` asks the ACP client for allow-once/reject-once decisions. This
policy is **not a universal tool sandbox**: upstream MCP tools are not marked
`RequiresApproval` and an explicit MCP server grant authorizes their calls.
The CLI does not install such servers on its own. Permission refusal is tested against the actual file/shell tools in temporary
workspaces, as well as the earlier isolated protocol fixture.

## Preserved execution and deliberate exclusions

The actual loop retains tool continuation, schema validation, tool result
projection, cancellation, retry, lifecycle/generation safety, persistence,
compaction primitives, and durable inbox processing. ACP streams provisional assistant text/thought chunks and suppresses duplicate
committed output. Durable load replays only committed messages; ACP cannot retract
a failed provisional prefix.

Absent: Point Projects/Hub/Pages, web/desktop UI, accountsync, product prompts,
telemetry, workflows/jobs/schedules, external subagent providers, plugin/default
product coding assembly, implicit/product skill discovery, automatic file upload, and Point memory/context policies.
The explicit native file/shell composition is independent of those product profiles.
Generic generation-owner and compaction seams remain because the reused tool
and cancellation lifecycle depends on them; no Point product is mounted.

The module is split into `model`, `llm`, `runtime`, `session`, `harness`, `acp`,
`providers/openai` and supporting packages. `SOURCE.json` records core extraction
provenance and changes; foundation/provider packages have their own manifests.
Source reuse was authorized by the repository owner. Applicable third-party
notices are retained with their packages. This extraction does **not** assign an
MIT (or other blanket) license to the entire module; remaining source licensing
must be decided by its owner.


## Long-session configuration

Use `--context-window` only with a capacity supported by the configured model.
It enables the existing compaction engine for pressure, overflow and resume;
see [compaction options](cmd/pero-agent-acp/COMPACTION.md). No capacity is guessed.

## Optional coding helpers

`--enable-agent-instructions --workspace /absolute/root` loads only that root's
`AGENTS.md` as untrusted user-role context. No home, ancestor, nested or alternate
instruction discovery is enabled; instructions do not expand file/shell authority.
`--enable-todos` mounts session-backed `todo_write` (whole-list replacement,
reset at the next turn). Both are disabled by default. Plan-mode authorization
and the excluded user-question service are not included. See
[agent instructions](agentinstructions/README.md) and [todos](todos/README.md).

## Optional in-process delegation

`--enable-subagents` enables one-level `spawn_agent` and `fork_agent` tools.
They wait for a child result; canceling the parent call stops the child through
the native lifecycle. `--max-active-subagents` sets a finite per-root limit
(default 4). Children retain parent scope, CWD and model route, cannot widen
effective step/output limits, and share the configured provider request cap.
Operations that require approval are rejected in children. This is not a
read-only guarantee: explicitly granted parent-scoped MCP tools may be inherited
and may have side effects. No external provider, continuation or model-facing
async wait/cancel interface is exposed. Clean restart/no automatic replay was
tested; crash-exactly-once recovery is not claimed. See [delegation](subagents/README.md).
