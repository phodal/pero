---
kind: verification_report
---

# Remote Compute — 2026-11-13

Source: independent checkout `pero-science-work/p1-remote-compute`, branch
`codex/science-p1-remote-compute`, based on `c4f4ecdaf85b0a23dc3b04e1581bd680bba67b23`
plus the changes recorded in this branch. No changes from the concurrent original
checkout or self-hosted machine/worker tasks were copied. Canonical implementation
tracking remains the [environment plan](../exec-plans/2026-11-02-ai4s-environments.md);
real Slurm/OpenFOAM gates remain in [#60's existing record](../issues/2026-11-02-hpc-benchmark-library.md).

## Delivered contract

Compute's standard App HTTP API forwards a typed private JSONL capability injected
by Rust `AppProcess`. Host owns the existing `EnvironmentUses`, remote process
identity, SlurmSite and execution receipts. The App can select saved non-secret
SSH/Slurm configuration and fixed quadrature inputs; it cannot supply commands,
keys, SSH flags, executables or an approval implementation. The capability and
system credentials are excluded from App resolve/iframe responses.

Preparation exclusively stages `entry.py`, `method.py`, `input.json`; input and
method hashes are checked before SSH dispatch and within the allocated Slurm
entry. Review freezes destination, observed submission software, method, input,
account/partition and fixed Slurm requests (1 CPU, 256 MiB, 600 s). A durable staged flag distinguishes complete preparation from interrupted/failed
staging; incomplete attempts cannot be approved. A submitted_at
intent and Use acquisition commit precede external dispatch. A lost reply blocks
another dispatch and preserves the original directory/job marker for reconciliation.

SSH execution is independent of the SSH connection and survives App/Host closure.
The owner persists PID/birth identity and stable actual owner start/end times;
confirmed process-group stop precedes Use release. Slurm still owns job/allocation
state. Unknown/empty state and missing history never imply queued or stopped;
queue read failures retain recorded evidence plus the error. Submission-side
software observations are explicitly separate from allocated node facts.

After confirmed stop, explicit collection snapshots bounded files and fixed
`compute:<attempt>:<sha256>` references. The authenticated `artifact` operation
resolves only saved digests, checks local snapshot integrity and returns original
bytes for download. Re-collection does not overwrite existing references. Partial
collection preserves available files, missing-file errors and the remote path;
retry only collects missing paths. This is per-attempt evidence in the existing
App data directory, not another generic artifact database or Run scheduler.

## UI migration

The existing draft dialog retains saved configuration/selection and adds the
shared Select for SSH versus Slurm. Existing Jobs becomes Owner receipts; it
keeps receipt/report readers and no longer implies a false site connection.
Remote execution composes public Field/Input/Select, Button, Feedback, Badge,
Split/ContentPane and MetadataList, preserving drafts and previous observations
on failure. It adds no page-local control skin. Preparation failure, unknown
submission, cancellation requested and owner-confirmed stop are separate states.

## Observed verification

macOS arm64 development checkout, 2026-11-13 (L0 and scoped L2 local transport):

| Check | Observed result |
| --- | --- |
| Compute Python API tests | 12 passed under system Python 3.9.6; real loopback HTTP/private TCP fixture checks authentication, typed operations, invalid inputs and original artifact responses |
| Compute TypeScript | `npm --prefix apps/compute run typecheck` passed |
| Standard Compute build | `PERO_GPUI_KIT_PATH=/Users/phodal/test/gpui-kit node scripts/build/apps.mjs --app compute` passed; uses existing dependencies read-only via local ignored symlinks |
| Runtime library | `PERO_APP_PYTHON=/opt/homebrew/bin/python3.14 cargo test -p pero-runtime --lib -- --skip serve_remote_compute_for_browser_acceptance`: 171 passed, 9 opt-in ignored |
| SSH/Slurm transport fixture | 2 passed: immediate exit/gated dispatch, input hash mismatch, stable times, logs, original identity, replay refusal; Slurm account and original submit identity, failed/missing queue reads, cancellation and one updated receipt |
| Authenticated OpenSSH transport | 1 passed through disposable loopback sshd/key/known_hosts; actual remote Python 3.9.6, output SHA-256 and confirmed exit137 cancellation |
| Actual App → Host → SSH | 1 opt-in passed: fixed prepare has no Use/process, mismatched approval denied, run/logs/check result, collected bytes, repeated submit blocked, immutable download after remote mutation, Host restart, original cancellation, partial output recovery |
| Browser regression | 9 passed, 1 explicit real-Host test skipped in regular invocation; actual production UI/SDK/Python with fixture Host boundary |
| Browser + actual Host/SSH | 1 opt-in passed: clicked probe/prepare/approve/observe/collect; downloaded result.json and matched SHA-256; large-input execution then confirmed stop, exit137 and Use Released |

The runtime suite initially failed its unchanged `existing_scientific_environments`
probe with ambient Python 3.9; explicitly selecting installed Python 3.14 passed
that probe and the suite. No scientific runtime installation was performed.
Clippy `-D warnings` remains blocked by existing contracts/runtime diagnostics;
the new Slurm argument-count diagnostic was fixed using `SlurmInvocation`.
Incidental Cargo lock resolution was restored; no dependency change is intended.

Screenshots actually inspected:

- `test-results/compute/remote-prepared-light.png`: frozen preparation and approval.
- `test-results/compute/remote-collected-light.png`: fixed references/downloads.
- `test-results/compute/remote-unknown-narrow-dark-24px.png`: narrow, dark, 24px UI.
- `test-results/compute/remote-live-collected-light.png`: real SSH collected evidence.
- `test-results/compute/remote-live-stopped-light.png`: real SSH cancellation/exit137/Released.
- `test-results/compute/remote-preparation-failed-narrow-dark-24px.png`: staging failure, retained inputs and unavailable execution controls.

The browser's parent/iframe bridge is a development harness. No Native window,
Electron shell, signed distribution or production deployment acceptance is claimed.
Screenshots/test artifacts are local ignored evidence, not committed binary files.
The quadrature check records `scientificAcceptance: unreviewed`; it does not
establish scientific model validity, cross-platform equivalence or GPU performance.

## Reproduction and operations

Set up a pre-authorized SSH alias outside the App. Host uses `/usr/bin/ssh`,
BatchMode, strict known-host checking and existing config/agent. A workstation
must provide POSIX process groups, Python 3 and `ps`. No Windows SSH process-tree
control is claimed. `PERO_COMPUTE_SSH` is a trusted Host composition override
used by the isolated test wrapper; it is not an App setting.

With a disposable loopback sshd and trusted wrapper configured by the operator:

```sh
PERO_COMPUTE_SSH=/absolute/test-ssh-wrapper \
PERO_TEST_SSH=/absolute/test-ssh-wrapper \
PERO_TEST_SSH_HOST=loopback \
PERO_TEST_SSH_DIRECTORY=/absolute/shared-loopback-workdir \
cargo test -p pero-runtime app_remote_loopback_run_collect_restart_and_cancel -- --ignored --nocapture
```

The test expects a loopback filesystem shared with Host so it can deliberately
mutate original files and prove snapshot immutability. It is not a remote-site
acceptance command. The separate `ssh_live_method_logs_collection_and_cancellation`
opt-in tests the transport against an explicitly selected SSH endpoint.

Browser real-Host test: start the ignored
`serve_remote_compute_for_browser_acceptance` with trusted Host SSH configuration;
it creates a short-lived private `test-results/compute/ui-host-access.json`.
Provide a non-secret connection file at `ui-loopback-cluster.json`, then run:

```sh
PERO_COMPUTE_BROWSER_ACCESS=test-results/compute/ui-host-access.json \
PERO_COMPUTE_BROWSER_CLUSTER=test-results/compute/ui-loopback-cluster.json \
node --test --test-name-pattern='opt-in real Host' apps/compute/test/workspace-browser.mjs
```

Touch `test-results/compute/ui-host-stop` to end the bounded acceptance capability.
Its private access file is removed on exit. Disposable sshd, test credentials and
remote test directories are removed after acceptance; no system SSH configuration
or user key store is changed.

Real Slurm station acceptance still requires:

1. An authorized login alias/known-host entry; Python3 on login and allocated nodes;
   `scontrol --json`, `sbatch`, `scancel`, `sha256sum` in noninteractive PATH.
2. Writable shared absolute work directory, authorized account/partition and site
   approval for the fixed CPU/memory/walltime requests. Probe actual cluster ID.
3. A queued submission, actual allocation and recorded `allocation.txt`, original
   payload/input hashes, stdout/stderr, completed output download/hash, cancellation
   during queue and running phases, and accurate denied/unavailable responses.
4. Restart/reconnect and lost-receipt handling against original marker/job/time;
   site accounting after controller history purge. Current owner reports this as
   unknown and requires manual reconciliation; it does not implement `sacct` recovery.
5. Site-specific software/environment, MPI/OpenFOAM and scientific validation from
   their domain owners. The current method is a bounded CPU reference only.

No real Slurm site, Modal credentials/provider seam, GPU allocation or authorized
cloud deployment was available in this task. Existing cloud SSH workstations can
use the same configurable SSH connection path. Modal, arbitrary/domain App remote
method admission, site-wide queue browsing and release packaging remain unverified
or unimplemented as stated; no paid resource or external deployment was created.
