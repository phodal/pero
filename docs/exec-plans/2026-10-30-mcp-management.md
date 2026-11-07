# MCP management and Harness integration

Tracking: [#50](https://github.com/phodal/pero/issues/50). First slice starts at
`c5e5ac3ad20939f896fe29701fd1c432a0ab6213`. This document tracks implementation;
unchecked acceptance is not a capability claim.

## Ownership

GPUI presents configuration. Rust Host owns persisted settings and resolves the
selected local Agent's configuration. ACP transfers that configuration to the
Agent, which alone owns its MCP connections. The existing Go Harness already
implements MCP transports, tool generations and resource queries. Settings must
not start another MCP client to manufacture a connection-status indicator.

Zed's ContextServerStore/tool adapter split and Point's revisioned connector
settings informed this design. No Zed Agent/UI source is copied. Point's managed
connector security properties must not be attributed to its separate direct Go
MCP path or to Pero without corresponding implementation and tests.

## First slice

- Per-local-Agent user-managed server configuration, separate from operator
  configuration and the internal App Use endpoint.
- Typed revisioned get/set contracts. Atomic replacement supports add, edit,
  enable, disable and removal without inventing another scheduler.
- Explicit absolute stdio executable/arguments or HTTP URL. New entries are
  disabled. Enable is an explicit server-level grant under current Harness
  semantics; this slice does not offer unenforced per-tool controls.
- Non-sensitive configuration only. No environment/header credential fields or
  raw secret import. No plaintext fallback in the absence of an integrated
  secure credential resolver. HTTP userinfo/query/fragment are outside this
  first slice; arbitrary arguments are not automatically certified secret-free.
- Changes apply to newly created sessions, not already-running connections.
  Resume behavior must be explicit and preserve the existing ACP requirements.
- The UI reports configuration, not observed connection health. External Agents
  without an inspection capability cannot be represented as connected.
- Local scope only: no implicit copying of paths, commands or credentials to a
  Worker or Kubernetes runtime.

## Subsequent slices

1. Negotiated Pero Harness status/catalog observations, enforcing allow/ask/deny
   at tool execution as well as catalog projection. Server annotations do not
   confer trust. Reconnect does not replay side-effectful calls.
2. Resource selection and bounded Chat attachment, followed by isolated MCP Apps
   rendering through an explicit AppBridge. App iframes never receive connector
   management or credential access.

Issue #15 was closed as `not_planned` on 2026-10-30; that closure is not evidence
of complete transport/tool-refresh/resource-query acceptance. Resource queries
currently fetch on demand; a notification-driven cache is not a prerequisite for
correctness. Issue #9 remains separate memory work.

## First-slice acceptance

- [x] Domain validation, revisions, disabled defaults, duplicate names and
      operator/internal-name collisions.
- [x] Host persistence and new-session ACP injection; existing sessions unchanged.
- [x] Import rejects unsupported fields rather than silently dropping authority.
- [x] No operator credentials in settings snapshots, errors or history.
- [ ] Actual Electron add/edit/enable/disable/remove and recovery flow, keyboard,
      light/dark and narrow window, with screenshots and fixture evidence.
- [ ] Final contract/type/locale checks and Rust tests, plus exact-head CI.

All acceptance uses synthetic fixtures. No paid model requests, real credentials,
production server setup, OAuth grant, automatic package install or deployment is
required. Protocol versions supported by the existing SDK and App Use endpoint
are distinct; this work does not certify MCP 2026-07-28 conformance.

## Historical first-slice verification checkpoint

At the earlier first-slice checkpoint, the actual sandboxed headless Electron suite passed all twelve recorded groups
with no renderer errors. It exercises both Settings search and direct-menu entry.
Headed CI remains pending; screenshots/results must be associated with the exact
final source. See the resolved [renderer incident](../issues/2026-10-30-mcp-settings-renderer.md)
for the reproduced debug-Wasm stack failure and its correction. This is only the
first local configuration slice, not completion of all issue #50 stages. These
earlier graphical results do not validate the subsequent tool-policy or
session-backed resource/App changes below.

## Master integration

Master `d03ddef` adds its own source-view MCP Apps provider, reader panes and icon
theme settings. Preserve those implementations: root Host `mcp.rs` owns the Apps
provider and `mcp-servers.json`; `mcp_settings.rs` extends the existing Agent
manager with per-Agent `local_mcp` preferences. Neither store grants authority to
the other. The settings slice does not migrate credentials or automatically
connect Apps when an Agent server is enabled. Reuse the existing Apps host for
later integration rather than introducing another one.

The merged protocol retains both request/event families; Settings retains icons,
focus recovery and MCP. Combined acceptance includes both UI flows and real
Host/provider route/store separation. See the [integration record](../issues/2026-10-30-mcp-master-integration.md).

## Tool-policy continuation (2026-11-06)

The merged status/catalog implementation is recorded in
[the runtime observation report](../fitness/mcp-runtime.md). This continuation
adds policy to the existing direct Agent MCP path, not a second connection owner.

- Saved server configuration may contain `tool_policy` with an explicit
  `default` (`allow`, `ask`, or `deny`) and optional `tools` overrides keyed by
  exact remote tool names. Rules are bounded to 256 names, each at most 128
  UTF-8 bytes without control characters. No policy retains legacy server-wide
  authorization. Configuration changes affect new sessions, not existing ones.
- ACP clients and Agents advertise `_meta["pero.mcpToolPolicy"] = 1`.
  Each server carries its policy at `_meta["pero.mcpToolPolicy"]` in
  `session/new` or `session/load`. Host refuses policy-bearing configuration
  when the Agent has not advertised support; the Go Agent rejects policy
  metadata from an unnegotiated client. Policy is not a discovery annotation.
- Harness validates and freezes the whole configuration before opening any
  MCP connection. Each refreshed connection/tool generation receives that same
  policy. `deny` is a trusted registry admission rule before approval and remote
  dispatch, not catalog hiding. `ask` uses existing mandatory Chat approval,
  including under auto-review or per-call preapproval. `allow` adds no extra
  MCP gate and retains existing session approval requirements. It is not an
  override of an existing approval restriction or a certification that a tool
  is read-only. Server `readOnlyHint` cannot weaken `ask` or `deny`.
- These rules govern `tools/call` on the configured direct Agent MCP connection.
  Resource/prompt operations have separate semantics. The existing Electron
  MCP Apps source-view provider is a separate connection and authority path;
  its settings are not automatically governed by these rules. No permission or
  credential sharing with App iframes is introduced.

### Verification in the assistant's isolated workspace

Baseline: `62d004809af24983a6203a713df93a05703efc24`. Official Go 1.27.3 was
installed with user approval in the isolated workspace. No user desktop, paid
model, real credential, external scientific provider, push or merge is used.

Focused Go race tests cover policy values, frozen exact-name rules, mandatory
ask despite auto-review/preapproval, rejected/cancelled/unavailable approval,
ApprovalNever precedence, default denial on tool-list refresh, and denial before
an additional requested approval. Real loopback HTTP and disposable stdio ACP
fixtures exercise session policy and prove denied calls do not reach the
server. The existing ACP wire-approval fixture now also drives configured MCP
`ask` through `session/request_permission` under auto-review, with allow, reject
and cancel replies and a lying read-only hint. HTTP resume reapplies the supplied
policy; invalid policies never open connections. Stdio fixtures record one
process startup and completion on close. A paired
Agent fixture uses the same server/tool names with opposite policies, closes
the actual underlying transport, waits for generation two and calls again.
The frozen policies stay isolated and no business call is replayed. Twenty
repetitions pass with race detection. Its first
attempt used graceful SDK session close, which waited on subscription shutdown;
the corrected fixture breaks the actual transport instead. That initial timeout
is not counted as a pass.

The full 36-package Go module passed race tests; the final affected MCP,
Harness and ACP packages were rerun after registry admission changes. Whole-module
`go vet ./...` and the standard `scripts/build/harness.mjs` CLI build passed.
Rust verification passed 103 contract tests, 44 Host tests and 116 runtime
tests, with one existing ignored runtime test. The rebuilt actual Host passed
`tests/contracts/mcp-settings.mjs`, including negotiation failure before
`session/new`, policy persistence/restart, exact policy injection, disabled
entries and unchanged old-session snapshots. This uses an explicit ACP
capability stub, not a fake claim that the stub executes MCP. TypeSpec generation
and its check, plus the 995-message locale check, passed. Actual graphical UI
and external interoperability remain unverified and must be reported separately.
Passing Go fixtures alone does not establish the complete Host-to-UI path, signed-package
acceptance or MCP protocol conformance. At that checkpoint, resource selection, bounded Chat resource attachments and
session-bound MCP Apps unification were still stage-three work. Their implemented
status and separate verification limits are recorded below.


## Session-backed resources and Apps (2026-11-06)

Implemented in the working tree; graphical acceptance and release remain separate
steps. The existing independent MCP Apps provider is preserved, with explicit
separate entry points for session resources/Apps and independent Apps.

- Native and Electron managed panels use the active Agent session's existing MCP
  connection through the Rust Host and negotiated `pero.mcpSession` capability.
  They do not configure or connect another MCP client. Host validates the thread,
  incarnation and configuration revision; Agent access checks server generation
  and binding identity. Closing or replacing the session invalidates access.
- Resource/template listing, pagination and on-demand reads are implemented.
  Explicit **Add to Chat** re-reads the resource through Host rather than trusting
  panel content. Attachments are text-only, bounded to 16 parts and 64,000 UTF-8
  bytes including provenance, and reject binary or mixed text/blob content.
  Chat treats them as untrusted context and revalidates provenance on submission.
- Apps use `prepare` to read and validate the UI resource and establish a binding,
  followed by `tool` for the initial call. App visibility, exact resource URI,
  HTML resource shape and CSP are checked before business-tool dispatch. App
  calls use the same trusted tool-policy/approval path as the Agent connector.
  An iframe receives neither connector-management authority nor credentials.
- Cancelling an opening App or closing an active App revokes its binding and
  pending approval. Host close preempts pending tool requests; late approval
  cannot restart a cancelled call. Active-view cleanup revokes authority before
  awaiting untrusted App teardown, including when that teardown never responds.
  Revoking one binding does not grant or revoke another binding's authority.
- Settings expose explicit default allow/ask/deny and exact-name overrides while
  preserving an existing policy on edit. Returning to the legacy server-wide
  grant requires an explicit choice. These policies govern tool calls, not a
  blanket resource/prompt grant or the separate independent Apps provider.

### Latest implementation verification

The final implementation checks below were run after the App teardown-order fix
and the last shared-menu changes. They are local synthetic-fixture evidence, not
release CI or graphical acceptance.

- `tests/contracts/mcp-session-panel.mjs` passed the real Rust Host → Native Node
  provider → Go ACP Agent → loopback MCP server path. The same test also exercises
  the Electron session adapter against that actual Host/session. The receipt at
  `test-results/mcp-session/panel-result.json` records one MCP initialization,
  zero model requests and four approval events: two successful and two cancelled.
  It covers resource selection, initial/interactive App approval, visibility
  denial, closed binding rejection, cancellation during initial approval, and an
  active App whose teardown never responds. Both cancellation cases block late
  approval without business-tool execution. This is a **non-graphical** full-chain
  test; it does not launch or validate Electron's rendered UI.
- Six targeted Node tests passed across managed-session and existing independent
  provider suites, including actual provider subprocess duplex I/O, scope and
  generation checks, malformed resources, text/binary and size boundaries,
  cancellation, and preservation of the standalone provider path.
- `tests/contracts/mcp-ownership.mjs` passed the actual Host/independent-provider
  route and store separation regression.
- Desktop bundle build and strict targeted TypeScript checks over modified entry
  points passed. The locked `pero-ui` Wasm check passed, including shared menu and
  Chat-resource consumer changes; only existing dead-code warnings remained.
- Contract generation consistency, the current 998-message locale check and
  `git diff --check` passed. Existing Go and Rust verification above is augmented
  by the session/binding regressions, not replaced by UI mocks. Dependency lock
  files were not changed for these tests.

### Remaining acceptance and publication status

- [ ] Run actual Electron and Native graphical flows for the final source,
      including Settings policy edits, both explicit provider modes, resource
      attachment and App cancellation; capture screenshots and keyboard,
      light/dark and narrow-window evidence. The new settings E2E cases are
      authored and syntax-checked but have not been graphically executed.
- [ ] Run final exact-head CI and packaging/interoperability acceptance as
      appropriate. Local tests do not certify MCP protocol conformance.

The current environment cannot supply graphical acceptance: a minimal headless
Electron window exits with SIGTRAP, with D-Bus socket access denied in stderr;
there is no display or Xvfb. The sandbox was not disabled to work around this.
Whole-project TypeScript checking also remains blocked by the missing generated
`web/src/reader-wasm/pero_reader_web` artifact; the targeted modified-source check
passed, but this is not a claim that the whole-project check passed.

At this documentation checkpoint the changes have not been published, pushed or
released. Any later draft PR, final CI or release must record its actual revision
and results rather than treating this working-tree checkpoint as acceptance.

### Draft PR CI follow-up

Draft PR #146 integrates master `b64e415e` (GPUI Kit 0.9.0). Its first final-head
CI passed core TypeScript, Rust/Host contracts and Harness race/vet/build, but
failed Gazelle declaration ordering and three pinned AST file receipts after
reviewed changes to ACP cancellation and MCP audience dispatch. The follow-up
sorts the new source entries and refreshes only those reviewed receipts; it
does not remove checks or claim AST semantic equivalence. The unchanged
`ListTools`/`fromMCPResult` contracts and added MCP operation cancellation are
recorded in each mapping note. Updated-base local Rust tests (272 passed, one
ignored), locked Host build, settings contracts and real non-graphical
Host/panel/Go ACP/MCP test passed without changing the committed lock file.
Graphical acceptance remains outstanding.


### Final review on macOS — 2026-11-07

Actual Electron acceptance reached the policy editor. The old coordinate-only
test clicked Save below the scroll viewport after the added policy fields made
the form taller. The UI retained the valid unsaved draft; no save was sent. The
fixture now scrolls actual controls into the observed Settings viewport before
clicking or typing. This is a test-driver correction, not evidence of a failed
production save. Final UI and integration results are recorded after rerunning.
