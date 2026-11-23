---
kind: progress_note
date: 2026-11-14
---

# Project Agent

The first increment gives a saved ResearchProject one primary Agent conversation
that can delegate bounded work to ordinary Host-owned ACP conversations. The
project's existing goal and resource references remain its durable context.

## Project workspace and prompt composition — 2026-11-23

The Workbench sidebar shows saved Projects by their existing catalog identity.
A Project row opens its primary conversation. The Project retains its own right
tab selection while users write, switch to a delegated conversation, or return
to the coordinator. Overview, linked materials, Tasks, repositories and PRs,
execution, and settings use their existing view owners. Directory and shared
workspaces remain available from the Projects library.

The existing ChatPanel Composer replaces the initial Agent selector and Start
screen. Each unopened Project retains the text and selected reference tokens of
its own draft. The first send starts the Project-bound primary through the
existing Host command, then submits the captured draft using the acknowledged
conversation's ordinary prompt and queue path. During startup the draft stays
visible. Admission failure leaves it editable. A provider startup failure before
ACP acknowledgement retains the logical conversation and offers an explicit
retry; the draft remains available for the next send. Once a conversation exists, the
same Composer uses its ordinary model, approval, cancellation and history
controls. Project file suggestions resolve in the saved Project's directory,
while explicit file selection uses the existing attachment flow.

Host materializes the coordinator or child instructions and saved Project
context when starting or restoring an ACP session. ACP carries the user text
and selected references through the original turn path. It appends separate
text blocks for the shared role and evidence instructions and the serialized
Project data. The native Harness continues to own its system prompt. This
migration uses the shared navigation row, right tab, Composer and typography
roles. Runtime verification belongs in the
[research Projects record](../fitness/research-projects.md).

The Project name uses the shared Workbench content tab. Its close button and
keyboard shortcut follow the visible Project route and keep the coordinator,
its draft, and any running work. Main Agent and child actions belong to the
conversation toolbar. The right titlebar shows the Project views and its own
close button. The Project keeps the selected right view when the inspector is
hidden. Conversation resources keep their existing Files, Artifacts, and
Changes controls in the same Workbench column. In narrow windows, the
explicitly opened Project inspector uses the content area and returns focus
to the Composer on close.

Overview presents the saved goal. Materials and experiments use the Materials
tab. The existing goal editor retains its unsaved fields by Project key while
the user navigates, and explicit Save and Cancel finish editing.

## Concepts and ownership

`ProjectSessionBinding` identifies the saved project, parent conversation and
work label. The existing `session_created` journal carries this binding, so
replay restores ownership without a second project database. The original ACP
conversation, transcript, approvals, cancellation and exact-session resume own
execution. A binding is not a Task/Run and does not reinterpret remote Worker
state or scientific acceptance.

`ProjectDelegationPolicy` carries the primary's acknowledged permission
selection into child startup. The original ACP configuration owner must
acknowledge it before readiness or a prompt. The first version requires the
same Agent when a permission setting is advertised; incompatible mapping is
an explicit error. It does not silently start a broader default policy.

The primary Agent receives a frozen project context and a `project_work` MCP
tool to delegate, inspect evidence, append instructions and cancel children.
The tool routes to the existing Host session owner. It returns execution
receipts and original conversation identities. Summaries must name their source
conversations, observed tool results and missing verification.

`ProjectAgentEvidence` retains original tool IDs, partial observed receipts and
bounded output excerpts; truncation is explicit. The shared model evidence
budget omits the primary's own result so repeated summaries do not recursively
embed it. Full transcripts remain available in their original conversations.

ACP currently takes a workspace write lease for a turn. Children therefore use
separate persistent workspaces: detached Git worktrees for repositories, or a
dedicated working directory with the original source path in context otherwise.
Worktree results remain available for inspection; this increment does not merge
them automatically. A restart restores associations and terminal observations;
it does not replay interrupted prompts. A user follow-up explicitly loads the
acknowledged original ACP session, and fails visibly if loading is unsupported.

## Product surface

Saved research projects open their main Agent conversation in the center.
The global sidebar lists the primary and its delegated conversations with
status and ordinary session menus. The right context presents the saved goal,
linked App resources and access to original conversation artifacts. Existing
ChatPanel owns the only composer, model selection, approvals and cancellation;
existing resource and Viewer owners retain files and versioned outputs.
Refresh failures retain prior content and the shared conversation draft.

This adds consumers of public GPUI buttons, text inputs and Pero theme roles;
there is no token or component migration and no new page-local control skin.
Directory-only projects, ROADMAP Tasks, remote Task/Run execution and App-owned
scientific materials retain their existing owners.

