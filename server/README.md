# Go control plane

The service persists manual and GitHub-sourced Tasks, immutable Run snapshots,
project-scoped Client identities and Workers, human claims, execution leases,
events and completion receipts in PostgreSQL. Desktop users can claim shared
tasks, execute their own claims, inspect progress and request cancellation. Workers
make outbound requests; ACP execution remains on the execution machine.

## GitHub Issue intake

Set `PERO_GITHUB_REPOSITORIES` to a JSON array of explicit repository bindings:

```json
[{"project_id":"default","owner":"acme","repo":"repo","workspace_key":"default","agent_id":"codex","acceptance":"Run the project checks and report their results","auto_dispatch":false,"required_label":"pero:ready","roadmap_path":"auto"}]
```

`PERO_GITHUB_TOKEN` optionally supplies a server-only fine-grained token with
Metadata/Issues read access for private repositories or higher public quotas.
Without it, the connector reads public repositories. The production origin is
fixed to `https://api.github.com`; no client input can redirect credentials.
Redirects are rejected, and pagination is checked against the same origin/path.
The Go implementation reuses Point's connector boundaries and protocol facts;
it does not depend on Point, MCP, a local `gh` login or a Node service.

Configured repositories sync at startup and every 60 seconds through one Go
service. Operators can call `POST /api/v1/github/sync` with `{}` or inspect
`GET /api/v1/github/status`. Client and Worker credentials cannot configure or
trigger the connector. A sync reports imported/updated/dispatched counts, partial
coverage and errors. If status reports `running:true`, wait for that sync to
finish before requesting another; overlapping manual sync returns 409. Each repository read is bounded to five 100-item pages and
2 MiB per response; invalid/oversized goals are skipped with an explicit partial
result. A limited scan never proves that an absent Issue was deleted or closed.
See [GitHub's Issues API](https://docs.github.com/en/rest/issues/issues).

`roadmap_path` is optional and disabled when omitted. `auto` tries `ROADMAP.md`,
then `docs/ROADMAP.md`; an explicit relative `.md` path selects one file. Reads pin
the repository's default-branch commit, decode the complete Contents API response,
and verify its Git blob digest before parsing. Private repositories additionally
need Contents read permission. A failed/partial read never closes missing tasks.

Each Markdown checkbox becomes one Task, including checked items (closed source).
Write checklist items as `- [ ] Title. Description.`; the first `. ` separates
the short title, and the full text remains the execution goal. Description edits
keep the same identity. Items without a separator keep their first-line title.
Heading paths define groups; nested checkboxes retain `parent_task_id`, source
parent identity and depth. Inline `#tags` outside code become tags, and Issue
labels become tags. No heading names or status labels are invented as tags.
ROADMAP tasks always enter as drafts; repository Issue auto-dispatch policy does
not execute them. Checked or removed source items cannot be claimed/dispatched.

Use `<!--pero:id:stable-name-->` for identities that survive renames/moves within a file.
Otherwise identity hashes the heading path, parent identity and normalized first
goal line. Line shifts, file commit changes, completion toggles and continuation
edits keep that identity. Ambiguous duplicate IDs/goals are reported as partial,
without merging guesses or closing omitted items. The semantic source revision
excludes line/commit/blob metadata; claimed/executed goals keep their exact frozen
revision. A complete later parse marks absent items missing and cancels only
their queued Runs. Running work and acceptance records remain independent.
Each project/repository binding selects one path. If a complete read selects a
replacement path, including the `auto` fallback, prior-path items become missing.
The new path has new Task identities; IDs are never guessed across files. Partial
reads keep prior-path states. Missing items retain their last known URL, commit
and blob, with `missing_at_commit` recording the absence observation.

Both operator and client task lists accept `source_kind=github|roadmap` and `tag`
before pagination. Tags filter the latest source observation while preserving
frozen Run tags. ROADMAP pages follow repository, path and current document line,
then Task ID, so parents precede their children across page boundaries. Their
cursor must match the same project scope, source kind and tag filter. Other lists
keep newest-created ordering. `GET /api/client/v1/github/status` exposes only repositories and
errors within that Client's projects; configuration and sync stay operator-only.

The repository ID is pinned on first read. Issue identity uses project + immutable
repository ID + Issue ID; names, Issue numbers and URLs are display/reference
data. Repeated sync updates the existing Task, preserves immutable source
revisions, and excludes pull requests returned by the Issues endpoint. Imported
Issue bodies remain untrusted goal data.

By default an imported Issue is a draft. An operator may set `auto_dispatch:true`
for a repository; the Issue must also be open and carry the exact configured
`required_label` (default `pero:ready`). The project, workspace, Agent and optional
target `worker_id` come from server configuration. Auto dispatch only starts the
first Run and skips Tasks already claimed by a client. Human claim and automatic
dispatch share the Task row lock, so neither silently steals the other's work.

Source edits update `Task.latest_source`; a claimed or previously dispatched Task
keeps its goal and `Task.source` bound to that exact input revision. The Run keeps
its original snapshot. A revision mismatch blocks another dispatch rather than
labelling an old goal with new provenance. Releasing a never-run claim and syncing
refreshes that draft. Previously dispatched goals need explicit review/a future
refresh workflow before reuse; creating a new manual goal remains available.
A synced closed Issue blocks
new claims and dispatch. If its current Run is still queued, closure cancels it
atomically before execution; a Run already running continues until explicitly
cancelled or completed. Reopening or editing a completed Issue never silently
retries it. Agent completion never updates GitHub labels, assignees or Issue state.

GitHub webhook intake, GitHub App installation/OAuth and external assignee writeback
remain later slices. Human claim refers to the internal
project-scoped client identity, independently of the execution Worker device.

## Client identities and shared tasks

The operator provisions a separate credential for each client, restricted to
explicit projects. In an operator shell with `PERO_CLOUD_URL` pointing to this
service and `PERO_OPERATOR_TOKEN` configured:

```sh
curl -fsS "$PERO_CLOUD_URL/api/v1/clients" \
  -H "Authorization: Bearer $PERO_OPERATOR_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"name":"Researcher A","projects":["default"]}'
```

The response contains `client` and a one-time `token`; only its digest is stored.
Give that client its token through a private channel. Launch Desktop with
`PERO_CLOUD_URL` and `PERO_CLIENT_TOKEN`, using that returned token. Client mode
has priority over an inherited operator token and never falls back to operator
authority after a request fails. No GitHub account login is implied.

Clients can see Tasks and Workers only in their stored project scope. They use
**Available / Mine / All** over the loaded task pages, claim an idle Task, and
choose **Execute** for their own claim. Release permits another client to claim
it, but is blocked during queued, running, cancellation or unresolved execution.
A human claim is separate from the Worker's expiring execution lease and does
not change the GitHub assignee. Operators alone control repository bindings,
source synchronization and client provisioning. A client can create a manual
task within its project grants; creation atomically claims that draft for its creator.

Client routes use `Authorization: Bearer <PERO_CLIENT_TOKEN>`:

```text
GET  /api/client/v1/me
GET  /api/client/v1/tasks
POST /api/client/v1/tasks
GET  /api/client/v1/workers
GET  /api/client/v1/tasks/{id}
POST /api/client/v1/tasks/{id}/claim
POST /api/client/v1/tasks/{id}/release
POST /api/client/v1/tasks/{id}/dispatch
POST /api/client/v1/tasks/{id}/cancel
GET  /api/client/v1/tasks/{task}/runs/{run}?generation=...
POST /api/client/v1/tasks/{task}/runs/{run}/cancel?generation=...
GET  /api/client/v1/tasks/{task}/runs/{run}/reconciliation?generation=...
PUT  /api/client/v1/projects/{project}/trial-submissions/{operation}
GET  /api/client/v1/projects/{project}/trial-submissions/{operation}
POST /api/client/v1/projects/{project}/trial-submissions/{operation}/cancel
```

Task creation accepts the operator manual TaskSpec fields, excluding source and
parent identity. An optional `Idempotency-Key` is scoped to the creating client;
retry the same creation with the same key and payload after a lost response.
Creation does not dispatch.

Claim, release and cancel accept `{}`. Dispatch accepts the same optional
`worker_id` and idempotency header as operator dispatch. API checks enforce
ownership even when another Desktop has stale data. Client credentials cannot
provision Workers/clients or invoke the operator GitHub sync routes. GitHub
sign-in can issue Desktop credentials for an existing Client scope. Project
provisioning remains operator-owned; a credential revocation UI is not implemented.

An explicit Worker selection checks the effective project grant, enrolled
workspace and Agent capabilities, enabled state, and runtime queue. A known
ineligible target returns `409` before storing a new Run. An eligible target
can queue while offline. The Worker checks eligibility again when claiming.

Exact Run routes resolve `task_id`, `run_id`, and positive `generation` together.
Observation requires project access. Cancellation accepts `{}` and requires the
existing Task claim. The response describes that Run even if the Task has moved
to another generation.

Trial submission `PUT` accepts `{"task": TaskSpec, "worker_id": "..."}` using the
client manual Task fields and an optional Worker. The Task's `project_id` must
match the path. The `operation` belongs to the project and the logical Client, so
another credential for that Client can resume the request. The Go control plane
commits the Task, Run, and submission receipt together. Repeating the same
operation and input returns `status: dispatched` and `run: {task_id, run_id,
generation}`. A different input for that committed dispatch returns `409`.

`GET` reads the receipt. `404` means a committed receipt is unavailable to the
caller. A request could still be in flight. Trial cancellation accepts `{}` and
acts on the original Run if dispatch committed. Otherwise it records
`status: cancelled_before_dispatch`, which also blocks later `PUT` attempts for
that operation. A dispatch receipt attests to admission. Observe the exact Run
for current status, including cancellation and `reconcile`.

### Resolve an Agent Worker quarantine

The operator can record a confirmed stop or non-start using the original Task ID,
Run ID and generation. Inspect the original Worker and any retained Journal
first, including separately managed resources before declaring a stop. Record a
bounded evidence reference and one of `confirmed_stopped` or
`confirmed_not_started`.

```text
PUT /api/v1/tasks/{task}/runs/{run}/reconciliation?generation=...
Authorization: Bearer <PERO_OPERATOR_TOKEN>

{"disposition":"confirmed_stopped","evidence":"Worker journal receipt and confirmed original process-group stop"}
```

This records a project-readable receipt and releases the Run's quarantine. The
original `reconcile` outcome and prior completion remain intact, the expired
lease stays fenced, and an explicit dispatch is required for a new generation.
Repeating the same decision returns the original receipt. An unconfirmed outcome
keeps the quarantine. A managed runtime must reach its own released phase before
the operator can resolve its Run. If the Worker exited for review, restart that
same enrolled Worker after settlement.

### Shared research Campaigns with Temporal

The opt-in first version executes one frozen round of one to eight manual trials
in order. A completed trial allows the next one to start. Failure or confirmed
cancellation stops the round and records the remaining positions as skipped.
An unresolved exact Run parks the Campaign until the original owner supplies
reconciliation. The result records execution and exact Run references.

Provision a dedicated existing Client with the Projects it may run. Use its
logical Client ID on the control plane and its token only on the orchestrator.
Both processes connect to the same private Temporal endpoint and namespace.
The orchestrator polls `pero-research-campaigns-v1` and
`pero-research-campaigns-v2`.

| Process | Environment |
| --- | --- |
| Go control plane | `PERO_TEMPORAL_ADDRESS`, `PERO_CAMPAIGN_RUNNER_CLIENT_ID`, optional `PERO_TEMPORAL_NAMESPACE` (default `default`) |
| `pero-campaign` | `PERO_TEMPORAL_ADDRESS`, the same namespace, `PERO_CLOUD_URL`, `PERO_CAMPAIGN_RUNNER_TOKEN` |

Start the control plane normally. Run the orchestrator with
`go run ./cmd/pero-campaign` from the server module, or build
`//server/cmd/pero-campaign` with Bazel. A loopback Temporal CLI dev server can
run both processes locally. Keep the runner Client ID stable across token
rotation. Only that Client can deliver Activity operations and final receipts
for Campaigns bound to it.

```text
POST /api/client/v1/projects/{project}/campaigns
Idempotency-Key: <stable client request key>
{"trials":[{"task": <manual TaskSpec>, "worker_id":"<optional Worker ID>"}]}

GET  /api/client/v1/projects/{project}/campaigns/{campaign}
POST /api/client/v1/projects/{project}/campaigns/{campaign}/cancel
```

Start returns the frozen plan reference and the recorded Temporal Run ID when
available. If start could not be acknowledged, it returns `202` and the saved
Campaign ID. Repeat the same POST with the same key and plan to recover it.
Changing the payload for that key returns `409`. Project Clients can read the
Campaign. The creator can request cancellation with an empty JSON object. The
control plane saves the request before waking the Workflow. Cancellation waits
for its original trial receipt and confirmation from the execution owner.

Enable the reviewed two-round mode by setting the control plane's
`PERO_PYBAMM_METHOD_DIR` to the absolute locked `scripts/science/pybamm-sweep`
directory and `PERO_PYBAMM_CHECKER_PYTHON` to an absolute Python 3.12 executable.
The checker uses the standard library. The executor uses the separate locked
PyBaMM environment. Keep the checker script, reference and method bundle
available at the recorded digest until its campaigns finish.

Start with `"mode":"pybamm_reviewed_v1"` and two ordered
`pybamm-sweep-v1` trials with explicit Worker IDs. Read the active
`review_gate` in Campaign progress. Evidence can be reopened through
`GET /api/client/v1/projects/{project}/campaigns/{campaign}/evidence/{index}`
with a zero-based trial index. The response includes the exact Run reference,
method, checker, result and observed environment digests, and bounded Run
events. Execution status and numerical consistency are separate.

In Desktop, open the shared Project and select **Campaigns** to see both rounds,
expand the independent evidence and reopen the recorded approval. The tab uses
`GET /api/client/v1/projects/{project}/campaigns` to discover up to 50 of the
project's latest reviewed Campaigns. The control plane decides whether the
signed-in Client can approve the displayed gate.

A project Client sends the decision using its own bearer credential and a
stable Idempotency-Key. The runner Client cannot submit a human decision.

```text
POST /api/client/v1/projects/{project}/campaigns/{campaign}/review
Idempotency-Key: <stable decision key>
{"gate_id":"...","plan_digest":"...","evidence_digest":"...","choice":"approve"}
```

A decision can also be `reject`. The gate expires after 24 hours.
The original decision receipt is returned for an identical request even after
the Workflow closes. A stale or expired gate returns `409`. The reviewed
Workflow keeps the next trial unsubmitted until an approval is persisted.

The Workflow definition name is versioned. Preserve the current definition and
run the committed history replay before replacing workers that may receive
in-flight Campaigns. Plan content and runner credentials stay in Pero and the
orchestrator process. Temporal stores the bounded plan and trial references it
needs to advance.

Automated acceptance uses a disposable PostgreSQL database and a pinned Temporal
CLI dev server. Set `PERO_TEST_TEMPORAL_CLI` to an installed CLI binary for an
offline run.

```sh
PERO_TEST_TEMPORAL=1 PERO_TEST_DATABASE_URL='<disposable PostgreSQL URL>' \
  go -C server test -race -count=1 -v ./internal/httpapi -run '^TestResearchCampaignTemporal$'
go -C server test ./internal/campaignruntime -run '^TestReplayCampaignV1$'
```

## Local device enrollment

A signed-in Desktop can explicitly enable a local Worker within the Client's
existing project grants. This does not provision new project access. The Desktop
saves a pending random `enrollment_secret` privately before calling:

```text
POST /api/client/v1/workers
POST /api/v1/workers/enroll       # operator equivalent
```

Both accept `device_id`, `request_id`, `name`, `projects`, a 64-character lowercase
hex `enrollment_secret`, and `capabilities` containing exact
`{project_id, workspace_key, agent_id}` tuples. The response is
`{worker, token}` with a separate Worker credential. Workspace paths and Agent
commands are local configuration and are not sent to Cloud.

Identical retries recover the same device and token. Changing a request under
the same request ID, replaying a superseded configuration, or reconfiguring an
active/unresolved Worker returns 409. A new request may update an idle owned
device and rotate its token. `POST /api/client/v1/workers/{id}/disable` (operator:
`POST /api/v1/workers/{id}/disable`) accepts `{}` and disables an idle owned device;
foreign device IDs return 404. Stopping the local Worker does not require this
credential-revocation operation.

Claims for enrolled devices intersect device scope with the owner's current Client
project grants and match the advertised project/workspace/Agent tuple before
acquiring a lease. Existing administrator-provisioned Workers retain
legacy claim behavior. Worker listings report authenticated contact as
`presence` (`unknown` before first contact, `online` for 15 seconds, then `offline`),
with `last_seen_at` and server `observed_at`. This is contact observation, not
execution readiness or authorization. `occupied` and current Run references come
from running/cancel-requested/reconcile Runs, independently of presence. Device
`enabled` and registered `capabilities` are included; client listings filter project
grants and hide foreign Run identifiers while retaining machine occupancy.
Desktop permits an explicit compatible machine or any compatible machine at
dispatch; an offline explicit machine remains queued until it claims work.
Older servers without observation fields display unknown. See [ADR 0010](../docs/adr/0010-desktop-worker-enrollment.md).

## Run

Set `PERO_DATABASE_URL` to a PostgreSQL database and `PERO_OPERATOR_TOKEN` to a
private random operator credential, then run `go run ./cmd/server` from `server/`.
The database role needs schema creation rights for the first startup. Versioned
embedded migrations are applied under a database advisory lock.

| Variable | Meaning |
| --- | --- |
| `PERO_DATABASE_URL` | Required PostgreSQL connection URL |
| `PERO_OPERATOR_TOKEN` | Required operator bearer credential |
| `PERO_LISTEN` | Bind address; defaults to `127.0.0.1:8787` |
| `PERO_LEASE_SECONDS` | Lease duration, 1–3600 seconds; defaults to 60 |
| `PERO_GITHUB_SYNC_SECONDS` | Source polling interval, 60–86400 seconds; defaults to 60. The public Task Center uses 600 to stay within anonymous GitHub quotas. |

`GET /healthz` checks database connectivity without authentication. API routes
require a bearer credential; community pages use the separate sessions described below. Protect any non-loopback deployment with
HTTPS at the existing reverse proxy; the service does not terminate TLS itself.
Never put operator or Worker credentials in a renderer or source control.

## API

Operator routes use `Authorization: Bearer <PERO_OPERATOR_TOKEN>`:

```text
GET  /api/v1/me
POST /api/v1/clients
GET  /api/v1/github/status
POST /api/v1/github/sync
GET  /api/v1/tasks
POST /api/v1/tasks
GET  /api/v1/tasks/{id}
POST /api/v1/tasks/{id}/dispatch
POST /api/v1/tasks/{id}/cancel
GET  /api/v1/workers
POST /api/v1/workers
```

Task creation accepts `title`, `prompt`, `acceptance`, `project_id`,
`workspace_key`, and `agent_id`. It creates a draft, with no automatic execution.
Dispatch accepts an optional `worker_id`. The Run freezes the Task input. Repeating
dispatch while the same target Run is active returns that Run. Create and dispatch
also accept an `Idempotency-Key` header (maximum 128 bytes); reusing a key for a
different operation or payload returns 409.

Worker provisioning accepts `name`, nonempty `projects`, and optional `labels`.
The response returns a Worker and its credential once; only a SHA-256 digest is
stored. Labels are descriptive in this slice; project scope is enforced by the
server and workspace/Agent capability checks are enforced on the Worker. There is
one slot per Worker, across all its process instances.

Worker routes use their separate provisioned bearer credential:

```text
POST /api/worker/v1/claims
GET  /api/worker/v1/runs/{id}?instance_id=...
POST /api/worker/v1/runs/{id}/renew
POST /api/worker/v1/runs/{id}/events
POST /api/worker/v1/runs/{id}/complete
```

Claims accept `request_id` and `instance_id` and return `{run: Run|null}`. Persist
the request before sending it: repeating it retrieves the original assignment.
An empty claim also has a receipt, so a later poll uses a new request ID. A claim
receipt returns the Run's current state; a recovered terminal or expired Run must
not start another Agent prompt.

Renew, events and complete require `generation` and `instance_id` matching the
assigned Worker and an unexpired lease. Events contain a contiguous `seq` starting
at one, `kind`, `text`, and optional JSON `data`. A duplicate identical sequence is
acknowledged; conflicting payloads or gaps return 409. Complete accepts `outcome`
(`succeeded`, `failed`, `cancelled`, `reconcile`) and `summary`. An identical saved
completion receipt remains retrievable after lease expiry; a different result
cannot replace it.

Queued cancellation is immediate. Active cancellation remains `cancel_requested`
until the Worker confirms stopping, or becomes `reconcile` when its lease expires.
Success cannot overwrite a pending cancellation. Expired runs enter `reconcile`
and never requeue automatically; their Tasks cannot redispatch until a future
explicit reconciliation workflow resolves the unknown execution effects.

Task lists default to 50 rows, bounded to 512 KiB, and accept `cursor` and `limit`
(1–50). Responses contain `tasks`, `has_more` and nullable `next_cursor`. The cursor
is the last returned Task ID, ordered by creation time and ID descending. The list
omits the optional nested Run; detail contains its full snapshot.

Detail returns the newest 200 events, bounded to 256 KiB and ordered by sequence.
`events_truncated` explicitly reports omitted earlier evidence, and nullable
`events_first_seq` / `events_last_seq` identify the returned range. All events remain
in PostgreSQL; older-event pagination/export is a later slice. Additional source adapters, artifact storage, independent
verification, team permissions, device revocation, PR publication and public
multi-tenant operations remain later slices. Any unresolved `reconcile` Run also
quarantines its assigned Worker's slot, preventing another task from overlapping
unknown cleanup. The operator can release that quarantine with an exact Run
reconciliation receipt after verifying the original execution.
`succeeded` records execution outcome,
not independent acceptance.

## Verify

```sh
go test ./...
PERO_TEST_DATABASE_URL='postgres://.../pero_test?sslmode=disable' go test -race ./...
```

The integration suite creates and drops isolated schemas in the supplied test
database. It verifies real concurrent claims, restart durability, frozen inputs,
lease fencing, token/project/instance isolation, event conflicts, completion
receipts, idempotency and cancellation. Without the test URL, integration cases
explicitly skip; ordinary compilation alone does not establish dispatch behavior.

The Bazel pilot builds the control plane with `bazel build //server/cmd/server`.
Run its PostgreSQL acceptance explicitly from the repository root:

```sh
PERO_TEST_DATABASE_URL='postgres://.../pero_test?sslmode=disable' bazel test //server:postgres_integration
```

This manual suite inherits only the test database URL, requires it instead of
skipping, runs locally, and disables remote caching and execution. Its `external`
tag forces fresh test execution even when a previous local run passed.
It creates and drops isolated schemas in that database, which must be disposable
and allow schema creation. The normal `go test ./...` skip behavior is preserved.
For the same strict check through Go, set `PERO_REQUIRE_TEST_DATABASE=1` alongside
the URL and run `go test -count=1 -race ./...`. A cached result or missing database
is not PostgreSQL acceptance.

## Deployment and Kubernetes direction

`openpero.com` can serve the public site and `app.openpero.com` the same-origin Web
and API. The HTTPS proxy can share a machine with `dsh.phodal.com`, with separate
service identities, data volumes, database roles and resource limits. Start actual
Worker execution on other machines.

This is a planned deployment layout, not an audit of a running DSH host. Reuse
its existing 80/443 proxy and add host-based routes for the Pero domains.
A containerized Go service listens on its container interface and is reachable
only through the proxy/internal network; a direct host service can retain the
loopback default. PostgreSQL and Worker management ports need no public listener.
No DNS, certificate, reverse-proxy or production service changes are made by this
implementation.

Go owns coordination, scheduling and future environment/provider adapters. A future
Go Kubernetes provider can create approved execution Pods or Jobs and reconcile
their lifecycle through the same Task/Run protocol. It does not require moving
control-plane state or scheduling into Rust. Kubernetes provisioning, sandbox
isolation and production deployment are not implemented by this slice.

## Local Desktop contributions

GitHub-linked Desktop identities can use `/api/client/v1/contributions` without a
private project grant or Worker assignment. The dedicated API returns reviewed
public GitHub-backed goals, not private Task prompts, execution logs or paths.
Public repository intake already publishes its public source goals; private
repository work requires explicit reviewed community publication.

- `GET /api/client/v1/contributions` accepts `limit` (1–50) and an opaque cursor.
- `GET /api/client/v1/contributions/{id}` reads a published coding goal.
- `POST .../{id}/claim` and `/release` use the existing task claim owner.
- `POST .../{id}/pull-request` accepts `{url,branch,head_sha,source_revision}` for
  the current claimant. The PR must target the published repository and frozen
  requirement revision. Retrying the same evidence is safe; reviewed follow-up
  commits may update the same PR's head.

Submission records a candidate awaiting maintainer review. It creates no Worker
Run, independent verification or contribution-point award. Private task and
Worker endpoints retain their project scopes. Migration 013 applies through the
existing startup migration owner. See [Desktop workflow](../desktop/README.md#contribute-on-this-computer)
and [verification](../docs/fitness/contributor-workflow.md).

## Community tasks and contributions (#2)

The same Go binary serves `/tasks`, `/tasks/{id}`, `/leaderboard` and
`/contributors/{github-login}` using embedded HTML/CSS/JavaScript. There is no
separate frontend build or queue. The existing bearer APIs remain authenticated.

| Variable | Meaning |
| --- | --- |
| `PERO_PUBLIC_URL` | Exact public origin, e.g. `https://app.openpero.com`; defaults to `http://127.0.0.1:8787`. Must match the browser origin, including the port. HTTP is allowed only for loopback. |
| `PERO_GITHUB_CLIENT_ID` | Optional GitHub OAuth App client ID |
| `PERO_GITHUB_CLIENT_SECRET` | Matching OAuth App secret; keep on the server |

Set the OAuth App callback to `<PERO_PUBLIC_URL>/auth/github/callback`.
Without OAuth configuration the public pages still work and explain why claiming
is unavailable. GitHub login requests public identity only, stores numeric GitHub
ID, and discards the GitHub access token after identity lookup. The OAuth App is
separate from the server's GitHub Issue ingestion credentials.

Open `/community/admin/login` and submit `PERO_OPERATOR_TOKEN` to manage the
community. The token is exchanged for a random, expiring, HttpOnly session; only
session digests are stored in PostgreSQL. No credential is embedded in public
HTML or JavaScript. HTTPS origins produce Secure cookies. Mutations require the
configured Origin and a session CSRF token; logout invalidates the server record.
The existing operator credential represents one trusted administrator, not a
multi-user administrator role system.

1. Create/import a Task using the existing control plane. In community management,
   explicitly publish a reviewed title, description and optional HTTPS source URL.
   Only these fields, the project identifier and public state are exposed. Prompts,
   private acceptance text, paths, Agent logs and credentials remain private.
2. Have a contributor sign in with GitHub once. Provision a Worker using the
   existing operator API, then bind its ID to that GitHub login in community management.
   Ownership cannot be silently transferred. The contributor's internal Client gets
   the Worker's operator-approved project scope.
3. The contributor opens a public task and selects an owned Worker. Claim and
   dispatch share one database transaction and the same Task lock used by Desktop
   Clients. Another Client's claim, a closed source or uncertain execution blocks
   claiming. Repeated identical active claims retrieve the existing Run.
4. Worker success leaves the task **awaiting acceptance**. Open the task as the
   administrator, check the result, supply a public HTTPS evidence link and a
   public review note, and accept the exact succeeded Run. This records one point
   for its frozen contributor/Worker assignment. It does not create an independent
   verification report or publish a PR.
5. An explicit confirmed reversal appends a negative receipt and removes the
   original award from its original week and lifetime totals. Old acceptance forms
   cannot resurrect reversed awards. The original contributor can run the task
   again after reversal; a new Run requires a new review.

Weeks begin Monday at 00:00 UTC. Rankings contain at most 100 contributors, ordered
by accepted tasks and then login. Public task/history lists use 50-row pages.
Task state is refreshed through normal navigation; long-running work shows its
current execution state and a refresh action. Theme tokens are generated from
`DESIGN.md` by `npm run gen:theme` and checked by `npm run check`.

```sh
PERO_TEST_DATABASE_URL='postgres://.../pero_test?sslmode=disable' go test -race ./...
# From the repository root; install Playwright Chromium or specify a local binary:
PERO_TEST_DATABASE_URL='postgres://.../pero_test?sslmode=disable' npm run test:community
```

`PERO_CHROMIUM_PATH` optionally chooses a Chromium executable. The browser suite
starts an isolated Go/PostgreSQL schema and local OAuth/Worker protocol fixtures,
then tests publishing, login failure, GitHub identity, Worker binding, claiming,
execution state, acceptance, reversal, history, recovery and responsive themes.
Screenshots and `verification.json` land in `test-results/community/`. Fixture
success does not establish real GitHub OAuth configuration, real Agent execution,
production isolation or deployment to openpero.com.

### Desktop sign-in handoff

The existing GitHub OAuth configuration also supports Desktop connection:

- `GET /connect/desktop?state=…&code_challenge=…` resumes browser login and consent.
- `POST /connect/desktop` requires the signed-in contributor session, origin and CSRF.
- `POST /auth/desktop/token` exchanges a two-minute code and S256 verifier exactly once.

The fixed return URL is `pero://connect/callback`. Client Secret, GitHub access
tokens and Desktop bearer credentials are never put in that URL. Each Desktop
credential is hashed separately and authenticates the existing GitHub Client.
OAuth itself does not add projects or execution rights. The immutable GitHub ID
owns identity; the operator owns `clients.projects`. Existing Worker binding adds
the Worker's projects to that same Client, as before. Operators may explicitly
provision an existing account's Client scope when no Worker is assigned.

Live configuration is held in `/etc/openpero/server.env` (0600); the GitHub App
callback is `https://app.openpero.com/auth/github/callback`. Never commit its
Client Secret. The service discards the GitHub access token after identity lookup.

## Optional Agent Sandbox runtime

`PERO_SANDBOX_CONFIG` selects an operator-owned JSON file for one fixed trusted
Worker/pool. Without it the existing dispatch path is unchanged. Migration 15
adds runtime binding receipts and a persistent runtime-only Worker queue fence;
it does not create Kubernetes resources or register credentials by itself.
Operator `POST /api/v1/tasks/{id}/runtime-dispatch` (`{}` plus required
`Idempotency-Key`) atomically dispatches/reserves before claim creation.
`GET /api/v1/runs/{id}/runtime` reads evidence; the corresponding `/reconcile` and
`/release` POSTs take `{}` and use the original operation/UID. Client/Worker
credentials cannot call these operator endpoints.

See [ADR 0018](../docs/adr/0018-agent-sandbox-runtime.md), the
[operator runbook](../deployment/agent-sandbox/README.md) and
[verification limits](../docs/fitness/agent-sandbox-runtime.md). No Task may supply
cluster configuration or executable paths. Default unattended permissions remain
denied; Kubernetes is not a replacement for the existing native sandbox policy.
