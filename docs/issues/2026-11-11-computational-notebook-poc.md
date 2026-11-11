---
kind: issue
status: resolved
github_issue: 180
github_state: closed
github_url: https://github.com/phodal/pero/issues/180
---

# Computational Notebook PoC B

## 2026-11-11 completion pass — ready for integration review

The expanded #180 scope now includes an implemented App-local Notebook Interop v0
description and fixed-revision deep link, plus the existing owner chain. The
canonical tracker stays here; the earlier PoC B conclusions below are historical.
No Paper production files or environment-runtime owner are changed.

Observed on base `5072cbc6`: authenticated Notebook tests (11) and typecheck pass.
The real Host/Chromium scenario with an original Åström/Murray PID chapter passed
in 35.8 s: Paper citation → saved Notebook → PI experiment → PASS at 8 s / FAIL at
2 s → original Finding preserved → Host Project reference retained after restart.
The fixed revision deep link reopened the original evidence in the actual App.
The PDF motivates an authored analytic check; this is not book reproduction or
scientific acceptance. Offline CI uses the existing synthetic Paper PDF fixture.
Trusted-shell confirmations are test-driven; this pass does not establish Native
or packaged Electron acceptance. Candidate service probes, [uniform cards](../fitness/notebook-runtime-cards.md)
and [ADR-0033](../adr/0033-notebook-interop-and-computation.md) now record the final
selection. The coordinating maintainer owns remote checks/publication/closure;
the local tracker remains active until that integration audit finishes.

### Original seven-item acceptance matrix

| #180 item | Evidence and result |
| --- | --- |
| P0 versions, maintenance, code licenses/NOTICE/SBOM/security/cards | Four uniform cards. Pinned official source files and license hashes; npm/Python inventories and source Cargo-lock SBOM; PyPI/OSV observations retained. nbconvert 7.17.0 advisory findings fixed to 7.17.1 and rerun. nteract source-lock matches explicitly prevent default adoption; no binary safety clearance claimed. |
| Lab Notebook independent App and persistence | Existing mature Notebook reused, not rebuilt. Real Entry revisions, App install/backend, immutable references and Host restart exercised. Existing ADR-0032/Notebook verification remain authoritative for broader editor coverage. |
| Same-input marimo / JupyterLab+AI / nteract and computation choice | All execute the same CSV to equal result hash. Actual marimo editor and Lab/Chat UI, Lab native kernel/MCP discovery and nteract native tool lifecycle exercised. Native Agent model/GUI embedding/collaboration limits explicit. Choose Jupyter modules at a concrete seam; retain current Science Kernel owner. |
| Notebook Interop v0 | Authenticated App-local describe-notebook, pinned resource revision vs document SHA, declared supported formats/actions, owner evidence refs, read-only historical URI. No Host protocol expansion. |
| Cross-App scenario with success/failure/old evidence | Actual original PDF citation → Notebook → Control PI 8 s PASS/2 s FAIL → unchanged Finding → persisted Project link. Owner source/trial and old revision reopen after Host restart. Offline fixture version also passes. |
| Regular CI under target budget; slow lanes separate | Existing normal CI caller retained; Canvas test step capped at 10 minutes. Both local tests 33.6 s, independently replayed by coordinator 29.7 s. Full dependency/build job cap is 20 minutes; remote execution remains integration-owned. Upstream downloads/services/OS/model probes are opt-in. |
| Final ADR recommendation/rejections/risks/measurements/migration/phases | ADR-0033 and cards: existing Lab Notebook + file/kernel reuse; no default additional daemon/Agent, no stored-data migration. Current #180 integration and conditional future adoption issue/PR phases are explicit, without adding speculative adapters or changing #163. |

### Security and verification observations

The original combined research environment used nbconvert 7.17.0. Its version
record matched three CVE groups (five alias-bearing entries). The experimental
input/lock now pins 7.17.1; the original comparison and actual Lab probe were
rerun. Final 68-package comparison, 158-package Lab+AI and 60-package nteract
Python inventories returned no PyPI matches. This does not establish complete
security clearance. The nteract source lock contains 1,116 packages: all 1,072
registry versions were queried and 55 matched versions/101 advisory IDs retained.
Aliases/maintenance advisories and uncompiled dependencies are included; these
are not 101 proven binary vulnerabilities. Default nteract distribution is rejected
pending any future binary-specific triage, rather than silently marking it safe.

The screenshot review found an early old-revision capture still displaying Canvas
loading. The scenario now waits for the historical 8 s / 1001-sample projection,
asserts no alert/loading, reopens the old owner trial after restart and checks its
report before the final capture. No production state machine was changed for this.
The enhanced original-source run passed in 46.7 s; final screenshots under
`test-results/notebook-interop/original-source-crossflow-final/` were inspected.

## What and why

Issue #180 proposes multiple notebook types but has no same-input runtime
experiment. Existing Notebook already owns editing, revisions and frozen owner
references; its code block explicitly has no execution authority. Science Kernel
already owns session-bound persistent Python/R, cancellation and fresh-process
recovery. Rebuilding either owner would hide the actual integration tradeoff.

Based on `561e2850157f3a0b406289dba9488206188451ab`, evaluate marimo 0.25.2 and
Jupyter nbclient 0.11.0 on one authored CSV-to-table task, with pinned environment,
saved output, reopening, relocation, cancellation and recovery. Fix nteract and
JupyterLab source versions and licenses, without installing a second daemon,
ACP service or product editor. Work stays in `experiments/notebook-runtime`.

## Acceptance boundary

The fixture is synthetic and deterministic. Runtime execution and equality do
not establish scientific acceptance, Pero UI integration, general notebook import
safety, collaboration, cross-platform compatibility or signed-product delivery.
The existing PoC A editor/Control Lab work is not part of this change.

## 2026-11-11 PoC B result

The bounded local runtime experiment is complete; the broader issue remains
active. [Evaluation and evidence](../fitness/notebook-runtime-poc.md) records
fixed versions/licenses, same-input execution, persistence, format conversion,
changed-input provenance, actual cancellation/recovery and offline exports.
[Rerun instructions](../../experiments/notebook-runtime/README.md) use an isolated
environment and existing Science Kernel directly.

Jupyter and marimo both reproduce the authored values. Jupyter interrupts retain
partial state; Science Kernel cancellation restarts fresh. marimo CLI requires a
forced kill after its 10-second SIGINT deadline in this fixture, and its default
HTML export does not render offline without CDN assets. Preserve these limits.

Recommendation: reuse existing Notebook revision/ipynb ownership and Science
Kernel; evaluate Jupyter modules for concrete interoperability needs. marimo
remains a separately managed reactive runtime candidate; nteract was not run.
No new daemon, ACP flow, Host owner, runtime protocol or product UI was added.
Next: review the proposed Computation Snapshot handoff and choose one explicit
Host-authorized integration scenario; broader #180 acceptance is still open.


## Coordinating acceptance — 2026-11-11

The coordinating chat independently ran real Jupyter and marimo probes and inspected the historical Canvas screenshots. Final merged Host/Chromium Canvas and Paper-to-Control workflows both passed (2/2, 27.71 seconds), including old revisions. The three candidate evaluations and ADR complete the original research scope.

Code is merged through `735f3696`; [integration CI](https://github.com/phodal/pero/actions/runs/43019965818) records the merged source.
