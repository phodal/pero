# Local contributions from public tasks

Status: implemented locally, 2026-10-28. Extends ADRs 0003 and 0006.

## Decision

A **Contribution** binds a public task and its source revision to a contributor's
local workspace, Agent conversation, reviewed Git changes and pull request.
Claiming public work does not grant private project or Worker access.

- The existing community publication is the public boundary. A dedicated,
  authenticated contribution API returns only the reviewed public description
  and source metadata. New GitHub identities may browse and claim that work
  without operator provisioning. Private Task/Run APIs retain their project scope.
- Claims use the existing Task owner. Local contributions do not manufacture a
  Worker Run or independent acceptance. Remote dispatch and local contribution
  ownership cannot silently take each other's task.
- Desktop uses the Rust Host to prepare a dedicated task checkout and branch.
  The user's existing checkout and uncommitted changes are preserved. GitHub CLI
  supplies fork and publication credentials; Pero's identity credential is never
  passed to an Agent, Git or `gh`. Required Git/CLI authentication is shown as a
  recoverable setup requirement.
- Coding uses the existing local ACP session, including its authentication,
  cancellation and permission controls. The public goal is context, not authority
  to publish. Agent instructions keep commit, push and PR creation with the
  explicit contribution action.
- Review shows the actual tracked and untracked changes. Publication requires
  the same reviewed candidate, commits and pushes the task branch, then opens a
  draft PR. Existing PR lookup reconciles a lost creation response. Failures keep
  the workspace and any known PR available for recovery.
- PR registration binds the URL, branch, commit and frozen source revision to the
  claim owner. Registration is evidence submission, not independent verification,
  merge authorization, issue closure or a contribution-point award.

## Delivery and verification

Use real temporary Git repositories, PostgreSQL, the Rust Host and Electron.
Only GitHub and the model provider are fixtures in the default end-to-end test;
the fixture Agent must actually modify the prepared checkout, and the test must
inspect the pushed commit and registered PR evidence. Source changes, foreign
claims, private-task access, missing authentication and changed review candidates
must fail with recovery paths.

Build the actual macOS development distribution after the source checks. Keep
fixture acceptance, real provider acceptance, packaged URL delivery, notarization
and public release separate in the verification record. Publishing a live PR,
release or service deployment requires its own explicit authorization.
