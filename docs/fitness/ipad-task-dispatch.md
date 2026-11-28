# iPad task dispatch verification

Verified on 2026-11-28 from `codex/ipad-task-dispatch`, based on `e26c87d00`.
The account used the same logical Project Client in Safari and Desktop.

## Observed flow

1. On a Mac Studio, use the installed Pero Desktop to connect as a Project
   Client and enable its local Worker. Map `pero / default` to an approved
   local directory with the built-in `pero` Agent.
2. In iPad Pro 11-inch (M5) Simulator Safari on iPadOS 27, sign in, select
   `pero / default` in `/my/tasks`, fill the form and submit the draft.
3. In Desktop, open the draft, select Mac Studio and delegate. Open the exact
   Run in Safari and wait for `PERO_IPAD_RUNNING`.
4. Terminate the Safari app. Release the second model chunk only after the
   simulator confirms termination. The control plane reports `succeeded`
   while Safari is stopped.
5. Reopen the exact Run link. Safari shows the same Run ID and generation with
   `PERO_IPAD_RUNNING PERO_IPAD_COMPLETE`. The model fixture verifies one
   successful submission and the control plane reports 11 events.

| Recorded fact | Value |
| --- | --- |
| Task | `task_d41704629ed50c3a0711a910311583c8` |
| Run | `run_79d1f58c6010576de2207da89a5f54e2`, generation `1` |
| Worker | `worker_455532bd550f6cf43c3fcdbd320a64da` (Mac Studio) |
| Safari stopped / reopening started | `16:36:14` / `16:36:46` Asia/Shanghai |

Evidence is local under `test-results/ipad-task-dispatch/` in this worktree.
The record is `result-safari.json`. The simulator screenshots are
`safari-full-form.png`, `safari-full-running.png`, and `safari-full-reopened.png`.

## Environment and checks

- The final pass used the installed Pero 0.1.2 Native shell and its bundled
  Go ACP Agent, candidate Host and Worker binaries, an isolated Go control
  plane with PostgreSQL, a test GitHub identity and a held loopback model stream.
  The first pass also exercised the unmodified installed Worker and its bundled
  Agent using a tablet-sized WebKit browser for the initial submission.
- `go -C server test -race -count=1 ./...` passed with real PostgreSQL. The
  private task cases exercise auth, same-origin form submission, idempotent
  receipt recovery after Worker disable, project scope, and exact historical Run
  reads across sign-in.
- The Host/Worker suites and the loopback Host regression passed. The regression
  exercises an updated built-in provider configuration and asserts that the
  credential is absent from the persisted Worker allowlist and receipts. For an
  already running Worker, Stop and Resume applies the newly saved configuration.
- Physical iPad, hosted `app.openpero.com`, production GitHub OAuth, and an
  upstream model provider remain outside this local verification.

To reproduce with a disposable PostgreSQL instance, use a fresh absolute path
for `PERO_IPAD_TASK_FIXTURE` and start the opt-in fixture.

```sh
PERO_TEST_DATABASE_URL='<disposable PostgreSQL URL>' \
PERO_IPAD_TASK_FIXTURE='<fresh absolute path>' \
  go -C server test ./internal/community -run '^TestIPadTaskFixture$' -count=1 -v -timeout 20m
```

The fixture writes the service URL, test Project Client token and model URL
to the named file. Sign in through the fixture's GitHub path, and configure
Desktop's built-in Agent with that URL, model `fixture` and key `ipad-fixture`.
Once Safari has terminated, create the sibling `.finish` file. After observing
the result in the reopened browser, create the sibling `.stop` file. The latter
ends the fixture and checks that exactly one valid model request was received.

## Workflow recovery

The Safari lifecycle uses the existing Go Task/Run persistence and Worker
lease. A repeat submission resolves the original receipt. A Run link includes
its generation and continues to identify that attempt after a later dispatch.
Future orchestration can follow the existing
[Temporal Campaign contract](../adr/0037-temporal-research-campaigns.md).
Retry submission with the same operation ID and read the original Run by its
full reference. A lost final execution result remains `reconcile` until the
owner supplies evidence. A new execution requires a separate admission.