## Verification

Domain behavior, Host/ACP/loopback provider wiring, restart, and actual Electron
UI evidence are recorded in the existing research-project verification record.
Scripted provider results, real model execution, Native GUI and signed release
acceptance are reported separately.

## UI review and next direction — 2026-11-14

The user rejected the current visual design. The functional implementation is
a checkpoint, not product UX acceptance. Its central status report gives too
much space to repeated goals, results, paths and actions while the actual
primary conversation is confined to the narrow ChatPanel. An additional
instruction form competes with the existing composer.

A read-only review of the running Cursor Agents window inspected Library,
List, Board, the primary project conversation and its compact four-Agent
roster. Switching the Project view retained the conversation. Switching from
the child to the primary conversation retained the Project view. The original
child conversation and Library view were restored afterward. Captures are in
`test-results/cursor-project-audit/01-library.png` through `05-agents.png`.

The proposed revision keeps the primary conversation in the central reading
column and the existing composer as the sole instruction owner. Compact
Agent navigation exposes status and opens original conversations. A secondary
Project surface holds durable context and actual outputs rather than repeated
assistant prose. Worktree paths, IDs and raw receipts move behind details;
summaries stay in the primary conversation with source references. Existing
permission cards, session ownership, evidence and execution rules stay in their
current owners. This direction was subsequently authorized and implemented in the revision below.

## Conversation-centered revision — 2026-11-14

The user authorized this revision in the isolated worktree. Saved research
projects now enter the central Agent conversation by default; Overview lives
in the right context column, including goal editing. Directory-only projects keep their existing
entry. The existing ChatPanel is mounted once, as the main content, with its
original composer, model/permission controls, tools and approval cards.

Migration: the old Project Agent report rows, copied result excerpts, workspace
metadata and ProjectInstruction textarea are removed. Primary/child navigation
uses the shared session row in the global sidebar, with the original notice,
status and menu owners. Current project selection pins the original conversation
so background child creation does not replace the primary conversation. The
right context shows the saved goal and the existing linked-resource surface;
artifacts/files use the existing retained ChatPanel resource column and Viewer.
The new public resource open/close actions forward to those existing owners.
No tokens, icon artwork or page-local control styles are introduced.

Narrow windows show the conversation first and open Project materials through
an explicit toolbar action, with a direct return to chat. Existing drafts and
resource reading state remain with their original owners. Closing resources or
switching layout does not cancel work. Summaries return to the primary chat.

Direct continuation after restart now uses the shared composer. Conversation
retains its typed ProjectSessionBinding from the original journal; acknowledged
closed Project conversations can submit again. Host's ordinary prompt shell
calls the same existing exact-ACP-load path used by Project follow-up before
forwarding the prompt and context. Unbound closed conversations keep their
existing behavior; no replacement session or automatic prompt replay is added.

The shared resource header uses destination and view menus in narrow columns;
selected artifact identity and version controls move beneath the titleband.
This preserves access to the existing file, artifact, change and layout actions
without overlapping the fixed-height window header. Sidebar rows use recorded
Project outcomes only when no live session status takes precedence. The project
roster shares the sidebar scroll owner, including after expanding More.

## UI polish after PR creation — 2026-11-14

PR #231 publishes the Project Agent slice. The follow-up removes the duplicate
Chat resource header when the Project shell already supplies that navigation,
and removes the redundant Main Agent shortcut beside the sidebar. Summarize
uses a concise visible label with the full evidence action in its tooltip.
Project materials have a 320px minimum reading width; link/refresh commands use
shared named icon controls in this inspector, while the full resource page keeps
its existing labels. The same resource/composer owners and probes are retained.

Shared component migration: session-row selection changes from surface-muted
(which matched its sidebar background) to accent-soft/accent-text in both
themes; user turns use surface-muted without the input-like outline. Consumers
remain the ordinary and Project conversation/session surfaces. No new colors,
artwork, execution state or preference store is introduced.


## Cursor style inspection and entry correction — 2026-11-14

The user clarified that opening a project must immediately expose Project
Agent, with Overview on the right. The previous back action could recreate the
full-page Overview shown in the user's screenshot. It is removed. Saved-project
Overview/Agent selection now shares the existing Agent entry; directory-only
projects keep their established overview. Project Tasks, repositories/PRs,
execution and settings remain reachable through the right header's named menu
and their original owners. Goal editing reuses the existing ProjectEditor in
the inspector while preserving the conversation and draft.

