---
kind: incident
status: resolved
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

## Verification

Offline tests cover Secret `data`, `stringData`, nested List payloads, image
comments, missing or invalid pins, and CLI success/failure output without secret
markers. Actual isolated run
[40984695917](https://github.com/phodal/pero/actions/runs/40984695917) passed on
head `488c5560d43cf25fa04f25199dcf07fee3f688f0`, tested merge
`71410ba3d8c13407d9a7f0c85f2d71748bc8ae33`, including cleanup exit zero.
[Artifact 12947340362](https://github.com/phodal/pero/actions/runs/40984695917/artifacts/12947340362)
contains 96 files, no raw Cilium manifest, and a receipt of only the two pinned
image references. Its ZIP SHA-256 is
`b0fbdcd5e6b616872f5fee68d8fbdf005395806513c0102342db34e5ed39e19e`.
Plaintext and base64 PEM-private-key marker scans had no hits. This bounded
inspection is not a guarantee against every possible kind of secret.

All 16 affected historical isolated artifacts were permanently deleted with
user authorization on 2026-10-30; each removal was independently verified.
CI runs and logs, unaffected isolated evidence, and trusted/Desktop artifacts
were retained. Old links to the deleted archives no longer work. The keys were
generated for disposable clusters whose node deletion was verified; no reuse
of user credentials was observed. No credential rotation is claimed.
