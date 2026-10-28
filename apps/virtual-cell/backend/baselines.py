"""Always-on baselines and the prediction artifact every model must emit.

Baselines see only the training view and the identities of the held-out
conditions. `additive` is the empirical μ(A)+μ(B)−μ(control) from observed
training singles; it is not PerturBench's trained `LinearAdditive`.
"""
from contract import Invalid, check_sealed, finite, sealed, text
from dataset import condition_id

PREDICTIONS_SCHEMA = "point.virtual-cell.predictions.v1"
OUTPUT_CONDITION_MEAN = "condition_mean"
BASELINE_VERSION = "virtual-cell.baselines.v1"


def _control(view, _targets, mean):
    return mean(view.control)


def _train_mean(view, _targets, mean):
    perturbed = [cid for cid in view.ids() if cid != view.control]
    if not perturbed:
        raise Invalid("train_mean_empty")
    width = len(view.genes)
    return tuple(sum(mean(cid)[g] for cid in perturbed) / len(perturbed) for g in range(width))


def _additive(view, targets, mean):
    control = mean(view.control)
    a, b = (mean(condition_id([t])) for t in targets)
    return tuple(a[g] + b[g] - control[g] for g in range(len(control)))


BASELINES = {"control": _control, "train_mean": _train_mean, "additive": _additive}


def baseline_mean(name, view, targets, *, pooled=False):
    return BASELINES[name](view, targets, view.pooled_mean if pooled else view.mean)


def predictions(model, split, view, rows, output=OUTPUT_CONDITION_MEAN):
    """Seal a prediction artifact for the split's test conditions."""
    return sealed({
        "schema": PREDICTIONS_SCHEMA,
        "model": model,
        "output": output,
        "split_digest": split["digest"],
        "scale": view.scale,
        "aggregation": "equal_batch",
        "genes": list(view.genes),
        "conditions": [{"id": cid, "mean": list(mean)} for cid, mean in sorted(rows.items())],
    })


def run_baseline(name, split, view, queries):
    """`queries` maps held-out condition IDs to their targets (no readouts)."""
    if view.role != "train":
        raise Invalid("baseline_view_not_train")
    shared = baseline_mean(name, view, None) if name == "train_mean" else None
    rows = {cid: shared if shared is not None else baseline_mean(name, view, targets) for cid, targets in queries.items()}
    return predictions({"id": name, "kind": "baseline", "version": BASELINE_VERSION}, split, view, rows)


def check_predictions(document):
    """Check artifact integrity; scientific alignment is the evaluator's job."""
    digest = check_sealed(document, "predictions_digest_mismatch")
    if document.get("schema") != PREDICTIONS_SCHEMA:
        raise Invalid("predictions_schema")
    if document.get("aggregation") != "equal_batch":
        raise Invalid("predictions_aggregation")
    model = document.get("model")
    if not isinstance(model, dict) or not text(model.get("id"), 80) or not text(model.get("kind"), 40) or not text(model.get("version"), 200):
        raise Invalid("predictions_model")
    rows = document.get("conditions")
    if not isinstance(rows, list) or len({r.get("id") for r in rows if isinstance(r, dict)}) != len(rows):
        raise Invalid("predictions_conditions")
    for row in rows:
        if not isinstance(row.get("mean"), list) or not all(finite(v) for v in row["mean"]):
            raise Invalid("predictions_not_finite", row.get("id"))
    return digest
