---
kind: verification_report
status: complete
github_issue: 180
github_state: open
github_url: https://github.com/phodal/pero/issues/180
---

# Computational Notebook PoC B — 2026-11-11

The bounded experiment is complete. Prefer **existing Science Kernel execution
plus the existing Notebook `.ipynb` document owner** for the next Pero integration
step. Jupyter's execution/serialization modules are useful interoperability
candidates. Keep marimo as an optional independent reactive-notebook experiment;
its default CLI cancellation and offline HTML export need further work before a
Host-managed integration. nteract remains architecture reference only.

This is an engineering selection recommendation, not an accepted integration ADR
or closure of [#180](https://github.com/phodal/pero/issues/180). No product editor,
Host permission system, ACP session, Task/Run state machine or daemon was added.

## Pinned candidates and distribution scope

Fixed on 2026-11-11; these are the inspected versions, not a claim that they will
remain latest. License links point to the inspected tag. Root listings contained
LICENSE and no root NOTICE for marimo, JupyterLab and nteract; this does not clear
third-party files, dependencies, extensions or a future packaged distribution.

| Candidate | Fixed source | License | Actually exercised / classification |
| --- | --- | --- | --- |
| marimo | `0.25.2`, `b0e402345e0a0c0731e745c8e1183ef0840804b2`; release 2026-10-19 | [Apache-2.0](https://github.com/marimo-team/marimo/blob/0.25.2/LICENSE) | Python CLI execution/export and format conversion; reusable standalone runtime candidate, not accepted for embedding |
| JupyterLab | `v4.6.6`, `8d57791d0254820dfa4a540e010105803e128bcd`; release 2026-11-06 | [BSD-3-Clause](https://github.com/jupyterlab/jupyterlab/blob/v4.6.6/LICENSE) | Source/version review only; Lab UI, Server and AI were not installed |
| Jupyter execution modules | nbclient `0.11.0`, `0811ff44c63c9853c4d6ba7265d7042ca7f8742a`; release 2026-06-05; ipykernel `7.1.0`, nbformat `5.10.4`, nbconvert `7.17.0`, jupyter-client `8.10.0` | [nbclient BSD-3-Clause](https://github.com/jupyter/nbclient/blob/v0.11.0/LICENSE); installed package license metadata in environment receipt | Real local kernel, execution, persistence/export, interrupt/restart/shutdown; reusable modules |
| nteract | `v2.9.0-stable.202610230557`, `9c85319021bdcd4b03bdfe010ccb4bbc4dc8ed57`; release 2026-10-23 | [BSD-3-Clause](https://github.com/nteract/nteract/blob/v2.9.0-stable.202610230557/LICENSE) | Source review only; architecture reference, no deployment or runtime acceptance |

The [pinned nteract README](https://github.com/nteract/nteract/blob/v2.9.0-stable.202610230557/README.md)
describes Tauri/React, an Automerge document and `runtimed` owning kernel/process,
queue and output writes. Its default installer installs a per-user service.
Inference for Pero: that ownership would need an explicit Host composition seam;
Rust/Tauri similarity does not demonstrate an embeddable component. No installer,
daemon, nteract MCP or competing Agent permission flow was run here.

The two executed candidates used one isolated, combined Python environment:
68 resolved packages, Python 3.12.11, macOS 27.2 arm64, approximately 240 MiB on
disk (`du -sh`). This is neither each candidate's incremental package cost nor a
signed application size. [requirements.lock](../../experiments/notebook-runtime/requirements.lock)
pins versions; `environment.json` records installed metadata and digests. Complete
SBOM/CVE review, memory profiling and code-level distribution clearance remain
unperformed. No vendored upstream source or binary is committed.

## Same-input observations

Baseline: `561e2850157f3a0b406289dba9488206188451ab`. Scripts and exact rerun commands
are in [experiments/notebook-runtime](../../experiments/notebook-runtime/README.md).
Six authored CSV rows become exact Fraction group means, a JSON result and an
HTML table. Expected control/treatment means are **2/4 mg/L**, each `n=3`.
There is no statistical inference or scientific acceptance claim.

Frozen CSV SHA-256: `f5ff05b7c89bce0999aa8e75dee83cb589ba804b7927ac70a7721d0f716880b5`.
Equal result JSON SHA-256: `2d9047bf8dcd664e94816f9f04a758eef2c2ce6df4e5f5aec1cbfc062f386006`.

| Check | marimo 0.25.2 | Jupyter modules | Existing Science Kernel |
| --- | --- | --- | --- |
| Same CSV → calculation → result/table | Equal to authored expectation | Equal to authored expectation | Equal to authored expectation |
| Save and reopen | Native `.py` rerun in a new CLI process; source hash unchanged | nbformat save/read/validate preserves cells+outputs, plus fresh kernel rerun | Result files retained; no notebook serialization claim |
| Relocation | Source+CSV copied into empty directory, regenerated equal output | Same | Not separately tested |
| Changed input | `c1=4` gives control mean 3; original directory/receipt unchanged | Same | Not separately tested |
| Format interchange | `.py` → `.ipynb` executes in nbclient | Executed `.ipynb` → `.py` executes in marimo | Shared raw Python cell bodies execute; no IPython magic/widget compatibility claim |
| Authored exception | Real `ValueError`, nonzero CLI status; old result retained; clean rerun succeeds | Real `ValueError`, nonzero status; old result retained; clean rerun succeeds | Exception scenario not separately tested in this probe |
| Cancel / state | Observed running cell; SIGINT did not exit within 10 s; process group SIGKILL required | Observed stream; interrupt raises KeyboardInterrupt and retains `sentinel=42` | Observed file marker; context cancellation terminates process |
| Recovery | New CLI process recomputes expected result | Restart drops sentinel; shutdown confirmed | Next Exec starts fresh, sentinel absent; recomputation matches old output |
| Offline saved view | Default HTML blank when CDN requests blocked; standalone `table.html` visible | nbconvert table visible with all external requests blocked | Standalone table produced; no product renderer tested |

Fresh executions clear task output files before checking results, including both
conversion paths, so previous successful files cannot masquerade as a new run.
The error scenario verifies the retained prior digest before clearing it for
recovery. No output is promoted to accepted Evidence by the experiment.

The browser check additionally feeds both generated executed `.ipynb` files into
Pero's **existing** `parseIpynb` / `ipynbExportFormats` / `editIpynbCell`: exact
source round-trip passes; a code edit keeps recorded output and marks it stale.
HTML MIME bundles remain retained with a not-rendered diagnostic under the
existing bounded preview policy. This is package-level interoperability evidence,
not a Notebook App UI or Host-authorized execution acceptance.

### Timings from the final local run

| Operation | Observed seconds | Measurement boundary |
| --- | ---: | --- |
| marimo first / reopen export | 0.848 / 0.752 | Entire Python CLI process, computation and HTML export |
| Jupyter first / reopen | 1.249 / 1.180 | Entire helper process, kernel, save, reopen and HTML export |
| Jupyter ready / interrupt-to-idle / restart-ready | 0.583 / 0.026 / 2.296 | KernelManager lifecycle probe |
| marimo cell-ready / cancellation exit | 0.623 / 10.005 | CLI process start; exit includes 10 s SIGINT deadline and SIGKILL |
| Science Kernel ready / three cells | 0.017 / 0.004 | Start+first Exec / three existing Exec calls, excluding Go compilation |
| Science Kernel cancel / fresh-state recovery | 0.00057 / 0.018 | Exec cancellation return / next Exec in fresh process |

One tiny task, one final run, warm machine caches, different workloads and process
boundaries: these numbers establish functioning paths, **not a speed ranking**.
No runtime memory, UI startup or interactive editing latency was measured.

### Portability and offline limits

Both native formats and both derived conversions compute the same fixture after
relocation. That establishes portability of this linear Python example, not
lossless conversion of arbitrary notebooks. marimo topologically orders exported
cells; native `.py` does not retain Jupyter's recorded output bundles as its source
of truth. Preserve originals for recovery; do not substitute a converted document
for an immutable source revision. Widgets, magics, hidden state, async cells,
attachments and domain-specific kernels were not tested.

The saved marimo HTML requested 184 external asset URLs when opened offline and
showed a blank page. Jupyter HTML requested two blocked external resources but
still showed the complete authored table. Both plain `table.html` artifacts had
zero external requests and displayed the table. No attempt was made to rewrite
upstream exports or add a frontend asset server. Export behavior follows the
installed CLI; see also [marimo export documentation](https://docs.marimo.io/guides/exporting/).

## Minimal proposed handoff to existing owners

Name the concept **Computation Snapshot**: an immutable association of frozen
inputs, method/environment, one execution attempt and its output artifacts.
This section is a proposed integration contract, not a new generic JSON schema,
runtime API or implemented Task/Run adapter. The local `Snapshot` dataclass only
records the subset observed in this experiment.

| Information | Existing owner / minimal handoff |
| --- | --- |
| Notebook identity | Notebook `Entry` ID + integer revision + block ID; preserve original `.ipynb` / `.py` source digest as an attachment, not editor-owned execution state |
| Inputs and method | Frozen dataset artifact/version+digest and code/source digest; observed Project catalog fingerprint alone is insufficient |
| Environment | Existing environment binding plus resolved dependency lock and interpreter identity; metadata observation does not prove scientific validity |
| Execution | Existing Host-authorized session/workspace and Science Kernel; reference existing Task/Run attempt when actually attached, never mint a competing queue/status machine |
| Outputs | Existing artifact reference plus digest/media type; kernel stdout is not by itself a durable evidence registry |
| Verification | Separate verifier identity/version/result and human acceptance reference; missing review remains missing, never inferred from exit code 0 |
| Revision and stale state | Input/code edits create another snapshot/attempt. Old Finding references keep old digests; the existing document owner marks recorded output stale |

Current ownership evidence: [Notebook revisions](../../apps/notebook/backend/store.py),
[inert code blocks](../../apps/notebook/ui-src/code-block.tsx),
[ipynb import/edit/export](../../packages/notebook/src/ipynb.ts),
[bounded recorded-output rendering](../../packages/notebook/src/ipynb-render.ts),
[Science Kernel](../../harness/go/scienceenv/kernel.go) and its
[session binding](../../harness/go/scienceenv/tools.go), plus
[ADR-0032](../adr/0032-ai4s-notebook-block-editor.md).

The next bounded implementation can attach a frozen computation output through
those owners. Introduce a Jupyter-kernel seam only for a concrete requirement
such as a second language kernel or supported notebook semantics; `nbclient`
success here does not justify installing Lab/Server/AI. A reactive marimo App can
remain independent if its Host-managed lifecycle, offline assets and permission
boundary are separately accepted. Do not copy either upstream state machine into
Notebook, and do not treat a virtual environment as a sandbox.

## Evidence ledger and remaining acceptance

Local evidence root (gitignored):
`/Users/phodal/workspaces/pero-issue-180/test-results/notebook-runtime/`.

- `final.log`, `final/commands.json`, per-command stdout/stderr: completed checks,
  including expected exception exits and the negative graceful-interrupt result.
- `final/environment.json`, `final/snapshots.json`, native and converted source,
  receipts and outputs: reproducible input/method/environment/result observations.
- `science-final.json`, `science-final.stderr.log`, `science/`: existing owner
  timing, fresh state and equal recomputation. Python check decoded `Output` and
  compared it with the same authored expectation.
- `science-race.json`, `science-race.stderr.log`: the same probe also completed
  with `go run -race`; no race diagnostic. No production Go module changed.
- `final/browser.json`, `final/pero-import.json`, `browser-final.log`: offline
  Chromium and existing parser/round-trip/stale checks.
- `final/jupyter-offline.png`, `final/marimo-offline.png`,
  `final/marimo-table-offline.png`, `final/jupyter-table-offline.png`: actual saved
  exports. Jupyter table, blank marimo export and standalone table were visually
  inspected. These are not product screenshots.
- `run-1.log` retains an early harness output-directory collision. `run-2.log`
  retains the initial SIGINT timeout; its malformed exception fixture was fixed
  to raise a real ValueError. `run-3` and `final` use fresh-output checks and the
  corrected exception fixture. Failed trials were not deleted.

Canonical active tracker: [Computational Notebook PoC](../issues/2026-11-11-computational-notebook-poc.md).
This pass does not establish interactive marimo/JupyterLab/nteract deployment,
cross-origin embedding, Host permission enforcement, Agent parallel editing,
Notebook App/Electron/Native UI acceptance, Linux/Windows behavior, signed
packaging, complete license/security review or scientific acceptance. #180 stays
open for those decisions and the larger cross-App lifecycle scope.
