# GitHub PR content views

Base: master `1f61064d`, 2026-11-07. Status: complete for the scoped increment; actual Native Reviews verified.

Chat and document GitHub pull-request links should open a retained, typed PR
content tab. Navigation owns tab identity and closure; Host owns read-only
GitHub access using the existing GitHub CLI seam and its local login. The PR
model owns URL admission, state and section selection. UI consumes that model
and shared Pero controls; no GitHub iframe or Agent-generated HTML is involved.

Deliver Changes, Description, Commits, Checks and Reviews, explicit refresh,
external-browser fallback, local load errors, and retained data during refresh.
Use the existing workspace checkpoint for stable PR identities. Closing a tab
does not change GitHub or stop a conversation. Discover the active branch's PR
after a completed turn without overwriting a user-selected content view.

Migration: ordinary GitHub PR links currently use `open_url`; admitted PR links
will use `WorkspaceItem::PullRequest`. Ordinary URLs and App locations retain
their current owners. Existing document/file changes remain distinct sources.

Validation: URL/state core tables, Host read-only wiring over a fake GitHub CLI,
workspace navigation/recovery regression, protocol generation and type checks,
actual Electron PR view captures in light/dark/narrow layouts. Native compilation
and actual Native inspection must be recorded separately from Electron evidence.
Merge/review mutations and Cursor-specific Graphite/Origin services are outside
this increment.


## Delivery and generalization

PR identity/navigation, protocol, Host reads, shared diff and five-section UI
are committed as separate concerns. The latest user request adds a comparison
of Cursor's 22 registered content kinds and a shared `WorkspaceLink` admission
for PR, Web, App and external addresses. Existing workspace, Web engine,
ContentReader and App owners remain authoritative. Unknown schemes are ignored;
source-relative files still require Host admission.

Generalization migration: `open_app_link` -> `open_workspace_link` in Chat,
research-project references and composer context; PR Markdown uses the same
entry. Document `ContentLink::External` -> `Address(WorkspaceLink)`; standalone
readers keep external URL opening. Narrow Web now follows the PR content-first
rule, with a Conversation action; saved preferences remain unchanged.

Native inspection found shared HTML paragraph identity collisions. The retained
Kit patch fixes block scoping; Electron rich-HTML acceptance passes. Actual
Native Reviews recheck passed after macOS was unlocked: all five sections,
embedded HTML/table scrolling and refreshed Reviews ran without a panic.
Full command receipts,
screenshot observations, stale legacy harness and scope limits are recorded in
[verification](../fitness/pull-request-view.md). The full reference matrix is
[Cursor content views](../../research_notes/cursor-content-view-capabilities.md).
