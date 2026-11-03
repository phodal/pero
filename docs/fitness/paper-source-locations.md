---
kind: verification_report
date: 2026-11-03
---

# Paper source discovery and skill verification

Scope: local macOS development work based on `b2d35d24`. The source action moves
from the representation toggles to the end of the TeX pager/zoom controls. Its
visual and keyboard order agree; it remains a secondary 24px icon button with a
14px glyph and the accessible label “查看源码”. The source dialog and Escape
recovery remain unchanged. Browser inspection covered desktop dark mode and
490×840: all four views stay visible, toolbar width/scroll width are both 360px,
and the icon no longer shrinks to 2px under the SDK's later button CSS.

The shared [TeX location guidance](../../apps/paper-agent/skills/research-resource-import/references/tex-source-locations.md)
is linked by resource import, reproduction, code audit and build skills. The
bundled `tools/locate-source.py` recovers source scopes and verified physical
member paths for an explicit arXiv version. It uses existing approval/integrity
owners and the same main-file selection as the TeX preview. There is no new
download, extraction, compilation, observation or storage migration.

`~/.pero/paper` remains Library Save's export-copy directory. Managed source
archives, member indexes and hash-named members remain under the selected App
profile's `app-data/paper-agent/research-v1`. Environment or explicit `--cache`
selection takes precedence over the two known standard/native-preview roots.
No whole-home discovery is added. Unmatched export copies remain unverified,
even when their names resemble the requested version.

## Real source check

The default offline lookup for `2610.27435v1` found one approved Native preview
scope and the unique main file `rsi_harness.tex`, with `ailab.cls`, bibliography,
seven figure PDFs and the logo. No matching TeX export copy was present in the
configured export directory; this does not claim that no paper PDF was exported.
The archive hash remains
`d685f8dca43eab3c91e88a8558ede027c566e9f2ca617384b54984004f61218b`.

An independent skill-guided read followed the updated reproduction instructions,
ran the offline locator, read the main source and matched lines 813–815:
`figure05_ablations.pdf`, its caption and `fig:ablation-comparisons`. It rendered
that exact PDF member into a temporary PNG and visually inspected the plot.
The observed labels include Pass@1 57/58.5/64 and Pass⁴ 43/45/51 for w/o HE,
w/o ER and RiseHarness, with separate axis ranges. These are source-figure
observations, not rerun results or an independently reproduced experiment.

This pass used authorized local file/viewer tools. It performed no network
request, TeX compilation or experiment, and wrote no App evidence observation.
A locate-only wording ambiguity was corrected so the reproduction skill can
finish with source findings without preparing an experiment protocol.

## Checks and limits

- Pinned Python environment: 258 tests, 257 pass and one existing skip. The new
  shell journey verifies an actual approved fixture, original main-file reads,
  unchanged managed records, wrong/missing versions, tampered members and export
  copies that cannot become approved evidence. Use `TMPDIR=/private/tmp` for the
  existing PC-Gym canonical-directory tests on macOS.
- All four modified skills pass skill-creator `quick_validate.py`.
- The system Python 3.9 is rejected with an explicit configured-environment
  message; the configured supported interpreter completes the lookup. Skill
  examples now select the App's Python instead of assuming system `python3`.
- Four payload tests pass, including execution of the staged offline locator
  against its staged backend outside the checkout. It is included with its shared
  reference by the existing builtin allowlist.
- Paper TypeScript and App bundling pass. Source opening, Escape focus recovery
  and Tab from zoom to source were checked in the running browser.

Native light-mode verification used an isolated App/profile with copied approved
paper data and the freshly staged payload. The actual WebView displayed the
source icon after zoom, opened `rsi_harness.tex` automatically and returned to
the preview on Escape. Screenshots are `native-source-action.png` and
`native-source-dialog.png`. The shared Native preview had an actively used
Scientific Viewer and retained its previous WebView; it was not restarted to
force an asset refresh. Its managed Paper package is updated for the next load.

The App's source-image tool supports bounded PNG/JPEG/WebP previews; these seven
PDF figure members still have `imageAvailable=false`. The skill can use an
authorized local renderer when supplied, as in this verification. It does not
claim automatic PDF-figure rendering or answer-attachment delivery inside Pero.
Chat image output requires the actual session's attachment/artifact capability;
App-private preview URLs are not invented as public or chat-loadable image URLs.

Ignored local evidence: `test-results/paper-source-locations/` contains the
locator response, Python log, interface screenshots and `figure05_ablations.png`.