A fresh inspection of installed Cursor.app captured the child conversation and
Library, primary project conversation, and expanded Agents roster in that
order. The original child/Library and developer-tools state were restored.
Evidence: `test-results/cursor-style-audit/01-conversation-library.png`,
`02-project-primary.png`, `03-agents-disclosure.png`. These captures establish
visible behavior in this configuration, not Cursor's complete design system.

Observed inline DOM values included a 271px sidebar, 796px composer maximum
width, 20px conversation bubble radius and 14px transcript row gap. The root
system font stack was -apple-system/BlinkMacSystemFont/sans-serif, with a normal
weight of 418 and medium/semibold weights of 500/600. These are local observed
values, not inferred universal defaults. No exact color tokens or uninspected
compositing behavior are claimed.

| Visible Cursor rule | Remaining Pero mismatch | Implementation direction |
| --- | --- | --- |
| Stable reading column aligned with input; spare width becomes margins | Multiple header bands and broad message blocks compete with content | Align transcript and composer on one maximum-width column and simplify chrome responsibilities |
| Short user messages hug content on the right; assistant prose has no card | Shared user surface remains broad, with similar visual weight to controls | Make bubble width content-dependent and preserve right alignment; keep agent prose on the reading surface |
| Neutral surfaces and subdued selected rows | Large outlined Projects selection dominates the sidebar | Adjust the shared navigation selection role; retain visible keyboard focus separately |
| Compact regular-weight session rows, small quiet status marks and trailing ages | Strong status and action presentation can dominate titles | Present current domain state with restrained indicators and reveal secondary actions on interaction |
| Compact empty composer; Agents/Changes context sits beside the task stage | Configuration, workspace, permission, diff and send controls remain simultaneously prominent | Keep execution authority discoverable while reducing resting-state visual weight in the shared Composer |
| Project title, resources and file tree remain in an independent right object surface | Central full-page Overview was an alternate landing page | Corrected in this change; project entry and restart keep the conversation central |
| Primary/child switching preserves the right Project view | Navigation can otherwise feel like opening unrelated pages | Keep conversation, resource selection and draft in existing owners; verify transitions rather than static mockups |

These findings explain why three columns alone did not establish visual
acceptance. The entry correction is implemented; the broader shared typography,
message sizing, navigation and Composer changes above are recommendations, not
claims that the present interface already matches Cursor. Full keyboard,
contrast measurement and Cursor dark-theme review were not performed.

## Authorized four-area implementation — 2026-11-14

The user authorized implementing the analysis directly and updating PR #231.
This revision changes shared presentation owners together:

| Previous presentation | New owner/contract | Consumers and preserved behavior |
| --- | --- | --- |
| Full-width user turn | Shared transcript, right-aligned intrinsic width capped at 88%, generated 20px bubble radius | Ordinary Chat, Project Agent and App Chat retain selectable Markdown, links and attachments |
| Accent outlined navigation and accent session fill | Shared Chrome neutral navigation wash from TypeSpec NavigationStyle; one fill per row | Native/Wasm sidebar/session rows and Web SidebarRow retain independent focus, selected semantics, notices and action disclosure |
| Repeated Project toolbar below the titleband | Project header projection composed into the existing main titleband | Main/child title, summary, refresh, Overview, search, project-view and artifact controls keep their existing state/action owners |
| Persistent multi-row Composer and reserved hint space | Shared Composer switches by current visual line count and attachments | One-line rounded input expands for multiline/attachments; model, stop, send remain in-frame; acknowledged permission, Agent, workspace, diff and usage stay directly accessible below |

Completed sessions use the existing small filled-circle icon with their full
accessible status. Failure, cancellation, waiting and running retain their
own presentations. No navigation, execution, permissions, provider admission,
settings persistence or project lifecycle was duplicated or moved into a view.
Theme action colors and user typography preferences remain authoritative.

Tokens are edited in TypeSpec and regenerated, including shared SDK CSS and
Rust constants. Web SidebarRow uses the generated neutral token; its catalog is
typechecked and token checks pass, but no separate Web App navigation visual
acceptance is claimed. The actual Electron and Native renderers were inspected.
An initial screenshot revealed double selection filling by the row and its
inner button; it was corrected before final captures. The ordinary Chat suite
also exposed its old fixed input coordinate; it now clicks the existing
Composer bounds instead and passes the actual IME/stream/approval flow.

The scoped visual comparison and iteration record is `design-qa.md`. It records
expected product/content differences from Cursor rather than claiming an exact
clone. Screenshots remain ignored local artifacts, not binary Git commits.

## Readable execution evidence and project catalog — 2026-11-14

