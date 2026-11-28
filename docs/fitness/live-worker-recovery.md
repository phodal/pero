# Two-device Worker recovery and coding handoff

Use the PostgreSQL and Temporal CI gate to verify the exact Run fence on each
change. It exercises explicit placement on a second enrolled Worker, rejects
dispatch before reconciliation, retains the original receipt, and rejects late
renewal and completion from the old lease.

```sh
PERO_TEST_TEMPORAL=1 PERO_REQUIRE_TEST_DATABASE=1 \
  go -C server test -race -count=1 -v ./internal/httpapi \
  -run '^(TestResearchCampaignTemporal|TestAgentWorkerReconciliationReleasesOnlyTheOriginalFence)$'
```

The CI gate uses a disposable PostgreSQL database. Set
`PERO_TEST_DATABASE_URL` for a local run. An installed pinned Temporal CLI
1.10.1 can be passed via `PERO_TEST_TEMPORAL_CLI`.

## On-demand physical-device acceptance

The live runner targets two macOS machines of the same architecture. On A,
build the current Go control plane, Campaign poller, Go ACP executable and Rust
Worker. On B, authenticate the local Codex CLI for the account that runs the
Worker and install Codex ACP. The runner expects Homebrew's Apple Silicon
`/opt/homebrew/bin` paths on B. It uses SSH with an independently trusted
`known_hosts` entry. Model credentials stay on the machine that already owns
them. The runner forwards B's temporary control-plane traffic and DSH provider
requests over two session-owned SSH forwards.

Prepare a fresh local Git repository with the files in
`tests/fixtures/agent-delivery-inbox/`. Commit the fixture once and create a
bundle. Stage the bundle and exact `pero-worker` and `pero-agent-acp` binaries
under a private directory on B. Create B's detached worktree named `feature`
from that bundle, keeping the same base SHA on both machines. Add
`/.pero-worker.lock` to the fixture clones' local Git excludes to leave their
checkout statuses focused on candidate files.

```sh
# From a disposable fixture clone with a committed main branch.
git -C "$FIXTURE_REPO" bundle create "$FIXTURE_REPO.bundle" main

# On B, after transferring the bundle and binaries to REMOTE_DIR.
git clone --no-checkout -b main "$REMOTE_DIR/fixture.bundle" "$REMOTE_DIR/repository"
git -C "$REMOTE_DIR/repository" worktree add --detach "$REMOTE_DIR/feature" main
printf '/.pero-worker.lock\n' >> "$REMOTE_DIR/repository/.git/info/exclude"
```

Export the DeepSeek key on A and point `PERO_TEST_DATABASE_URL` at a new local
test database. The runner generates per-project credentials, starts a pinned
Temporal development server, holds the first real model response while replacing
the poller, and cuts only A's test Worker connection. It waits for the exact
DSH process to stop and the original Journal to be retained before recording
operator evidence and intentionally dispatching the next generation to B.
B temporarily runs DSH for that retry because the Task freezes its Agent type.
The separate coding task uses Codex on B. That agents-file entry sets
`supervision` to `gate`: the Worker does not select a DSH permission mode, and
unattended permission requests stay denied. The DSH retry still initializes as
`pero-agent-acp` and acknowledges its permission mode. The source fixture, model
proposal, candidate patch and receipt remain available for inspection. The
two-machine receipt from the previous head does not cover this admission rule
and has to be run again on the current head before it counts as acceptance.

```sh
python3 tests/runtime/live-worker-recovery.py \
  --server "$PERO_SERVER_BIN" --orchestrator "$PERO_CAMPAIGN_BIN" \
  --temporal "$TEMPORAL_CLI" --worker "$PERO_WORKER_BIN" --go-agent "$PERO_GO_AGENT_BIN" \
  --fixture-repo "$FIXTURE_REPO" --output "$NEW_RECEIPT_DIR" \
  --ssh-target "$WORKER_B_SSH" --ssh-key "$WORKER_B_KEY" \
  --known-hosts "$KNOWN_HOSTS" --remote-dir "$REMOTE_DIR"
```

The harness leaves the candidate waiting for human validation approval. Read
the proposed patch and record approval for its exact base and digest. Store
the approval as JSON with `approved: true`, `base_sha` and `patch_sha256`.
Use the independent verifier from the source checkout. It opens a fresh
detached worktree, applies the approved patch and exercises the HTTP routes
against a pre-feature SQLite database through two service restarts. It emits a
separate acceptance receipt.

```sh
python3 tests/runtime/verify-agent-delivery.py \
  --repo "$FIXTURE_REPO" --patch "$NEW_RECEIPT_DIR/candidate.patch" \
  --approval "$NEW_RECEIPT_DIR/approval.json" --output "$NEW_RECEIPT_DIR/verified.json"
```

The live receipt records the source revision, Worker binary digest, exact Run
references, ACP session IDs and server statuses. Keep it with the independent
verification receipt. These runs use a private control plane and a synthetic
source repository with real models. Physical NIC shutdown and general
Campaign-managed Coding approval remain separate acceptance cases.
