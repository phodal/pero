# Pero

## Architecture rules

Keep the implementation simple and the scope explicit:

- Before adding complexity for a speculative, highly unlikely concurrency or
  security edge case, explain to the user exactly what could go wrong, how
  likely it is, and how much additional code it would require. Add it only
  after the user agrees. Do not silently expand the scope to make things
  "theoretically more robust".
- Validate external data once at the entry point, then pass typed values
  inward. Do not repeat the same validation at every layer.
- Keep one-off logic inline at its call site. Extract a function only when
  the logic will be reused or encapsulates substantial complexity.
- Avoid try/catch when it is unnecessary. If one function can handle the
  logic, keep it in one function instead of splitting it up.

Name the concept before you write the code. Each domain rule lives in exactly
one place, and that place is a domain type and its functions, not a handler,
an adapter or a test helper.

- **Model first.** Give each domain concept a named type that carries its
  invariants: a Go struct with methods, or a frozen Python dataclass in the
  gateway. Inside a domain package, do not pass `map[string]any`, raw JSON or
  loose strings between functions. The same check in two callers means a type
  is missing.
- **Functional core, imperative shell.** Domain logic is a function of values:
  `(state, input) -> (next state, effects) | error`. It reads no clock,
  environment, file, network or process; the caller passes time and IDs in.
  The shell (daemon, worker, gateway, providers) does I/O, calls the core, and
  carries out the effects the core returned. `Apply` in
  [backend/project/apply.go](backend/project/apply.go) is the reference shape:
  one fold that Host and Hub both use.
- **One owner per transition.** A state machine has one definition, and
  everything else calls it. A handler does not repeat a core check "for
  safety". It maps the core's error to a status code.
- **Dependencies point inward.** The shell imports the core; the core never
  imports the shell, a transport or generated types. The allowed imports are
  the table in [backend/architecture_test.go](backend/architecture_test.go).
  A new boundary is a new row in that table, not a new test and not a comment.
- **Seams, not layers.** Add an interface only where a second implementation
  is real (provider, harness, store, sandbox runner). The consumer declares it,
  and it holds only the methods the consumer calls. Do not add a single-use
  interface, a wrapper that only renames or forwards, a
  `manager`/`service`/`helper`/`util` package that owns no concept, or an
  in-process DTO copy of a domain type. Convert at a boundary once, in one
  place.
- **Replaceable means deletable.** If you delete an implementation, only its
  composition root (`cmd/`, daemon wiring) should break. If a domain package
  breaks, the seam is in the wrong place.
- **A code file stays within 1000 lines, tests included.** A longer file holds a
  concept that has not been named yet. Split it by concept, not at a line
  number. Files that were already longer are frozen in
  `scripts/file-lines-baseline.json`. They may shrink but never grow. Do not
  add a file to the baseline or raise a ceiling.

## Tests

Test the concept, not the call graph. A test must change only when behavior changes.

- Most tests drive the functional core with values: from a state and an input,
  assert the next state, the effects or the error. They need no mocks, clock
  or sockets. Keep one table per concept, in that concept's `_test.go`. A bug
  fix adds a row to that table, not a new `TestIssueNNN`.
- Shell tests are few. Each one proves wiring end to end over loopback or a
  temp data home. They do not re-prove core rules.
- Structural rules are data. Import boundaries are rows in
  `backend/architecture_test.go`. Do not write another source walker.
- Fake only at a seam. Share one fake per seam; do not write one per test file.
- Do not test getters, constructors, field copying, generated code, or the
  order of calls to a mock. Do not add a case another layer already pins. A
  test that breaks under a refactor that keeps behavior is testing the
  implementation. Rewrite it or delete it.

Wait on a signal or a condition you can observe: a bounded poll of an external
process's readiness line or file effect is a wait; a timed pause hoping your
own goroutines have arrived is a race. Do not sleep to make two timestamps
differ; set them. One
clock, injected or frozen at the module's own binding. Do not assert an order
you did not define. No literal port for a real listener (bind `0`). No network
beyond loopback unless the test is an explicit opt-in, such as
`DEEPSEEK_REAL_API=1`.

- Workspace Go modules: `./bazel test` for the target you changed, or `go test`
  inside that module.
- Backend service: `go -C backend test -race ./...`.
- Execution also verifies standalone: `GOWORK=off go -C backend/execution test -race ./...`.
- Gateway: `PYTHONPATH=src python -m unittest discover -s test -p 'test_*.py'`

