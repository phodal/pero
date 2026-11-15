# Local research Projects and App-owned resources

Status: implemented in source, 2026-11-02. Runtime acceptance is recorded in
[research Projects verification](../fitness/research-projects.md).

Extends [local ROADMAP execution](0011-local-roadmap.md),
[workspace content tabs](0013-workspace-content-tabs.md) and
[App Use](0014-app-use.md).

## Context

Projects previously combined local workspace directories and optional shared
Cloud project identifiers. A project opened directly into its task list. Its
Sources page listed GitHub repositories; scientific records remained in their
individual Apps. A research question could not have an independent title or
collect related papers, reading studies and experiments without becoming a code
repository or Cloud task.

Point's project composition provides a useful direction: retain one identity
while assembling goals, context, work and evidence. This increment applies that
principle to local scientific work without importing another runtime or making
App records into Cloud Runs.

## Decision

`ResearchProject` in `pero-contracts` owns a stable caller-supplied ID, title,
research goal, optional workspace and `ProjectResourceRef` values. It validates
creation, editing and links as pure value operations. Renaming or moving a
research project does not change its identity. Two questions may use the same
local directory.

`WorkbenchPreferences.research_projects` persists through the existing
runtime-owned settings workflow. The field defaults to an empty list for older
profiles. There is no separate renderer storage, project database or background
sync process.

The workbench overlays saved research projects on the existing directory/shared
catalog. A saved project's key is `research:<id>`. If its directory belongs to an
existing shared project, it retains that association and the known checkout
aliases. Unrelated local and Cloud entries remain available. Creating or linking
resources to an existing directory upgrades that entry; ordinary directory
navigation remains supported.

Project details open an Overview before the existing Tasks, Sources, Execution
and Settings views. Overview presents the research goal and linked objects.
Creating a project does not require login, a directory or an Agent. When supplied,
a directory is persisted only after the existing Host workspace command resolves
its canonical path. An optional
directory continues to support the existing local ROADMAP and ACP workflow.

The first supported links are:

- Paper App: saved papers and frozen reading studies.
- Control Lab and Lab: existing experiment records.

`ProjectResourceCatalog` contains public observations acquired through the
existing Host-owned App backend boundary. The parent UI displays summaries and
opens the owning App using its location; it does not read backend files or
invent substitute scientific state. Resource content stays with the App. A link
contains only App, kind, object ID and observed revision. Relinking the same
object updates its revision; unlinking changes only the project association.

For papers, a revision is the content digest. Other catalog revisions fingerprint
the observed summary fields, including recorded state when available. They are
not immutable snapshots of a complete experiment, all outputs or its numerical
evidence. If the current observed revision differs, the old reference stays
until the user explicitly updates it. Missing objects and failed catalog reads
remain visible with recovery actions. Recorded check verdicts remain separate
from execution status, so completed execution can still display a failed check.

## Boundaries

The Project is an organizing context, not an execution engine. App backends keep
scientific input validation, studies, experiment specifications, trials,
observations and reports. Host/ACP keep Agent sessions, permissions and
cancellation; existing Cloud tasks and Workers keep their current owners.

A link grants no new App permission, starts no computation and copies no source
document. The Project neither reinterprets an experiment's state as scientific
acceptance nor treats a reading report as an executed experiment. Simulations,
recorded outputs, verification and scientific conclusions retain the owning
App's distinctions.

This increment does not add shared research-project synchronization, cross-App
experiment scheduling, automatic evidence promotion, full result-version
storage or a universal scientific verification policy. Those require their own
concrete contracts and acceptance evidence.

## Project Agent — 2026-11-14

A saved ResearchProject can bind one primary Agent and its delegated ACP
conversations. `ProjectSessionBinding` lives in the original `session_created`
journal entry. Goal and resource references still belong to the saved project;
session identity, messages, approvals, tool evidence and cancellation still
belong to Host/ACP. Execution status is projected by the existing App Agent
transcript owner, rather than stored as a second project task state machine.

The primary receives frozen project context and the `project_work` MCP tool.
Delegation starts an ordinary independent ACP session with a retained workspace,
returns its exact thread identity, and lets the primary inspect original
receipts or send follow-ups and cancellation. Repository children use detached
Git worktrees so their existing workspace leases can coexist with the primary
turn. Changes are available for inspection in that workspace; no implicit merge
or promotion to a shared Task/Run takes place.

Delegation inherits the primary's acknowledged permission setting through the
existing ACP configuration owner before the child's first prompt. An
incompatible Agent policy fails visibly instead of falling back to its default.
Model-facing evidence contains bounded original tool receipts, including tool
IDs, observed status and output excerpts. Child narrative remains reported
evidence; it is not independent verification.

Saved research projects open the Project Agent conversation centrally, using
the existing ChatPanel and its single composer, approvals and cancellation.
Primary and child conversations appear in the global sidebar. The right
context uses existing Project resource links and the retained conversation
artifact/Viewer owners. An explicit evidence-summary request returns to the
primary conversation. Bound empty sessions cannot retarget or replace their
original identity through ordinary new-conversation controls. After restart, journal replay
restores membership. Continuing explicitly loads the acknowledged original ACP
session; unsupported or unavailable loads fail visibly, without substituting a
new session. Interrupted execution is not automatically retried.

Implementation scope and limitations are tracked in
[the Project Agent task record](../exec-plans/2026-11-14-project-agent.md), with
observed verification in the existing research-project record.
