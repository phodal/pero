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
source synchronization, client provisioning and manual task creation.

Client routes use `Authorization: Bearer <PERO_CLIENT_TOKEN>`:

```text
GET  /api/client/v1/me
GET  /api/client/v1/tasks
GET  /api/client/v1/workers
GET  /api/client/v1/tasks/{id}
POST /api/client/v1/tasks/{id}/claim
POST /api/client/v1/tasks/{id}/release
POST /api/client/v1/tasks/{id}/dispatch
POST /api/client/v1/tasks/{id}/cancel
```

Claim, release and cancel accept `{}`. Dispatch accepts the same optional
`worker_id` and idempotency header as operator dispatch. API checks enforce
ownership even when another Desktop has stale data. Client credentials cannot
provision Workers/clients or invoke the operator GitHub sync routes. GitHub
sign-in can issue Desktop credentials for an existing Client scope. Project
provisioning remains operator-owned; a credential revocation UI is not implemented.

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
unknown cleanup. A future explicit resolution workflow must clear this quarantine.
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
