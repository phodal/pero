# Headless Go ACP integration

Tracks [issue #3](https://github.com/phodal/pero/issues/3).

## Ownership and executable

`harness/go` is the independent Go module
`github.com/phodal/pero/harness/go`. Build its stdio entrypoint with:

```sh
cd harness/go
go build -o /absolute/output/pero-agent-acp ./cmd/pero-agent-acp
```

The execution path remains **Rust `pero-worker` → `pero-runtime` ACP client →
Go `pero-agent-acp`**. The existing Go server owns Task/Run dispatch and result
acceptance; no second scheduler, UI, account service or deployment is added.
Successful Agent execution is not task acceptance or contribution credit.

Configure the Worker with an explicit executable and allowed workspace. The
Agent takes `--endpoint`, `--model`, `--session-dir`, `--api-key-env` and
`--approval never|ask`. The named credential defaults to `AGENT_PROVIDER_API_KEY`
(not a `PERO_*` name); Worker configurations can explicitly set
`--api-key-env OPENAI_API_KEY` or another permitted provider variable. The entrypoint
removes the consumed credential from its inherited environment before tool/MCP
children are started. Provider credentials are read only from the named variable;
keep them out of source/config examples and public events. Use a non-`PERO_*`
credential variable: the existing Worker deliberately removes all `PERO_*`
variables from Agent execution. The private session directory must be writable
only by the execution identity. No DSH/Point user settings, default prompt,
anonymous identity or telemetry initialization is inherited by this entrypoint.

## Protocol and provider constraints

- ACP v1 uses JSON-RPC over stdio; diagnostics belong to stderr. Unsupported
  negotiated versions fail before session creation.
- `session/new` receives the allowed absolute workspace. Additional directories
  are not supported. The Go server supports its session persistence/load APIs,
  but the Worker does **not** automatically resume or replay interrupted prompts.
  Its existing journal reconciles uncertain Runs and reuses completion receipts.
- Keep `AgentConfig.model` absent/null: this Agent does not advertise a model
  selector unless selectable models are configured, and does not implement
  `session/set_model`. Every session advertises `permission`, defaulting to
  `auto-review`. Model selection remains an explicit startup argument.
- The provider requires an explicit endpoint, credential, provider and model.
  HTTPS is required except numeric-loopback HTTP fixtures. Redirects and SDK
  retries are disabled; retry policy remains owned by the harness.
- The initial provider supports text, reasoning and streamed tool calls/results.
  Unsupported media/content and request extensions fail before HTTP dispatch;
  there is no implicit Files API upload or fallback to another model.
- Incomplete streams, missing finish reasons and malformed tool calls fail.
  Response bodies are bounded to 16 MiB and SSE line buffers to 1 MiB. Upstream
  error bodies and remote identifiers are not copied into public diagnostics.

## Tool authorization is not a sandbox

Native tools are opt-in. `--workspace /absolute/trusted/root` enables
`read_file`, `write_file`, `edit_file`, `list_directory` and `search_files`;
`--enable-shell` additionally enables `shell`. The session cwd must equal the
configured root. Without these flags the previous transport-only mode remains.
Selecting a workspace grants bounded read/list/search authority. Every write,
edit and shell call additionally requires client approval; `--approval never`
rejects those operations and unattended Workers still deny permission requests.
An Agent turn completing after denial does not mean the tool ran.

ACP can also supply MCP servers; their tool authorization must be reviewed separately. `--approval ask`
is not a blanket permission gate for every MCP tool and is not an OS sandbox.
Process groups and workspace locks do not isolate untrusted code or networks.
Do not treat a selected directory, a connected Worker, or advertised capability
as permission to access other resources.

The native-tools verification uses the **production Go executable**, not a
no-op substitute: read/search and denial run through the real Worker, while
write/edit/shell success uses the existing Rust ACP runtime with explicit
allow-once answers for named fixture calls in disposable workspaces. This test
approval does not authorize production or future automatic approval. See
[production-tools verification](production-tools-verification.md).

The earlier transport-only regression still has a separate guarded no-op fixture;
its results are not used as evidence that native file/shell tools executed.

## Verification

Focused Rust runtime/Worker tests passed (28 tests), including protocol-version
rejection and DSH-compatible text/tool/permission messages. The headless Rust
verification workspace excluded unrelated Host/UI members; it retained pinned
dependency versions. This is not a full UI/workspace build. Clippy still reports
four pre-existing `collapsible_if` warnings; strict `-D warnings` is not a pass.

The extracted provider/config/media slice passed 42 focused Go race tests and
`go vet`. HTTP tests use local stubs and fake credentials, never real providers.

The original transport-only real-binary Worker suite is `tests/runtime/go-acp-worker.mjs`. It runs the
actual Rust Worker and Go ACP executable against a loopback HTTP model fixture
and a contract-level Cloud fixture. It checks success, cancellation/late results,
Agent process failure, completion receipt retry without re-execution,
interrupted-claim reconciliation, and lease-loss cleanup. Permission refusal is
tested with the separate guarded-tool Go assembly described above. The suite
records the exact executable hashes in its result; use that record rather than
assuming a rebuilt binary was already tested. The final verification completed
**8/8 scenarios successfully**, including rejection of a late success receipt
followed by reconciliation, and guarded-tool permission denial without execution.

Verified SHA-256 identities:
- Production Go ACP: `5ee6785ce37a56818843ba71af45b9d249df2ff9538c1ea2c556d62a5cc338d3`
- Rust Worker: `9a071a14d7d7d637ebe2b24cc8dc813218cb03ae0147dadd9ec5d558d27e5c1c`

The Rust runtime/Worker/contracts source used for these checks was also compared
with master `a81af1f00551bbb65747840a773310b32d6fa98a`: the underlying source files
were unchanged from the captured integration base, apart from this change's
explicit ACP protocol guard and test additions.

These checks do **not** establish real-model acceptance, PostgreSQL dispatch
authorization/acceptance, production MCP policy, deployed Linux acceptance,
untrusted-code isolation, account/OAuth integration or deployment. No model
credentials or real-model requests are required or used by those fixture suites.
The separately authorized bounded live observation is recorded below.

Protocol references:
- https://agentclientprotocol.com/protocol/v1/initialization
- https://agentclientprotocol.com/protocol/v1/session-setup

## Bounded real-provider observation (2026-10-28)

With official DeepSeek `deepseek-flash` and Agent SHA256
`ec85b34c4a9fa97748d7bad9ff0c481c3eb8677caa0510bc7ebbd6c0573fb373`,
the real Worker observed one completed `read_file`, matching fixture path and
nonce, a successful completion receipt, and `end_turn` with no session errors.
The original runner result remains **failed**: its workspace assertion wrongly
rejected the Worker's legitimate `.pero-worker.lock`. The corrected assertion
passed a real-Worker/Go/local-provider regression. At that stage the initial
budget was exhausted, so there had been no corrected live rerun or real-provider
write/shell scene. That receipt establishes only functional read-chain evidence,
not a passed suite; the later separately authorized runs are recorded below.

## Subsequently authorized live verification — 2/2 passed

On 2026-10-28 at 12:32:56 UTC, a separately authorized additional budget of
at most eight generation requests completed both official DeepSeek
`deepseek-flash` scenes successfully (at most four requests per scene,
512 output tokens per request):

- **Worker read:** one `read_file` completed, path and nonce matched, source
  remained unchanged, only the source and valid private lock were present,
  Worker completion succeeded, and the model returned `end_turn` with no session
  errors. No permission grants were needed.
- **Direct Rust ACP client:** exact allow-once approvals enabled the prescribed
  file write/readback and fixed `pwd` command; both checks passed with two grants
  and zero denials. This was not an unattended Worker write/shell grant.

Both runner receipts passed and executable hashes matched before and after each
scene. The earlier failed receipts remain failed; these are separate successful
runs after the test correction. Cloud remained a loopback contract fixture,
not production Cloud/PostgreSQL. Approval was limited to temporary test files
and the fixed safe command; it does not change Worker default denial or make
shell an OS/network sandbox. No further provider calls were made.
