# Standalone Linux Worker

The package is built and tested for Ubuntu 24.04 x86_64. Use a trusted machine
with `/bin/ps` and outbound HTTPS access to the Pero control plane. Install the
ACP Agent and any scientific runtimes the workspace requires on that machine.
The service uses the user's systemd manager.

## Install a release

Choose a GitHub release that includes the Worker assets. Fetch its installer
and pass the same tag to install.

```sh
release_tag='<release-tag>'
curl --fail --location --proto '=https' --output pero-worker-install.sh \
  "https://raw.githubusercontent.com/phodal/pero/$release_tag/deployment/worker/install.sh"
sh pero-worker-install.sh "$release_tag"
```

With a checkout of that tag, use `sh deployment/worker/install.sh "$release_tag"`.
To install offline, copy that release's `Pero-Worker-linux-x64.tar.gz` and
`SHA256SUMS` to the machine and pass both files to the same installer.

```sh
sh deployment/worker/install.sh --archive ./Pero-Worker-linux-x64.tar.gz ./SHA256SUMS
```

The installer verifies the archive against the checksum list, installs
`$HOME/.local/bin/pero-worker`, and saves the verified service template to
`${XDG_DATA_HOME:-$HOME/.local/share}/pero-worker/pero-worker.service`.
Service registration and startup are explicit steps below.

## Configure one authorized machine

An operator enrolls the device with the project's exact `project_id`,
`workspace_key` and `agent_id` tuple using the
[existing Worker enrollment API](../../server/README.md#local-device-enrollment).
Use the returned Worker token. The workspace path and Agent executable belong
in the machine's local configuration.

Create the configuration directory with private permissions.

```sh
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}"
install -d -m 0700 "$config_dir/pero-worker"
umask 077
```

Create `worker.env` in that directory and set the two values for this machine.

```ini
PERO_CLOUD_URL=https://app.openpero.com
PERO_WORKER_TOKEN=<worker-token>
```

Place `worker.json` alongside it. This example maps the enrolled `repo`
workspace key to an existing writable directory owned by the Worker account.

```json
{
  "workspaces": { "repo": "/srv/pero/workspaces/example" },
  "agents_file": "agents.json"
}
```

Place `agents.json` in the same directory. The `id` must match enrollment.
Use an absolute executable path and supply any provider settings for that Agent
locally, as described in the [Worker runtime guide](../../crates/pero-worker/README.md).

```json
[
  { "id": "codex", "name": "Codex", "command": "/usr/local/bin/codex-acp", "args": [], "env": {} }
]
```

For foreground execution, set the runtime's four environment variables and run
the installed binary directly. The `--once` option can acquire and execute one
eligible Run. Keep the same journal for every invocation of this device. When
switching from systemd to foreground, set `PERO_WORKER_STATE` to the same
`${XDG_STATE_HOME:-$HOME/.local/state}/pero-worker/journal.json` path.

## Start and stop with systemd

After reviewing the saved unit, copy it into the configuration for your user
manager. The unit creates a private journal directory under
`${XDG_STATE_HOME:-$HOME/.local/state}/pero-worker`.

```sh
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
mkdir -p "$config_dir/systemd/user"
install -m 0644 "$data_dir/pero-worker/pero-worker.service" "$config_dir/systemd/user/"
systemctl --user daemon-reload
systemctl --user start pero-worker.service
journalctl --user -u pero-worker.service -n 30
```

`systemctl --user enable pero-worker.service` opts in to startup when this
user's manager starts. If it must run after logout or before login, use the
host's existing systemd linger policy for the dedicated Worker account.

`systemctl --user stop pero-worker.service` stops the service's whole control
group. To cancel a particular Run and observe normal cancellation, use the
Pero task's Stop action. If the service stops during an active Run, Cloud
retains the original Run and can move it to `reconcile` when its lease expires.
Keep the journal and workspace for that Run. Starting the service with the same
journal reconciles that Run without replaying its prompt. The unit has no
automatic restart. If the Worker reports `needs_attention`, review the Run and
its local effects before attempting further work.

Stop the service before replacing the binary or changing its Worker credential.
Keep the existing journal across upgrades. The Worker runs as the systemd user
with that account's file access and the existing ACP admission policy.

## Verify the installed service

Use a disposable Linux x86_64 account with a running systemd user manager,
cgroup v2, and no pre-existing Pero Worker installation. Configure an isolated
`PERO_TEST_DATABASE_URL`. From the source checkout with repository test
dependencies installed, run the lifecycle test with the actual package.

```sh
node tests/e2e/worker-service.mjs \
  /path/to/Pero-Worker-linux-x64.tar.gz /path/to/SHA256SUMS
```

The test uses the real Go control plane, PostgreSQL and a deterministic ACP
Agent. It observes an active turn and its process inside the service cgroup,
stops the service, and checks that the same Run reaches `reconcile`. Starting
the service again reconciles the original journal and leaves the Agent prompt
with one recorded attempt. The receipt is written to
`test-results/worker-service/result.json`.

### Local acceptance on 2026-11-20

The deployment ran in an emulated Ubuntu 24.04.5 x86_64 guest with systemd 255
and PostgreSQL 16.15. The Worker runtime at `7a73b65b1` was cross-built for
Linux x86_64 and then packaged and launch-checked using the release script
inside that guest. The installer verified the local package. A running ACP
turn had a live process in the unit's cgroup. Stopping the unit removed the
Worker, executor and Agent processes, and the server marked the original Run
`reconcile`. The service did not restart by itself. An explicit start exited
zero after reconciling the original journal. The Agent recorded one prompt.

The local package, checksums, build metadata and receipt are retained under
`test-results/worker-service/`. This run used an isolated control plane and a
fixture Agent. Hosted release publication and deployment to a laboratory
server remain separate verification steps.
