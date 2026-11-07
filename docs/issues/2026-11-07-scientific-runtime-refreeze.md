---
kind: issue
status: resolved
---
# Scientific runtime cannot be refrozen after replacement

PR #149 freezes runtime bytes in local.json but omits them from the bundle
identity. Replacing Python without changing version metadata collides with the
old immutable bundle, so neither refreezing nor approval can recover. New specs
must bind the observed runtime identity while historical specs retain their hashes.

Resolved: new specs include an optional scientific runtime digest, enforced by
ScientificPython.require. Old payloads omit the field and retain their identities.
Validation: 50 PC-Gym tests and 12 approval tests passed with Python 3.12
on macOS, with canonical TMPDIR=/private/tmp. Runtime replacement tests preserve
the old bundle bytes and accept a separately frozen binding. No solver run.

Follow-up review fixed CLI identity enforcement when imported local metadata omits
the observation, interpreter launch/decoding refusals and credential-free parent
launch. Historical scientific acceptance is explicitly separated from these
review corrections; no new solver execution is claimed.
