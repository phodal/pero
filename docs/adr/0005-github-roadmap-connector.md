# GitHub ROADMAP tasks and Desktop connector configuration

Status: accepted, 2026-10-28. Extends ADR 0003.

## Decision

The Go GitHub source imports one Task per Issue and one Task per Markdown
checkbox in an explicitly configured ROADMAP. The `auto` path tries
`ROADMAP.md`, then `docs/ROADMAP.md`; an explicit repository-relative Markdown
path is also supported. Existing repositories without this setting keep their
Issue-only behavior.

This repository keeps its checklist in root `ROADMAP.md`. Each item uses
`- [ ] Title. Description.`: the first `. ` separates the short Task title from
its description, while the full item remains the execution goal. Items without
that separator retain their original first-line title.

Headings retain group context. Nested checkbox items bind to a parent Task.
Issue labels and ROADMAP hashtags become tags. A checked item is a closed source,
not an accepted Run. ROADMAP intake creates drafts and never authorizes automatic
execution. The same project-scoped Task/Run and ownership rules apply.

Source identity is separate from source revision. Explicit `<!-- pero:id:... -->`
markers retain identity across wording or location changes. Fallback identity
uses checklist context and title; description-only edits retain identity.
Ambiguous items produce an incomplete-source
result. A complete snapshot can mark removed items missing. A partial fetch or
parse cannot close previously observed work. Claimed or executed goals remain
frozen, with current metadata exposed separately as `latest_source`.

Repository contents are read through the fixed GitHub API at a pinned commit.
Source links identify that commit and line. File/commit changes alone do not
invalidate every unchanged checklist goal. Credentials and automatic execution
policy remain with the Go service.

Desktop adds a GitHub connector connection form for the cloud origin and a
project-scoped access token. Provider credentials remain server-owned; clients
see only authorized repository bindings. Non-secret connection settings and an
OS-encrypted credential are persisted through the existing harness runtime
settings owner. The renderer receives neither stored credentials nor ciphertext.
Disconnect is explicit; a saved configuration never escalates to inherited
operator credentials. Source tabs, context paths and tags make imported work
visible without requiring all paginated Tasks to be loaded first.

## Verification

Use parser fixtures and real PostgreSQL for identity, nesting, tags, checked and
missing items, partial snapshots, deduplication and immutable execution goals.
Actual Electron must configure the connector, restart, display Issues and
ROADMAP Tasks, and preserve project scope and credential boundaries. A separate
opt-in run reads `phodal/pero` from GitHub and compares its imported checklist
with the pinned repository content. Viewing Tasks never dispatches them.
