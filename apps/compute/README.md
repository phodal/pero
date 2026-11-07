# Compute

Independent HPC cluster workspace. This App saves and selects local **connection
drafts**: name, login host or SSH alias, Slurm account, partition and working
directory. Drafts remain **not connected**, including after editing or restart.
The App does not collect passwords, keys or credentials and makes no SSH requests.

The Jobs view says the cluster queue cannot be read until a cluster is connected.
Its API returns `jobs: null` and `jobsStatus: not_connected`, not an empty result
from an invented scheduler query. Slurm submission, monitoring and cancellation
have no connected transport yet; those actions are absent.

Separately, `executions/` under the app data directory is the one receipt
directory the execution owner writes. A batch submission and its later
scheduler observation share one file. A managed process writes a process
receipt there too: host, entry, exit code and log names, with no external job
id and no scientific verdict. A missing directory is
`executionsStatus: none`. A submission receipt and a scheduler observation stay
distinct. Recorded entry, log and output paths are displayed only when the
receipt names them. An unreadable receipt returns `executions: null`; it is not
presented as an empty queue. Reproduce builds a review draft in the page and
does not submit. Existing Host Worker settings and software Environments
are explicit navigation destinations, not evidence of a connected Slurm cluster.
HPC Benchmarks remains a separate App with its existing local reference methods.

The standard App Python backend stores non-secret drafts atomically beneath
`PERO_APP_DATA/clusters.json`; Host owns installation, origin authentication and
process lifecycle. GET `/api/state` reads configuration and any owner receipts in `executions/`.
POST `/api/clusters` creates or edits a draft. POST `/api/selection` chooses an
existing draft. No endpoint accepts commands, receipt writes, or scientific execution.

Validation:

```sh
npm --prefix apps/compute run typecheck
npm --prefix apps/compute test
PYTHON=/path/to/python3.12 npm --prefix apps/compute run test:browser
node scripts/build/apps.mjs --app compute
```
