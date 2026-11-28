# 0041: Owner-qualified resource identity and Paper read

Date: 2026-11-28

Status: accepted for P0.4 of #256. Depends on the local research reference in `research_project` and the client credential on `/api/client/`. It does not replace campaign evidence (#249), runtime bindings, or the capability snapshot (ADR 0040).

## Decision

An App object reference names one owner, one project binding, one App instance and version, one kind, one id, and one revision. The reference is identity. It is not a grant, a filesystem path, a URL, or a runtime incarnation.

`ProjectResourceRef` stays the local reference. Turning it into a shared reference requires an explicit project binding. The binding copies the revision class. An observed catalog fingerprint stays observed. This slice does not promote it to immutable evidence.

Revision classes:

- `immutable` is a 64-character SHA-256 of the bytes. A Paper read accepts only this class.
- `observed` is a fingerprint of catalog fields. It is not reproducible evidence.

Resolution is one function of the request:

- An existing object resolves to the owner recorded on that object.
- A new operation with no object resolves only when the project policy names a target.
- A device operation resolves local, including when the request also names an existing remote object.
- If that owner is unavailable, the result is `owner_unavailable`. The function has no alternate owner and does not treat a timeout as a reason to try somewhere else.

The read-only route is `POST /api/client/v1/projects/{project}/app-resources/paper`. The caller is the scoped client credential already required for `/api/client/`. The body is the qualified reference. Headers that try to name an owner, a backend, a path, or a worker or operator token are refused, as are those fields in the JSON. The response is the owner, revision, digest, media type, base64 body, and provenance `domain:paper`. It does not include a path, a backend URL, or a credential.

The Go handler authorizes the client and asks a `PaperDomain` supplied at the composition root. The domain returns the bytes for that owner, project, and id, or it reports that the owner is down. A miss is `missing`. The requested local project, App instance, and App version must equal that record; a different binding is `missing` and is not read as the same id. The handler does not store the bytes and does not look up another host. Until a composition root supplies a domain, a valid Paper request fails closed with `owner_unavailable` rather than as a missing grant.

`readPaperResource` in the App SDK calls one injected transport. Local and remote transports can return the same Paper bytes. If the response names a different owner, a different revision, carries a forbidden field, or does not hash to the requested revision, the client rejects it. The client has no fallback transport.

## What remains unsupported

This route does not create, update, delete, annotate, or upload a Paper. It does not read a study, notebook, dataset, insight, connector, skill, automation, or agent object. It does not call a device. It does not accept an arbitrary URL, a raw stdio stream, a backend port, or a generic invoke gateway. Cache entries are accepted only when they carry the same owner, revision, provenance, and bytes as the domain response. A cache is not an upload and is not used when the owner is unavailable.

## What this does not change

Campaign evidence, worker execution bindings, and `RuntimeReference` stay the authorities they already are. Desktop remote project routes and host protocol files are unchanged. Local-only mode still uses `ProjectResourceRef`.
