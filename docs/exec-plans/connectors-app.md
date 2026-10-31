# Connectors App migration

Point reference: `b45190a3db725953128b4a8a40e95a287aa9bfd7`.
Pero starting revision: `fbda7c2b7f131821b667cd53bc3b638d9b548a50`.

## Scope

Move the existing Point Connectors catalog and management UI into a local Pero
App. Preserve catalog search/categories, configuration/import, revision-checked
edits, enable/disable/remove, secret references, OAuth/cancellation, connection
verification, explicit tool selection, discovery and managed install records.
Catalog membership is not evidence of a working account or provider.

The App owns presentation. Its declared Host permission admits management
requests through the existing App origin and lifecycle boundary. The trusted
Desktop Host owns the connector manager, encrypted credentials, connections and
child lifetime. A bounded MCP adapter exposes approved connector tools to the
existing ACP session; the App does not own an Agent, approvals or a task queue.
Existing per-Agent MCP settings and operator servers remain separate grants.

Reuse Point's portable connector domain, request controller and protocol
drivers, with attribution and independent Pero build inputs. Keep native XPC
and messaging-channel delivery outside this UI migration; Point already has a
separate Channels surface. The shared stdio/HTTP and first-party account
drivers are capability backends, not another Harness.

## Implementation checkpoints

1. Port the catalog, management state transitions, validation and portable
   drivers without depending on a sibling Point checkout at build/runtime.
2. Bind management to the enabled App permission, encrypted Host storage and
   ACP tool execution. Preserve revision/lease/cancellation checks.
3. Port the React UI with Pero App SDK theme, locale, components and chat draft
   entry. Add the App to the workbench product and normal build/package flow.
4. Verify configuration/restart, conflicts, credentials, OAuth/cancellation,
   tool discovery/selection/call, disable/revocation and cleanup using isolated
   loopback fixtures. Inspect actual Desktop light/dark, narrow and keyboard
   states. Record real-provider and packaged-release gaps separately.

## Baseline

`npm run check` passed on the starting revision. No source changes were present
in either checkout when implementation began. Earlier Automation work is a
separate task; this migration does not extend its scheduler.

## Result

The Workbench App, trusted Host composition, independent native driver and
build/package wiring are implemented. The management/protocol and actual
Desktop checks passed. See [ADR 0025](../adr/0025-connectors-app.md) for the final
ownership and [verification](../fitness/connectors.md) for provider/platform and
release gaps. No push or release was performed.