The user requested compact, initially collapsed execution rows and reported
that the Projects catalog remained cluttered. Tool rows were already collapsed;
the large JSON blocks came from assistant prose echoing the same tool receipt.
The shared transcript now derives a `ReplyPresentation` from exact JSON receipts
in the same user turn, retaining surrounding prose. A matching streaming prefix
is also disclosed through its existing tool row. Different or unrelated JSON
remains visible. Stored replies, tool results, copy/save output, and artifact
provenance retain the original text. Copy/save labels explicitly identify the
original reply. Summary links route through the original message entity; an
explicit source reveal renders that original message and its highlight.

| Previous presentation | New shared presentation | Preserved behavior |
| --- | --- | --- |
| Long command in the collapsed activity header | Short Shell command label and explicit domain status | Existing expand/collapse control shows command, stdout and exit code; generic receipts remain in their detail reader |
| Exact tool JSON repeated in assistant prose | Retained readable Markdown projection | Original history, source navigation, links, copying and saving retain their existing owners |
| Child execution workspaces appear as implicit projects | Catalog excludes implicit workspaces bound to child Agents | Explicit saved bindings and research projects remain; no history or directory is deleted |
| Oversized section headings and full-width catalog rows | Small muted headings with inline count in a bounded column | Existing project open/create/folder/task actions remain shared controls |

The Electron fixture deliberately continues echoing the receipt so acceptance
exercises the projection rather than avoiding the problematic content. The
actual Native check also uses older persisted conversations containing the
original JSON. This is presentation of observed evidence, not generated prose
or a scientific result assessment.

## Merge review repairs — 2026-11-14

Before the user-authorized merge, verified review findings were repaired in
their existing owners. Permission resolution is now declared in the generated
Host contract. Shared transcript status tracks pending question IDs alongside
permissions/authentication and resets old turn failures on follow-up. Project
MCP credentials now resolve a single primary identity; the envelope carries no
caller-supplied primary. Rebinding expires the prior credential.

The serialized evidence batch measures its actual pretty JSON byte size and
reports omitted sessions. Session admission precedes workspace allocation. A
new Start prompt cannot silently succeed against an existing primary; it directs
the caller to Followup, while an initial-request retry does not replay input.
Project response and send-failure paths share request completion, so controls
can recover. Long goals and materials share the right inspector's scroll owner.
Receipt disclosure requires standalone boundaries and preserves assistant code
and fences containing additional content. The existing Host and Electron flows
exercise the changes. Incident scope and validation are recorded in
`docs/issues/2026-11-14-project-agent-merge-gates.md`.

## Project navigation and coordinator entry, 2026-11-23

In Cursor 3.31.15 on macOS, the Projects section displayed one Pero row while
the active Chats tab was titled Pero. Opening Agents inside that conversation
revealed four named workers with individual open and add-to-chat actions.
The composer showed Send follow-up. Tasks and Pull Requests occupied a separate
Apps tab group with its own Hide Apps action.

The installed Molten renderer in Cursor.app supplies the following evidence.

| Component | Observed behavior |
| --- | --- |
| boot-BXxkQaOp.js | The chat title resolver uses the project title when the session ID equals the project ID. Other session IDs are looked up in sideChats. Worker activity lookup carries coordinatorId and workerId. |
| thread-reply-DKTFV2Yi.js | The composer resolves editing and mode-specific overrides before choosing its default. Expanded mode advertises Plan, Build, skills and context. The ordinary follow-up default is Send follow-up. |
| project-thread-view-MPjKnKfc.js | Thread replies carry a threadRootId and a separate reply composer. Opening the Project itself does not require selecting a reply thread. |
| project-page-NVbaKYyZ.js | Task filtering and list/board selection belong to the project page. They can change while the main conversation stays open. |

Pero uses its saved research ID and the Host's primary session binding. The
sidebar consumes the full project catalog. Opening an older catalog entry saves
its identity and replaces the old workspace tab key. Its project row returns to
the primary transcript. The Agents button expands a roster inside the conversation. Each delegate opens its original session. When a result exists, Add result to main chat appends a frozen reference to the primary draft for review before sending.
The former full-page project list and per-page project switcher have been
removed. The group actions menu owns creation, folder opening and all tasks.
The right inspector continues to use Pero's existing project views.

The macOS preview showed both local project rows, restored Pero's existing
follow-up composer, and showed Change directory for the missing pero-ws-b
directory. Returning to Pero removed that directory alert. The Electron Project
Agent suite exercised delegation, switching back to the primary, original-session
follow-up, independent inspector visibility and restart with a fixture provider.
