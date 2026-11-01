# Paper-Code Audit skill: cross-case forward checks

Date: 2026-11-01. Scope: the generic skill and reference split in PR #82,
following the initial PC-Gym increment at `720a3506`.

A subsequent authorized [real PC-Gym smoke](paper-pcgym-smoke.md) exercised reference
reading, actual scientific execution, optimizer updates and offline recomputation.
The three forward cases below retain their original source/synthetic-check scope.

## Change and evaluation method

The former PC-Gym skill conflated a reusable audit with one fixed adapter.
`paper-code-audit/SKILL.md` now owns claim/metric/source comparison, scoped
computation and separate judgments. Its contract reference is a record convention,
not a newly implemented generic API. PC-Gym commands and unresolved verdict live
in `references/pcgym-table6.md`; other worked checks have their own reference.

Three independent agents received only the revised skill, a realistic request,
primary-source URLs, fixed source bytes and (where needed) synthetic observations.
They did not receive expected answers or the prior PC-Gym conclusions. Each worked
in its own temporary directory, could read public primary sources and write local
reports/checkers, and could not install dependencies, execute upstream code,
download models, train, modify the repository or publish. Their reports and
generated checkers were inspected and rerun by the parent agent.

## Actual checks

| Case / request | Observed outcome | Evidence boundary |
| --- | --- | --- |
| LoRA v2 §4.1; count trainable and saved elements at r=2 and r=0 | Direct construction: 40/136 and 96/96; adapter-only saving 40/0. Agent also identified global-freeze and initialization distinctions. | Source/AST inspection, exact integer count and synthetic matrix algebra; no torch/autograd/serialization or downstream benchmark |
| ResNet v1 / later PyTorch ImageNet example; audit top-1/top-5 and unequal batch reduction | Toy accuracy/error 25%/75% and 75%/25%; correct [3,1] weighting. Identified third-party implementation and ensemble test-set comparison boundary. | Primitive synthetic predictions independently recomputed; no ImageNet/model run or validation of the paper's 3.57% |
| Existing classification report, no paper supplied; audit “macro F1=0.8” against saved micro call | Exact macro=8/27, micro=4/5, weighted=32/45. Narrow report error confirmed without fabricating paper provenance. | Source review plus standard-library confusion counts; not execution of scikit-learn or a new benchmark |

No case was forced through PC-Gym's command line, scientific environment, metric
grain or mandatory INCONCLUSIVE result. The supported narrow findings and the
unperformed benchmark reproductions were recorded separately.

## Source identities and an observed correction

- LoRA `c4593f060e6a368d7bb5af5273b8e42810cdef90`, `loralib/layers.py`:
  SHA-256 `ea9fa6bd0930dfbf5af08440f6c71aeab3408cf07d3cca7620c86c45ea730797`.
- PyTorch examples `acc295dc7b90714f1bf47f06004fc19a7fe235c4`, `imagenet/main.py`:
  SHA-256 `f67ca2cd730bf91afe0504694abf07b88cbd03ac8c8a0426023620d29175c158`.
- scikit-learn tag 1.7.2: annotated tag object `b8c435b6c580cf10685ff012d3d1e7b786d5f244`
  resolves to commit `25dee604bae18205b01548348388baf7a1cdfe0e`;
  `_classification.py` SHA-256 `6fe88badb690ddf370f8c560a9286f60544ac50862576b33fa47576ab58d9e14`.

The F1 evaluator independently noticed the initial supplied tag-object blob URL
returned 404. A follow-up resolved the annotated tag through GitHub's Git API and
confirmed the real commit file matched the supplied bytes. The initial provenance
gap was preserved rather than described as a first-pass success. The contract now
explicitly distinguishes a tag-object ID from a source commit ID.

The source links, complete toy inputs and small executable arithmetic checks are
maintained in [other cases](../../apps/paper-agent/skills/paper-code-audit/references/other-cases.md).
The full temporary evaluation artifacts were written under
`/private/tmp/pero-paper-audit-forward/{lora,imagenet,f1}`; they are not packaged
or a dependency for using the skill. No third-party full source is redistributed.

## Validation and remaining limits

`skill-creator/scripts/quick_validate.py` passed for the new skill. Its three
reference links resolve, and the worked snippets and generated independent
checkers ran successfully. The original 28 PC-Gym tests still pass.

This is a small behavioral forward check across three quantities, not a measured
success rate for arbitrary papers, a real-model Host acceptance test, protected
checker attestation or scientific replication. The headless skill catalog still
loads only SKILL.md; references require a separately authorized file reader.
No new generic executor, Paper UI, Desktop picker or automatic reference-loading
capability was added.
