# Pull request content and shared link routing

2026-11-07, macOS arm64 development builds. Base `master` is `1f61064d`;
implementation is on `codex/pull-request-view`. Research:
[Cursor PR View](../../research_notes/cursor-pr-view-implementation.md) and
[all 22 registered content kinds](../../research_notes/cursor-content-view-capabilities.md).

## Delivered behavior

GitHub PR links open a retained `WorkspaceItem::PullRequest` with Changes,
Description, Commits, Checks and Reviews. The shared GitHub CLI seam performs
read-only GET requests; existing local `gh` authentication owns access. No token
is copied into the renderer. Refresh retains the snapshot, selected file and
unaffected sections when a new request fails. Large file lists scroll within
180px so the selected diff remains immediately accessible.

Completed conversation turns discover the branch PR in the original workspace.
A new discovery creates a background tab without changing the active content.
Navigation owns identity, deduplication, focus, closure and checkpoint recovery.
Reopening a canonical PR link reuses the content; closing it does not delete the
PR or conversation. Narrow PR/Web layouts keep content primary and offer a
Conversation action without changing saved dock preferences.

`WorkspaceLink` is the shared typed admission for Chat, document links, PR
Markdown and context references. PR links take precedence over generic HTTP(S),
which reuse the existing isolated WebDocument engine. App locations remain
App-owned; mailto opens externally. Relative file links retain their source
and existing Host containment checks. Unsupported schemes are not executed.
Standalone readers retain their existing external URL behavior.

Migration: old `open_app_link` call sites now consume `open_workspace_link`;
source-aware `ContentLink::Address` passes an admitted target inward without
revalidating it. Shared Button/feedback components, StreamText, theme colors,
Git diff parsing and the existing workspace/session owners are reused. No token
source, artwork or second tab framework was added.

## Reproduction and evidence

With the repository's configured Kit checkout and Rust toolchains:

```sh
node scripts/cargo.mjs test -p pero-contracts -p pero-ui -p pero-chat-ui
node scripts/cargo.mjs test -p pero-host
node tests/contracts/pull-requests.mjs
node tests/contracts/pull-requests.mjs --live
node tests/e2e/pull-requests.mjs
npm run check
```

Current Host, Native, Wasm, wasm-bindgen, web and Desktop builds are prerequisites
for the corresponding process/UI checks. `--live` performs public GitHub reads;
it is an explicit network opt-in. Other PR tests use local process fixtures and
an ephemeral loopback listener.

Observed results:

- Contracts: 118 passing; UI: 24 passing; shared Chat UI: 32 passing. Host:
  48 passing, one ignored. Core tables cover URL identity, stale response
  rejection, retained partial observations and background-tab focus/history.
- Host fixture contract passes read-only CLI wiring, schema validation, all
  sections and failure delivery. Public `phodal/pero#164` also passes metadata
  and all paginated sections. Pagination consumes each page's mapped JSON array;
  it does not combine the incompatible `gh --slurp` and `--jq` options.
- Real Electron passes background discovery without focus theft, actual Markdown
  link clicks, canonical reuse, close/reopen with the conversation intact, all
  five sections, failed refresh/recovery, light/dark, narrow layout and restart.
- PR-description HTTP link opens an actual isolated loopback Web engine despite
  X-Frame-Options DENY. It has neither `window.pero` nor Node `require`. Reopening
  retains the same engine and form value; the engine remains visible at 920px.
- Screenshots under `test-results/pull-requests/` were inspected: Changes in both
  themes, Description, Reviews, failure feedback and the narrow content layout.
  These are development fixtures. Captures are ignored artifacts, not committed
  binary assets. The HTML review fixture exercises multiple inline flows.
- `npm run check` passes TypeScript and generated theme/design/token, locale,
  protocol and icon checks. Native shipping-feature and Wasm builds pass.

The older `tests/e2e/web-documents.mjs` was also attempted. It stops at its first
route-switch assertion: its fixed `(90,24)` click targets the current sidebar,
not a conversation tab. The capture contains only a Web tab. It does not reach
its later legacy toolbar coordinates. This stale harness is not counted as
passing; the new PR suite verifies the affected actual Web-link flow above.

## Native observation and remaining acceptance

The actual Native window opened real public PR #164 and displayed the merged
state, 26 files, +2716, Description, Commits and Checks. Reviews exposed a real
shared Markdown crash with nested HTML in bot comments. The Kit patch scopes
nested root/paragraph identities so their inline-flow caches cannot overwrite
each other's inputs. The rich-HTML Electron flow and both builds pass afterward.

