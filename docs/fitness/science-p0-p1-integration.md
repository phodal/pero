---
kind: verification_report
date: 2026-11-13
---

# Scientific workflow integration

Six independently implemented changes are combined on
`codex/science-p0-p1-integration`, based on `master` at `60c800888`.
The original workspace and the six source checkouts are retained separately.
This report records the combined source checks and development journeys; the
individual reports retain their narrower implementation and acceptance scope.

## Included changes

| Concern | Source head | Detailed evidence |
| --- | --- | --- |
| Shared Agent/user computation | `128b65ce9` | [Shared science sessions](shared-science-session.md) |
| Artifact execution provenance | `47502180d` | [Artifact provenance](artifact-provenance.md) |
| Bounded independent Reviewer | `76f4cdc13` | [Scientific Reviewer](scientific-reviewer.md) |
| Remote scientific execution | `8aa73f2c3` | [Remote compute](remote-compute.md) |
| Virtual Cell CPU task packages | `70c487023` | [Domain workflows](domain-workflows.md) |
| Figure and manuscript builds | `a1a43ee29` | [Notebook publication](notebook-publication.md) |

The merge preserves both ACP computation and Reviewer options, all six quality
record links, the current workspace navigation/list/section components, remote
execution ownership and scoped model deployment configuration. Original
implementation commits remain in history.

## Integration corrections

- Reviewer snapshots now consume `science/cell` events as bounded evidence.
  The latest receipt per language and cell ID retains its origin, generation,
  status, code and output. Interrupted, unknown and running outcomes stay
  explicit. A table-driven regression exercises the actual review/report path
  and verifies the existing evidence and byte budgets.
- Host-launched Notebook backends retain the trusted
  `PERO_NOTEBOOK_TEX_CACHE` setting. The existing isolated process test now checks
  that Notebook, Virtual Cell and an unrelated App receive only their own
  deployment settings. This closes a gap in the original publication browser
  test, which started Python directly.

## Combined verification

Environment: macOS arm64, Node 26.8.1, repository-pinned dependencies,
Homebrew Python for Harness/runtime probes, the existing `pero-default` and
`pero-python312` Python environments for Notebook/scientific dependencies.
App dependencies and workspace module links belong to the integration checkout.

| Check | Combined-source result |
| --- | --- |
| `npm run check` | Passed TypeScript, generated theme/design/tokens/contracts/icons and bilingual references |
| Go race tests | Passed `scienceenv`, `scientificreview`, `scientificreviewer`, `acp`, and `cmd/pero-agent-acp` |
| Go vet | Passed the same five packages |
| Rust contracts/runtime/Host | Passed library and integration tests, including shared ACP computation, artifact retention, remote owner tests and scoped backend configuration; explicit opt-in cases remain skipped |
| Viewer, Compute, Virtual Cell, Notebook | All typechecks and production builds passed |
| Viewer / Notebook Node | 35 Viewer, 317 Notebook core and 109 editor checks passed |
| Notebook Python | 149 cases completed with three existing opt-in/platform skips; real publication compilation enabled |
| Virtual Cell / Compute Python | 73 Virtual Cell cases and 12 Compute cases passed |
| Virtual Cell / environment SDK Node | Seven domain UI and 24 environment checks passed |
| Shared computation browser/Host/ACP | Passed real Python Agent 10 -> user 17 -> Agent 17, interruption, restart, isolation and missing-R recovery; 12 scripted loopback provider requests |
| Artifact Host and browser | Passed 13 runtime checks and six browser groups; frozen old-version Python replay matched the output digest, tampered source was refused |
| Domain task-package browser | Passed actual local CPU execution and independent arithmetic checks |
| Compute workspace browser | Nine passed; one real-SSH opt-in skipped in this combined run |
| Publication browser | Passed actual figure generation, two distinct offline Tectonic PDFs, historical preview and failed-build source/previous-PDF retention |
| Electron Reviewer | Passed real shell -> contradictory answer -> automatic/manual review -> correction context -> reasoned resolution -> retained Inspector artifact and restart; model responses are a bounded loopback fixture |
| Source hygiene | `git diff --check` passed; changed code/test files remain below 1,000 lines; no binary assets are committed |

The initial Harness run selected macOS system Python 3.9 and encountered the
existing literature sidecar's Python 3.10 syntax requirement. Selecting the
installed Homebrew Python passed the complete affected race suite. The initial
Desktop build lacked the independent Connectors package dependencies; installing
its pinned lock resolved preparation, and the build and Electron journey passed.
Existing unused-field and CJS `import.meta` build warnings remain.

Screenshots and machine receipts are ignored local outputs under
`test-results/shared-science`, `artifact-provenance`, `scientific-reviewer`,
`virtual-cell-task-package`, `compute` and `notebook-publication`.

## Acceptance boundaries

The combined run does not establish full Claude Science parity, scientific
acceptance, a signed release, Native rendering, real-model decisions, a real
Slurm site or Modal/GPU execution. The remote report separately records its
earlier actual loopback OpenSSH acceptance. R is unavailable on this machine;
the missing-interpreter and recovery path is tested.

Virtual Cell uses a versioned CPU additive baseline and synthetic task inputs;
it is not a learned biological model or external endpoint acceptance. Local
publication compilation currently requires macOS, installed Tectonic and an
existing TeX cache. Linux/Windows retain export and explicit unavailable states.

Shared computation, domain execution and publication retain their existing
owners. They do not automatically register all results in shared Task/Run or
Project storage. Shared-kernel output files are not yet automatically emitted
as provenance sidecars: explicit artifact delivery and the external-run wrapper
retain their existing boundaries. Reviewer consumption of cell receipts closes
the observed evidence gap without claiming automatic review of every saved
reproduction bundle or independent scientific recomputation.
