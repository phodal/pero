---
kind: progress_note
date: 2026-11-14
---

# Project Agent

The first increment gives a saved ResearchProject one primary Agent conversation
that can delegate bounded work to ordinary Host-owned ACP conversations. The
project's existing goal and resource references remain its durable context.

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

Research projects gain an Agent entry in their existing navigation and overview.
The surface presents the main conversation, delegated work, actual transcript
status, result/error and actions to enter the original conversation, append
instructions, cancel or request a primary-Agent summary. Existing ChatPanel
continues to own composing, model selection and approvals. Refresh failures
retain prior content and offer local recovery.

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
current owners. This redesign is proposed and has not been implemented.