After macOS was unlocked, actual Native verification completed against public
PR #164 with source `02f2a3d1`. All five sections were inspected. Reviews rendered
and scrolled through the CodeRabbit HTML walkthrough, nested content and table.
Switching back from the other sections and refreshing Reviews completed without
crashing; Refresh returned to enabled and the process log contains no panic.
The capped list leaves the selected diff visible in the real 26-file PR.

Observed captures are `test-results/pull-requests/native-reviews-html.png` and
`native-changes-real.png`; they are ignored local evidence. The
[canonical incident](../issues/2026-11-07-markdown-html-flow-identity.md) is resolved.
This is actual macOS Native development-window evidence, separate from Electron.
No signed-package, Native light/narrow-window, Windows/Linux, physical IME or
screen-reader acceptance is claimed.

## Scope limits

Before PR publication, the branch was rebased without conflicts onto master
`f514d945`. The 222 unit tests above passed again (one Host test remains ignored),
as did `npm run check`, Host/Native/Wasm/web/Desktop builds and
`npm run test:pull-requests`. These integration checks used `43b91481`; the
earlier actual Native observations remain separately attributed above.

The first PR CI run rejected the stale Bazel npm manifest hash after the two
test-script additions. A normal `bazel test //:checks` regenerated only that
hash record and passed all seven checks; dependency locks did not change.
`bazel test --config=ci //:checks` then accepted the frozen record and reused
those seven passing results.

GitHub only; no Graphite/Origin or enterprise host admission, PR mutation,
merge, approval, inline review-thread actions or a server stream of PR updates.
Reviews include review bodies and issue discussion comments. GitHub's files API
may limit file coverage and omit patches; the view states those gaps. Text diffs
are bounded to 5000 lines. Persisted recovery saves PR identity, the subview,
the selected file and local viewed marks, then reloads current data. It does
not persist fetched snapshots or a pixel scroll offset. A viewed mark stores
the head it was recorded against and becomes stale when that head changes.
While that PR route is current, the view refreshes every 60 seconds. That
poll absorbs the snapshot: files and commits stay when the head and commit
count are unchanged, checks stay when their name, status and conclusion
fingerprint is unchanged, reviews stay when the count and decision are
unchanged, and the description is rewritten only when the body text changes.
Discovery of the same ref and the refresh button replace the whole snapshot.
The timer stops after the route changes.
A closed discovered PR stays dismissed for this Workbench lifetime; a later
process and completed turn can discover it again. Discovery failure is silent
because most workspaces have no branch PR. Private/unauthenticated GitHub UI
recovery has fixture error coverage, not a separate live private-repository run.

## Follow-up: citations, lists, reading and plans

The same branch now routes one `SourceTarget` to an existing owner: a workspace
file and line span, `pero-output://thread/tool`, `pero-terminal://id`,
`pero-changes://thread/(turn|worktree)[/path]`, an unmapped
`vscode-remote://background-composer+` file, a GitHub PR, or
`docs/exec-plans/**/*.md`. Terminal citation focuses an existing tab and does
not start a shell. Project Sources lists up to 30 pull requests for a
repository with `gh pr list`, filtered open, closed or all. When the visible
rows have more than one GitHub status they are grouped Open, Draft, Closed,
then Merged, and each row shows the relative open time from `createdAt`.
A row opens the existing PR page as a preview. Link-driven opens use preview
tabs; double-click and drag both promote that tab out of preview. The link
surface preference stays in-app unless reversed by a middle click or the
platform modifier; the explicit GitHub button still uses the system browser.
A recognized plan shows its first heading and the checkbox todo count, and
execution submits the plan body and tells the agent not to commit or push.
Message chips for a known PR show the GitHub mark, status, number, and a
tooltip with title, author and opened time. There is no author avatar.

Concept tests after this alignment: contracts 126, UI 25, chat UI 32, Host
48 passed with 1 ignored, and the Host fixture contract. The fixture expects
`opened_at` on the loaded pull request and on the first listed item. Electron,
Native window, `npm run check`, Bazel and the public GitHub `--live` read were
not repeated. No Canvas-share, continuous remote-desktop, machine-metrics or
voice-transcript page was added: those content kinds are not workspace items,
and the isolated desktop in ADR 0019 is an execution boundary rather than a
session content view.
