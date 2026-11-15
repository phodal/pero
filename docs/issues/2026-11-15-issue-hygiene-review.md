---
kind: verification_report
status: completed
date: 2026-11-15
---

# Issue hygiene review — 2026-11-15

The user authorized this sweep while processing PRs #209 and #222. Baseline:
`master` `11b2d60d8`. Reviewed the frontmatter of all 224 local Markdown records,
the recorded disposition and remaining gates of 40 nonterminal local trackers,
and all 44 GitHub issues (eight open, 36 closed at the initial snapshot).
The 34 locally linked records cover 30 distinct GitHub issue IDs.

## Corrections

- #195 is closed on GitHub. Updated `github_state` in the MyST and Notebook
  interchange verification reports. Their `status: partial` remains: closing
  the ticket does not expand the evidence those historical reports establish.
- Normalized both #168 records from `CLOSED` to `closed`.
- Marked the contributor-workflow and project-sidebar local trackers resolved
  using their already recorded completed acceptance. GitHub #14 is also closed.
  The original release, fixture and scientific limitations remain explicit.
- Corrected the self-hosted-machines tracker: #224 merged as `60c800888`, while
  #223 remains open for its stated Native/release acceptance.
- PR #209 was closed as superseded: its three files are byte-identical to the
  versions already on master through #215, document commit `142f25bdf`.
- PR #222 merged as `79c66be0a` after exact-head
  [core CI](https://github.com/phodal/pero/actions/runs/43663747647) passed and
  all review threads were resolved. GitHub #220 is closed. The existing
  [Worker recovery tracker](2026-11-13-self-hosted-worker-acceptance.md) retains
  the implementation/acceptance details. This leaves seven open and 37 closed
  GitHub issues; standalone product packaging is not counted as release acceptance.

## Remaining GitHub scope

| Issue | Disposition and reason |
| --- | --- |
| #60 | Keep open: real Slurm/OpenFOAM site acceptance remains unchecked; local CPU references do not satisfy it. |
| #79 | Keep open: research-lifecycle umbrella, with separate domain and acceptance work remaining. |
| #138 | Keep open: requested Skill/App evaluation and evolution, without evidence of completed delivery. |
| #143 | Keep open: two authorized real-provider demonstrations and independent human evidence review are still missing. |
| #218 | Keep open: existing tracker retains conversation/history integration and product acceptance limits. |
| #219 | Keep open as architecture/reference material (`kind: analysis`), separate from #220/#223 execution trackers. |
| #223 | Keep open: merged implementation is distinct from remaining Native/release acceptance. |

The other 38 nonterminal local trackers retain explicit unknown causes, pending
runtime/CI evidence, platform limitations or unfinished scope. A linked GitHub
closure alone is insufficient: for example, #124's scanned-PDF numerical work
does not close the separate Native proxy-timeout incident.

## Ownership and verification

Shared GitHub links were reviewed rather than treated as automatic duplicates:
#50's records describe distinct MCP failures, #168 has one canonical incident
plus a supporting `verification_report`, and #195's two records are supporting
reports. No additional active tracker was created for any of these problems.
Historical reports and raw evidence were preserved.

Verified frontmatter parsing, linked issue IDs/states/URLs, remaining active
tracker counts and changed-file whitespace. This is a metadata/evidence review;
historical Desktop, provider, benchmark and scientific acceptance were not rerun.
The seven issues above retain their actual scope, rather than being closed from
age or from a merged implementation alone. Updated `issue-gc-state.yaml` after
completing the sweep.
