# Worked checks beyond PC-Gym

These cases illustrate different quantities and evidence boundaries. The small
inputs are self-authored, not measurements from the papers. Python snippets below
use only the standard library and recompute the stated arithmetic; they do not
execute the cited libraries. Source correspondence was separately inspected at
the pinned revisions. Read only the relevant case.

## LoRA: parameter scope and a disabled adapter

[LoRA v2 §4.1](https://arxiv.org/html/2106.09685v2#S4.SS1) parameterizes an update
using B of shape d×r and A of shape r×k. For an active adapter the trainable
adapter count is r(d+k), not the dense layer count dk or the full saved state.

The author's [Linear implementation](https://github.com/microsoft/LoRA/blob/c4593f060e6a368d7bb5af5273b8e42810cdef90/loralib/layers.py#L90-L153)
creates A/B and freezes the base weight inside `r > 0`. For direct construction
with d=8, k=12, bias=False, r=2: adapter-trainable=40, full-state elements=136.
With r=0 the adapter is absent and the base layer remains trainable: 96, not 0.
These are source-derived counts under the normal nn.Linear defaults, not an
executed PyTorch state_dict or autograd observation.

The author's [saving/freezing utilities](https://github.com/microsoft/LoRA/blob/c4593f060e6a368d7bb5af5273b8e42810cdef90/loralib/utils.py#L13-L48)
change the question: adapter-only saved elements are 40/0; applying the global
freeze utility can change r=0 trainability to zero. Ask which scope the claim
means. The initialization code also uses Kaiming-uniform A rather than the
paper's Gaussian A; zero B still implies an initial zero update. Matching counts
does not establish identical initialization or downstream performance.

```python
d, k = 8, 12
counts = []
for r in (2, 0):
    adapter = r * (d + k)
    trainable = adapter if r > 0 else d * k
    counts.append((trainable, d * k + adapter, adapter))
assert counts == [(40, 136, 40), (96, 96, 0)]
```

## ImageNet: accuracy versus error and batch weighting

[ResNet v1](https://arxiv.org/abs/1512.03385v1), Table 5, reports 3.57% ensemble
test-set top-5 error. A later [PyTorch example](https://github.com/pytorch/examples/blob/acc295dc7b90714f1bf47f06004fc19a7fe235c4/imagenet/main.py#L358-L526)
returns accuracy in percent, and its call sites pass batch sizes into the meter.
It is third-party code, not evidence that this revision produced the paper table.

For four synthetic six-class score rows `[9,8,7,6,5,4]` and targets `[0,1,4,5]`,
top-1 accuracy/error are 25%/75%; top-5 accuracy/error are 75%/25%.
Split into batches of sizes 3 and 1: sum correct counts and sample counts, or use
a sample-weighted average of batch rates. Equal batch weighting instead gives
16⅔% top-1 accuracy and 50% top-5 accuracy. Ties are absent in this example;
do not silently impose its ranking policy on tied real predictions.

```python
from fractions import Fraction
scores = [[9, 8, 7, 6, 5, 4]] * 4
targets = [0, 1, 4, 5]
for k, expected in ((1, 25), (5, 75)):
    hits = [int(t in sorted(range(6), key=row.__getitem__, reverse=True)[:k])
            for row, t in zip(scores, targets)]
    direct = Fraction(100 * sum(hits), 4)
    batches = [(sum(hits[:3]), 3), (sum(hits[3:]), 1)]
    weighted = sum(Fraction(100 * n, size) * size for n, size in batches) / 4
    assert direct == weighted == expected
```

The paper's error complement is 96.43% top-5 accuracy under its own conditions.
Neither this arithmetic conversion nor the toy check validates that benchmark.
Comparing a single-model validation run to an ensemble test-set value also needs
matching model, split and inference conditions before assigning agreement.

## F1: a report can be wrong without a paper being available

Use [scikit-learn 1.7.2's definitions](https://scikit-learn.org/1.7/modules/generated/sklearn.metrics.f1_score.html)
and its [pinned implementation](https://github.com/scikit-learn/scikit-learn/blob/25dee604bae18205b01548348388baf7a1cdfe0e/sklearn/metrics/_classification.py).
For labels `[0,1,2]`, targets `[0]*8+[1,2]` and predictions `[0]*10`, the saved
`average='micro'` call gives 0.8. A report labelling this value macro is incorrect:
macro is 8/27, weighted is 32/45. No missing paper needs to be invented to support
this narrow report audit.

```python
from fractions import Fraction
truth, predicted, labels = [0] * 8 + [1, 2], [0] * 10, [0, 1, 2]
rows = []
for label in labels:
    tp = sum(t == label and p == label for t, p in zip(truth, predicted))
    fp = sum(t != label and p == label for t, p in zip(truth, predicted))
    fn = sum(t == label and p != label for t, p in zip(truth, predicted))
    rows.append((tp, fp, fn, Fraction(2 * tp, 2 * tp + fp + fn)))
macro = sum(row[3] for row in rows) / len(labels)
micro = Fraction(2 * sum(row[0] for row in rows), sum(2*t + f + n for t, f, n, _ in rows))
weighted = sum((t+n) * value for t, _, n, value in rows) / len(truth)
assert (macro, micro, weighted) == (Fraction(8, 27), Fraction(4, 5), Fraction(32, 45))
```

Fix the label set, support weights and undefined-class policy for real inputs.
This example has no undefined per-class F1 and excludes no sample.
