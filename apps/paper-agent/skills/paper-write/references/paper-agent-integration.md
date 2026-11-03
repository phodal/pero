# Paper Agent authoring integration

These stage skills belong to the existing `paper-agent` App and ship in its
builtin payload. They provide guidance for authorized workspace operations;
manuscript persistence, managed TeX builds and author-PDF preview routes remain
planned. Shipping skills does not advertise those tools or enable a new UI.

## Existing owners

Paper Agent owns saved external papers, frozen PDF studies, original passages
and source-evidence reports. A research answer is not an author manuscript.
Reading-only study reports keep their experiment list empty; do not insert an
author draft or self-reported execution there to imitate manuscript writeback.

Resource import, code audit and reproduction use the sibling skills in this
App when the requested task needs them. Reuse their evidence and actual
capabilities; writing does not start an experiment merely to fill a manuscript gap.

Host/ACP retains the conversation, model selection, approvals, process lifecycle
and cancellation. Paper Agent will own manuscript records and editing/preview
views. An internal Agent Plugin can package instructions and tool declarations
if the App needs that assembly; it does not create a separate product or runtime.

## Proposed manuscript operations

These are design names, not currently advertised tools. Discover actual schemas
before invocation and use only the available authorized route or workspace.

| Operation | Domain effect | Owner |
| --- | --- | --- |
| Read/save manuscript | Persist text, assets and evidence references as a revision | Paper manuscript store |
| Save plan/claims | Associate argument and evidence with a manuscript revision | Paper manuscript domain |
| Build manuscript | Request compilation of identified source inputs | Paper build adapter using authorized execution |
| Build status/cancel | Observe or stop the existing build execution | Execution owner |
| Read diagnostics | Return actual file/line build errors | Paper build adapter |
| Preview manuscript | Deliver the exact produced PDF and page artifacts | Paper App artifact routes |
| Save review | Store located findings for a revision/build | Paper manuscript domain |
| Export manuscript | Package selected source/PDF artifacts | Paper export adapter |

Keep the first build implementation direct. Add a replaceable execution interface
only when a second implementation is real. Existing source-acquisition and
source-read routes do not authorize compilation of downloaded TeX.

## Preview

Reuse the App's EmbedPDF/PDFium rendering through a manuscript-artifact adapter.
Current readers take saved Paper/PDF identities; they do not already accept
author builds. Keep external source papers and author manuscripts as different
domain objects within the same App and existing research Project.

Use App SDK Split panes for source/editor and rendered PDF, with diagnostics on
demand. Bind the preview to its build. Source changes mark the previous PDF out
of date; failed builds retain the last successful PDF with its actual revision.
Findings on old PDF pages remain tied to that build. Add SyncTeX only after
basic build/preview works with real mapping files and a viewer integration.

Handle no manuscript, loading, missing environment, compiling, success, compile
error and historical preview. PDF rendering and model/human page inspection are
different observations; no preview event implies scientific acceptance.

## Skill discovery and packaging

The App payload includes the four stage entrypoints and shared references under
`skills/paper-write/references`. The headless catalog reads SKILL.md only and
requires an explicitly authorized skills root. References and sibling skills
need a separate authorized file reader; resolve their paths from the selected
skill directory inside that root. If unavailable, disclose the missing guidance
and finish the supported part without inventing commands.

App packaging does not automatically add skills to Desktop discovery or mount an
Agent Plugin in an existing conversation. Verify the actual App manifest,
installed resources and session assembly before claiming discovery or writeback.
No separate Codex plugin manifest or marketplace installation is required for
Paper Agent's authoring feature.
