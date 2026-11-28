# 0043: Portable device files and Paper import

Date: 2026-11-28

Status: accepted for P0.6 of #256. Uses owner-qualified Paper identity. It does not replace an App input grant or an artifact snapshot.

## Decision

`device.files.pick` is a user gesture. The result is one of `selected`, `cancelled`, `denied`, or `offline`. A selection carries media type, size, a display name, and an opaque handle. It does not carry a filesystem path. Browser and Desktop providers interpret the same gesture. An existing input grant remains an execution-scoped grant, not a durable file identity.

Transfer is a separate step. The raw PDF bytes are posted to `POST /api/client/v1/projects/{project}/device-transfers/{upload}` with a handle id. The body is bounded to 32 MiB, the same ceiling as `readFile`. A declared length above that limit is refused before the domain is asked. Finalize checks the digest, the PDF media type, the project, and the Paper app. The domain imports the bytes once and returns the existing Paper id and immutable revision. A second finalize of the same digest returns that revision and does not create another record. A partial upload, a cancel, a foreign handle, an expired handle, a traversal id, a digest mismatch, another project, another app, or a revoked client does not import.

The handler does not keep the PDF after a successful import. The domain owns the scientific bytes.

## Native providers

An iOS or Android provider can implement the same pick result later. It must require a user gesture, must not read the handle in the background, and must not reveal an absolute path. Cancel, denial, and offline stay distinct. That native integration is not required for this slice.

## What this does not do

This route does not grant arbitrary filesystem access. It does not change the legacy Desktop input grant or the artifact transport. It does not raise the 32 MiB `readFile` bound.
