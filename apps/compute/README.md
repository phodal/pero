# Compute

Independent HPC cluster workspace. This App saves and selects local **connection
drafts**: name, login host or SSH alias, Slurm account, partition and working
directory. Drafts remain **not connected**, including after editing or restart.
The App does not collect passwords, keys or credentials and makes no SSH requests.

The Jobs view says jobs cannot be read until a cluster is connected. Its API
returns `jobs: null`, not an empty result from an invented scheduler query.
Slurm submission, monitoring and cancellation have no connected transport yet;
those actions are absent. Existing Host Worker settings and software Environments
are explicit navigation destinations, not evidence of a connected Slurm cluster.
HPC Benchmarks remains a separate App with its existing local reference methods.

The standard App Python backend stores non-secret drafts atomically beneath
`PERO_APP_DATA/clusters.json`; Host owns installation, origin authentication and
process lifecycle. GET `/api/state` reads configuration. POST `/api/clusters`
creates or edits a draft. POST `/api/selection` chooses an existing draft. No
endpoint accepts commands or scientific execution.

Validation:

```sh
npm --prefix apps/compute run typecheck
npm --prefix apps/compute test
PYTHON=/path/to/python3.12 npm --prefix apps/compute run test:browser
node scripts/build/apps.mjs --app compute
```
