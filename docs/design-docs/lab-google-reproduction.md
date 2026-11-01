# Lab: Google primary-source comparison and reproducibility boundary

Kind: analysis / reproduction specification  
Issue: #69 · PR: #74 · Reviewed: 2026-11-01  
Scope: software-only; no instrument discovery, hardware dispatch, biological design,
paid model calls, or execution of downloaded research code.

## Conclusion first

**Pero Lab is not a reproduction of Google's wet-lab results.** Its existing
Color Mixing loop is an engineering demonstration using a deliberately synthetic
observation. The defensible additions are (1) a locally constructed stateful
constraint benchmark inspired by VERID and (2) an independent implementation of
VERID's published mathematical scoring rule. Neither establishes physical safety,
agent scientific competence, or the paper's experimental improvement.

## 1. Primary sources and what was actually read

The [Google Research blog](https://research.google/blog/grounding-ai-agents-in-biological-reality-building-blocks-for-autonomous-wet-labs/)
is an index, not the experimental evidence. Its three direct PDF links were
opened and downloaded; local text extraction was used to read methods and
limitations. No third-party paper review is used as evidence here.

| Source | Verified identity / reading extent | Access and reproducibility status |
| --- | --- | --- |
| [VERID PDF](https://www.gstatic.com/science-ai/verid_semantic_lab.pdf), [arXiv v1](https://arxiv.org/abs/2610.32755v1) | *Semantic Representation for Agentic Self-Play in Automated Laboratories*. Yves Delley, John Coller, Zachary Cutts, Alexander Daryin, Mathias Bellaiche, Jun W. Kim, Oscar Donosa, Srinidhi B. Seshadri, Tanner Clary, Sandy Klemm, Avinatan Hassidim, Yossi Matias, Pooja Rao, Petar Sirkovic, Annalisa Pawlosky. [DOI](https://doi.org/10.48550/arXiv.2610.32755). Read main text §§1–6, figures/captions 1–4, methods/scoring pp12–13, and scanned references pp14–16. | 16 pages. Google PDF dated 2026-10-22; arXiv submitted 2026-10-23. Both downloads have identical SHA256 below. No separate supplement, controller repository, raw dossier archive, or dataset link was found in this PDF, the blog, or the arXiv landing page. This is a bounded search result, not proof that no release exists anywhere. |
| [Aptamer PDF](https://www.gstatic.com/science-ai/agentic_aptamer_sandbox.pdf), [arXiv v1](https://arxiv.org/abs/2610.24806v1) | *Aptamers as a sandbox for lab-in-the-loop agentic molecular discovery*, Zachary Cutts et al. [DOI](https://doi.org/10.48550/arXiv.2610.24806). Read Discussion pp10–12, Methods overview p13, statistical evaluation pp16–17, availability p18, Supplementary Table S3 and supplement inventory. Not a line-by-line reading of every biological design or sequence table. | Google PDF has 27 pages, dated 2026-10-12; arXiv v1 has 34 pages, submitted 2026-10-17. Do not mix page numbers: those here refer to Google PDF. Summary tables and selected observations are included; full sequence/activity and differential-enrichment tables are promised upon peer-reviewed publication, not verified as released. Listed third-party packages are not a release of the authors' complete harness. |
| [Epitope PDF](https://www.gstatic.com/science-ai/epitope_excision.pdf), [arXiv v1](https://arxiv.org/abs/2610.33195v1) | *Agent-guided epitope excision enables economical de novo binder design*, Jun W. Kim et al. [DOI](https://doi.org/10.48550/arXiv.2610.33195). Read Discussion pp10–12, Methods pp12–14, and arXiv supporting figure/table captions. No sequence generation or biological optimization attempted. | Google PDF: 18 pages; arXiv: 24 pages, including Supporting Information. Google PDF dated / arXiv submitted 2026-10-23. Supporting figures 1–5 and table 1 are accessible in arXiv PDF. No project-specific code/data release link found in the inspected PDFs. |
| [PyLabRobot upstream](https://github.com/PyLabRobot/pylabrobot), [volume tracker source](https://github.com/PyLabRobot/pylabrobot/blob/main/pylabrobot/resources/volume_tracker.py) | Read repository landing page and current volume tracker / Chatterbox compatibility source, read-only. VERID cites the [2023 PyLabRobot paper](https://doi.org/10.1016/j.device.2023.100111). | Open-source upstream is a dependency, **not VERID source code**. Upstream `main` is not a version pin; Pero uses `pylabrobot==0.2.2` and its actual installed Chatterbox adapter. No newly downloaded upstream software was executed for this review. |

The arXiv HTML endpoint for VERID returned 404; the official PDFs were accessible,
so this did not block full-text review. The PyLabRobot documentation homepage
returned no readable text in the web tool; upstream source was inspected instead.

### Download fingerprints

Public PDFs were downloaded to `/tmp` for inspection, not committed as binaries.
Hashes freeze the versions actually read; a later upstream revision needs a new
review rather than silently replacing these sources.

| PDF | SHA256 |
| --- | --- |
| VERID Google and arXiv v1 (byte-identical) | `b047f7609e237ca371e42fac76fe77e454cdf6bba5436388499a28ccb3f7783c` |
| Aptamer Google | `0c961363ac30432d895a43b9aa5606e1c23e524882b0d61261c5fb4666bdebf7` |
| Aptamer arXiv v1 | `99d479676743f7616a3f196bc58023bdccdab54590b20f3466a21274fe438660` |
| Epitope Google | `8cfa7e250e172b322554a19d912b33dbc2bb0617834de34718829e61cc85acd7` |
| Epitope arXiv v1 | `a0f9a2ddfb16afd665e50d36d27da4017489abebc24d04132a556164a223c497` |

## 2. VERID evidence versus this implementation

All page references below are printed, one-based pages of the frozen VERID PDF.
The paper's simulator is a discrete accounting system, not a predictor of every
fluidic or optical phenomenon (§2.2 pp3–4; §4.3 pp10–11).

| Paper method / evidence | Pero source evidence | Comparison verdict |
| --- | --- | --- |
| Persistent queryable workcell tree; clone current state before simulation (§2 pp3–4). | `apps/lab/backend/domain.py`: immutable `LabState`, `apply_operation`, `validate_protocol`; `experiments.py`: snapshots. | Structural subset: 96 wells, one pipette, tip inventory. No complete 3D workcell, lids, multiple instruments, or bidirectional physical twin. |
| Resource, volumetric and geometric checks; dispatch revalidation (§2.2–2.4 pp3–5; §6.2 pp12–13). | `parse_protocol`, `validate_protocol_envelope`, `validate_protocol`; `ExperimentStore.run` validates before Chatterbox. | Modeled resource checks only. No trajectory collision or chemical-compatibility assurance. Revision checks refer to software snapshots, not measured live hardware. |
| Geometry rejection example: span 72.0 mm exceeds 71.2 mm trough (§3.2 p6). | Single-channel adapter has no equivalent multi-channel geometry rule. | **Not reproduced.** The numeric inequality alone would not reproduce robot collision checking. |
| Synchronized video, instrument readouts and state traces (§2.3 p4). | `ExperimentStore.run`: before/after states, timestamps, PLR receipts; `observations.py`: original bytes and SHA256. | Auditable software provenance, not synchronized physical multimodal observations. Imported data remain user supplied. |
| Human-assisted fluidic diagnosis and reader recovery (§3.1 pp5–6). | `ExperimentStore` preserves unknown outcomes and does not replay failed execution. | No reader, physical diagnosis, or fault recovery experiment. Safe non-replay is a different property, not successful resumption. |
| Blinded four-target composition task; RGB-only solver, separate plate-reader oracle (§3.3 pp7–9). | Single-target red-fraction task; `ExperimentStore.observe` explicitly adds synthetic `+0.1`. | Different task, observations and ground truth. The observation generator is not an independent physical oracle. |
| Published score: composition KL plus total-concentration loss (§6.3 p13). | Existing `evaluation.py` uses absolute fraction error and volume tolerance. | Different metric. A separate `paper_scoring.py` module reproduces the equation, never relabel the existing score as mnats. |
| Case-study agent: internal preview Gemini 4 Argon (§6.2 p13). | Current Host/ACP integration evidence uses scripted candidates. | Wiring evidence only; not the same agent, reasoning, harness, or self-play experiment. |
| Physical multi-cycle lineage ends at 307 then 58 mnats (§3.3 pp8–9). | Synthetic 50/50→0.6 FAIL; revised 40/60→0.5 PASS. | **Not comparable numerically.** Neither the >5× improvement nor its cause has been reproduced. |

### Other papers: what transfers, and what does not

The aptamer paper explicitly distinguishes the agents' between-round analysis
from authors' standardized retrospective evaluation (Methods pp16–17). Its
Discussion p12 says this was not a controlled agent-architecture comparison and
calls for matched-budget no-feedback/non-reasoning controls. This supports keeping
candidate generation separate from evaluation; it does not validate our synthetic
observation. Full empirical reproduction is outside scope and lacks the complete
released dataset/harness verified above.

The epitope paper's Methods pp13–14 freezes the hit definition and uses measured
compute budgets, separating post-hoc diagnostics from decision metrics. Its
Discussion p12 limits the autonomy comparison's generality. Pero's frozen criteria
and trial budget are analogous engineering choices, not replications of molecular
hit rates, GPU savings, or binding measurements. No biological workflow from either
paper is implemented or proposed here.

## 3. Minimal software benchmark: resource-state ablation

**Name:** `lab-constructed-stateful-gate-v1`. This is our public, locally
constructed fixture suite, not an official Google benchmark or released dataset.
It probes the architectural distinction in VERID §§2.2 and 6.2.

### Freeze before execution

- Repository fixture version and SHA256 of canonical fixture JSON.
- `initial_state()`: 96 wells; A1/A2 each 200 µL, others empty; capacities
  300 µL; 96 unused tips; no mounted tip; revision 0.
- Same typed protocol, initial state and 64-step budget for both arms.
- Static arm: parse schema and check envelope only. This is specifically a
  **schema/envelope-only ablation**, not a claim about every static analyzer.
- Stateful arm: the same parsing/envelope followed by `validate_protocol`.
- Expected labels are human-authored invariants, not copied from the implementation's
  own verdict. One executable table owns fixtures; tests/report consume that table.
- No LLM, randomness, instrument, network, or PLR execution is necessary.

### Cases and expected evidence

At minimum include a valid transfer control, missing tip, empty source, sequential
source depletion, cumulative pipette capacity, destination overflow, consumed-tip
reuse, return of nonempty tip, over-dispense, and malformed-schema control.
Except the malformed control, the invalid cases must be individually schema-valid.
Sequential depletion must require examining previous steps, not just one quantity.
Consumed-tip reuse and empty-tip return are **Pero policies**, not asserted to be
VERID rules; keep this distinction in every report.

Report per-case expected/actual acceptance, rejection code and zero-based step,
plus confusion matrices with **invalid as positive**: TP = invalid rejected,
FN = invalid accepted, FP = valid rejected, TN = valid accepted. Separately report
schema-invalid controls so syntax rejection does not inflate semantic detection.
Check initial-state hashes are identical before/after every attempted validation.

**Failure criteria:** any mismatched stateful label/error location, changed input
state, valid control rejection, fixture digest drift, or baseline mismatch is a
benchmark failure. All cases passing establishes only these enumerated invariants;
there is no statistical population, confidence interval, or physical safety claim.

The paper gives qualitative examples, not an expected accuracy for our fixture
suite. Thus our expected TP/FN counts are a frozen engineering expectation,
not a paper-reported target. Actual results must be attached only after execution.

## 4. Exact public component: scoring-rule reproduction

VERID §6.3 p13, equations (1)–(5), is a fully specified software-only target.
The original PDF page was also rendered and visually checked to verify equation
layout, KL direction, clipping and the β²/8 coefficient, rather than relying only
on text extraction.
Implement it separately from Color Mixing's evaluator:

1. Input: four nonnegative dye fractions in stock equivalents; their sum is at
   most one. Water is one minus that sum.
2. Normalize dye shares; for zero total dye use four equal shares.
3. Smooth shares with ε = 0.03, raise to β = 0.5, then normalize again.
4. Composition loss is `KL(true_tempered || predicted_tempered)`, natural logs.
5. Clip each water fraction to `[1e-4, 1 - 1e-4]`. Concentration loss is
   `0.03125 * (logit(predicted_water) - logit(true_water))**2`.
6. Target loss is the sum in nats; a run is the mean of **four** targets,
   multiplied by 1000 for mnats.

Use artificial, clearly labeled test vectors, not invented paper measurements.
Freeze independent numeric goldens before testing the production implementation.
Include identity (zero), composition swap (positive), unchanged shares with changed
total (zero composition term), zero-dye fallback, endpoint clipping, and four-target
aggregation. Reject malformed/nonfinite/negative/overfull fractions at the boundary.

**Failure criteria:** mismatch against independent goldens beyond a declared small
floating-point tolerance; reversed KL; log base other than e; smoothing after the
wrong normalization; missing concentration term; sum instead of mean; missing
1000 conversion; invalid input accepted. This reproduces a published mathematical
component, **not the 307→58 physical result**. Recovering that result requires the
actual per-target true/predicted fractions and instrument evidence, not merely
retyping rounded scores from the figure.

## 5. What may be claimed

| Claim | Status / evidence needed |
| --- | --- |
| Original VERID methods read, source/version identified | Completed above; not inferred from blog alone. |
| Existing engineering loop works with actual PLR Chatterbox | Existing app/test evidence; simulation only. |
| Enumerated state/resource invariants outperform schema-only on our fixtures | Executed: stateful rejects 8/8 resource-invalid fixtures; schema-only rejects 0/8. One valid control accepted by both. No general safety claim. |
| Published scoring formula reproduced | Executed: seven mathematical test methods pass, including directional KL and four-target aggregation. Constructed vectors only. |
| VERID source code reproduced | No; its controller source/release was not located in inspected primary sources. |
| Physical errors diagnosed or recovered | No real hardware or observations in this task. |
| Google agent performance or >5× result replicated | No same checkpoint/harness/raw data/physical workcell. |
| Biological discovery replicated | Out of scope; no biological candidates or experiments run. |

The VERID evidence is proof-of-principle case studies. Our reading found no
systematic invalid-protocol confusion matrix or matched static-vs-stateful ablation
in the paper. Our fixture study therefore fills a small local verification need;
it does not borrow Google's experimental credibility. Unknown real-world effects
remain unknown even when every software fixture passes.

## 6. Execution record

Reviewed and independently reran on 2026-11-01 in the same PR workspace:

```sh
python -m unittest discover -s apps/lab/test -p 'test_stateful_gate.py' -v
python -m unittest discover -s apps/lab/test -p 'test_paper_scoring.py' -v
python apps/lab/benchmarks/stateful_gate.py --output test-results/lab-paper/stateful-gate.json
python apps/lab/benchmarks/paper_score.py --output test-results/lab-paper/paper-score.json
```

The reviewer rerun used `/tmp/alfred-stateful-gate.json` and
`/tmp/alfred-paper-score.json` to avoid overwriting the lead's result artifacts.
Both test suites passed (2 stateful-gate and 7 scoring test methods). The scripts
only import the local functional core; no hardware adapter or model is invoked.

### Observed resource-state result

Fixture SHA256: `dc4f269d6edfc4fe393cc8ff2325793fd31b4b92f39ce7418ea242719b695555`.

| Arm | TP | FN | TN | FP |
| --- | ---: | ---: | ---: | ---: |
| Schema/envelope only | 0 | 8 | 1 | 0 |
| Same checks plus stateful fold | 8 | 0 | 1 | 0 |

The denominator is nine schema-valid resource cases, not ten. The tenth malformed
quantity control was rejected by both arms and excluded from these counts.
All initial-state immutability and JSON snapshot round-trip comparisons passed.
The latter is serialization equivalence, **not hardware fault recovery**.

### Observed scoring result

Four artificial vectors, in dye order red/green/blue/yellow:

| Case | True → predicted fractions | Independent expected nats | Observed nats |
| --- | --- | ---: | ---: |
| Identity | `(0,0,0,0)` → same | 0 | 0 |
| Concentration only | `(.125,.125,.125,.125)` → `(.0625,.0625,.0625,.0625)` | 0.0377171550253931868 | 0.03771715502539319 |
| Composition only | `(.5,0,0,0)` → `(0,.5,0,0)` | 0.9697896983512550462 | 0.9697896983512548 |
| Clipped endpoints | `(0,0,0,0)` → `(.25,.25,.25,.25)` | 10.6035659521839285771 | 10.603565952184056 |

Four-target mean: expected **2902.7682013901442 mnats**, observed
**2902.7682013901763 mnats**. The approximately `3.2e-11` mnat difference is
floating-point rounding; the aggregation test asserts nine decimal places.
Individual analytic checks use 11–15 decimal places as documented in
`apps/lab/test/test_paper_scoring.py`. These are precomputed reduced-expression
Decimal goldens, not outputs obtained by calling production scoring helpers.

Scoring fixture SHA256:
`ec9cdfc8203665fa5f3947f40f6bc4f97498dfd51351e0487a1f05d472cd0232`.

**Interpretation:** the resource gate and published equation checks passed on the
specified constructed inputs. This is not an observed physical assay, Google
benchmark score, learned agent improvement, or empirical reproduction of VERID.
