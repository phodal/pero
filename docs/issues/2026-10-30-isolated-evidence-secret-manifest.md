---
kind: incident
status: verifying
date: 2026-10-30
---

# Generated Cilium Secrets entered disposable acceptance evidence

Review of isolated acceptance run `40982983463` found generated TLS private-key
fields in the uploaded `cilium-manifest.yaml`. Helm's rendered chart includes
the `cilium-ca` and `hubble-server-certs` Secret resources as well as workload
configuration. The fixture copied that complete manifest to its evidence
directory merely to check image digests. Deleting the owned cluster does not
remove an already uploaded artifact. No secret values belong in this record.

## Correction

The raw rendered manifest now stays in the existing private temporary directory,
which the owned fixture cleanup removes. The image-pin gate validates every
rendered `image:` line before emitting a fixed-schema receipt containing only
immutable image references. Missing, mutable or malformed image pins fail with
no receipt content and no source-value echo. It is a narrow projection of the
pinned chart's image declarations, not a general-purpose YAML sanitizer.

The upload step also explicitly excludes the legacy manifest filename, so an
old file in a reused evidence directory is not retained. IPv4 CNI readback,
network probes, admission, original identity, artifact and cleanup gates remain
unchanged. This fix does not retroactively sanitize historical uploads.

## Verification and remaining actions

Offline tests cover Secret `data`, `stringData`, nested List payloads, image
comments, missing or invalid pins, and CLI success/failure output without secret
markers. A new actual isolated CI run and inspection of its uploaded archive are
still required. Existing affected artifacts require separate inventory and
authorized removal; no deletion or credential rotation is claimed here.
