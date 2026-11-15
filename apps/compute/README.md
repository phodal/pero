# Compute

Compute saves non-secret SSH workstation / Slurm connection configurations and
consumes the Rust Host's remote execution capability. Authentication uses the
Host's OpenSSH configuration, agent and existing `known_hosts`. The App never
receives passwords, key material, SSH options or command/executable selection.

In **Remote execution**, choose a saved connection, probe access, then prepare the
bundled CPU midpoint quadrature method. Preparation creates an exclusive remote
attempt directory and freezes method, inputs, destination and observed submission
software into a digest. Review the exact inputs and, for Slurm, account,
partition and requested 1 CPU / 256 MiB / 600 seconds before **Approve and submit**.
No scientific payload runs during preparation. The method also bounds its own
CPU walltime to 600 seconds; SSH memory/CPU limits are not claimed as enforced.

Host commits the existing `EnvironmentUses` transition and submission intent
before dispatching. SSH records an original remote process group independently
of the SSH connection. Slurm uses the existing `SlurmSite`, original job marker,
cluster, job ID and submit time; queued is distinct from allocation. The allocated
wrapper verifies the frozen entry, method and inputs before scientific work.
Unknown submissions are never replayed. Observe the original identity instead;
lost Slurm receipts/controller history require operator reconciliation at the
retained site/path, rather than an invented empty queue or stopped result.

Observe reads original status and bounded logs. Cancellation requested and owner
confirmed stop are distinct. Closing the App/Host leaves submitted remote work
running; reopen and observe/cancel the original attempt. A Use releases only
after durable original stop evidence. Host snapshots collected files by SHA-256;
`compute:<attempt>:<sha256>` resolves through the authenticated artifact operation.
Downloads return those local immutable bytes even if remote files change.
Repeated collection retains existing references. Missing files are reported as
partial collection, keeping the remote directory and allowing an explicit retry
of missing files only. Files are bounded to 1 MiB each, 4 MiB per transport read;
oversized files remain remote and the limitation is displayed.

The first connected method is an intentionally fixed numerical reference, with
samples and repetitions as inputs. Its result records a numerical check and
`scientificAcceptance: unreviewed`. Domain Apps retain their own methods and
verification; this does not dispatch arbitrary scripts, PyBaMM, HPC ReFrame,
OpenFOAM, packages, or scientific acceptance. Cloud GPU workstations may use an
existing SSH alias through the same provider; there is no GPU allocation or
Modal API adapter in the current owner seams, and this change creates neither.

**Owner receipts** reads the existing `executions/` directory. Submission and
later scheduler observation replace the same owner receipt, rather than creating
another Run database. It is not a site-wide queue listing. **Experiment reports**
retains the existing six-experiment PyBaMM snapshot import and downloads; these
collector observations are separate from the remote method.

The standard Python backend stores configuration in `clusters.json`; the Host
stores private remote invocation/evidence files under `.remote/` in Compute's
App data. The private JSONL capability is injected only into this App backend.
There is no public arbitrary-command, approval queue, retry scheduler or generic
artifact database. GET/POST `/api/remote` forwards typed operations; original
configuration/report APIs remain compatible with legacy Slurm drafts.

Validation:

```sh
npm --prefix apps/compute run typecheck
npm --prefix apps/compute test
npm --prefix apps/compute run test:browser
node scripts/build/apps.mjs --app compute
PERO_APP_PYTHON=/path/to/python3.12 cargo test -p pero-runtime --lib
```

Authenticated loopback commands, screenshots and real Slurm site prerequisites:
[remote Compute verification](../../docs/fitness/remote-compute.md).