## UI

Use [DESIGN.md](DESIGN.md) for color design and implementation.
Review UI changes against [DESIGN-REVIEW.md](DESIGN-REVIEW.md).
Optimize for task completion, not visual minimalism. Every screen should make it obvious what matters, what the user can do, what is happening, and what needs attention.

- **Task-first**: Design around user goals, not internal modules. Every screen should clearly communicate its primary content, actions, and current state.
- **Visual minimalism**: Use black, white, and gray as primary colors. Establish hierarchy through spacing, typography, and subtle borders. Avoid excessive shadows, nested cards, and decoration.
- **Concise copy**: Remove redundant explanations, repeated statuses, and generic AI-style filler. Don't move unnecessary text into tooltips. Reveal secondary details on demand; keep critical warnings visible.
- **Information density**: Avoid excessive whitespace and card-heavy layouts. Prefer tables, lists, split views, and progressive disclosure for complex workbenches.
- **Complete states**: Cover Loading, Empty, Running, Success, Error, and Disabled. Empty states should suggest the next action; errors should provide recovery paths; long-running tasks should expose progress and results.
- **Clear interactions**: Provide feedback for every action. Confirm or allow undo for destructive operations. Avoid nonfunctional controls, duplicate actions, and unnecessary dialogs.
- **Accessibility**: Support keyboard navigation, visible focus states, sufficient contrast, and semantic labels. Never rely solely on color or hover to convey meaning.
- **Responsive & themed**: Use theme tokens consistently. Verify light/dark modes, narrow windows, overflow, and varying content lengths.
- **Real verification**: Inspect the running UI, key interactions, error states, and browser behavior. Code review alone is insufficient.
- **Engineering constraints**: Persist Desktop preferences through harness runtime settings. Follow `ui-workbench.sidebarBrowser` registration and Go/frontend namespaces. Prefer Point-owned slots and wrappers over upstream patches.

**Principle: Optimize for task completion, not visual minimalism.**

## Git Discipline

### Baby-Step Commits (Enforced)

- One commit = one concern (feature, fix, or refactor) with Conventional Commits format.
- No kitchen-sink commits; split mixed concerns.
- Target budget: under 10 files and under 1000 changed lines per commit.
- Include related GitHub issue ID when applicable.
- Before commit binary file / big size file, should ask User.

### Co-Author Format

- If closing an issue in commit text, verify against `main` first: `gh issue view <issue-id>`.
- Always add co-author information.
- Only ONE co-author line is allowed. If multiple agents contributed, aggregate into ONE entry

Format example: Co-authored-by: <AgentName> (<You-Model>) <Email>

## Pull Request

- For UI-affecting changes, include browser screenshots or recordings in PR body (prefer `agent-browser` captures).
- Attach e2e screenshots/recordings when available.

## Issue Feedback Loop

- Before creating a new issue, search `docs/issues/` for existing incident context.
- For non-trivial failures, create/update `docs/issues/YYYY-MM-DD-short-description.md` first (focus on WHAT/WHY), then escalate to GitHub.
- Use one canonical active local tracker per problem. If you need supporting material, record it as a non-issue note via `kind: analysis`, `kind: progress_note`, or `kind: verification_report` instead of opening another active tracker for the same problem.
- Use `kind: github_mirror` only for GitHub-synced mirror files. Those mirrors are reference material, not canonical active local trackers.
- If a local record tracks a GitHub issue, populate `github_issue`, `github_state`, and `github_url` so issue review can detect status drift automatically.
- When resolved, update the local issue record and close the GitHub issue.
- Run issue hygiene/garbage collection at least once every 7 days. Track the last sweep time in `docs/issues/issue-gc-state.yaml` (`last_reviewed_at`).
- If `last_reviewed_at` is 7+ days old when an agent reads this contract, the agent should invoke `AskUserQuestion` first: whether to run issue sync/cleanup now.
- After finishing an issue GC pass, update `docs/issues/issue-gc-state.yaml` with the new `last_reviewed_at`.

## Reading Order

When starting work on this repository, read in this order:

1. `docs/ARCHITECTURE.md` — runtime topology and boundaries.
2. `docs/adr/README.md` — decision index, then relevant ADRs.
3. `docs/fitness/README.md` — quality gates and verification flow.
4. Task-specific files in `docs/design-docs/` or `docs/exec-plans/`.

