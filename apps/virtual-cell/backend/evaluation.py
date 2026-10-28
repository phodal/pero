"""Numerical evaluator over condition means (ADR-0173 §6).

Within the local pipeline this step reads test readouts, without a trusted
execution isolation boundary. Every model is scored on the same frozen genes,
scale and equal-batch means; unmatched controls remain explicitly diagnostic:

- delta_mse: mean squared error of (prediction − control) vs (truth − control);
- delta_pearson: secondary direction/shape diagnostic;
- skill vs additive: 1 − mse_model / mse_additive per combination, aggregated
  by the pre-registered aggregate; a combination where additive is exact is
  excluded from skill with a reason, never silently;
- residual_pearson: whether the model predicts the departure from additivity,
  correlation of (prediction − additive) with (truth − additive).

A missing or misaligned prediction counts as failure. Point-estimate screening,
readout/design coverage, scientific sufficiency and human acceptance are
separate. No local artifact is promoted to a blind scientific claim. All three
baselines are recomputed from the training view; submissions are additional
models only. QC, batch and guide diagnostics cannot certify biological effects.
"""
import copy
import math
import statistics

from baselines import BASELINES, OUTPUT_CONDITION_MEAN, baseline_mean, check_predictions, run_baseline
from contract import Invalid, sealed, validate_spec
from dataset import comparison_support, evaluation_view, readout_support, training_view
from split import check_split

EVALUATION_SCHEMA = "point.virtual-cell.evaluation.v1"
METHOD = "virtual-cell.evaluation.v1"


def _delta(mean, control):
    return [m - c for m, c in zip(mean, control)]


def _mse(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) / len(a)


def _pearson(a, b):
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    da, db = [x - ma for x in a], [y - mb for y in b]
    sa, sb = math.sqrt(sum(x * x for x in da)), math.sqrt(sum(y * y for y in db))
    if sa == 0 or sb == 0:
        return None
    return max(-1.0, min(1.0, sum(x * y for x, y in zip(da, db)) / (sa * sb)))


def _summary(values):
    return {"n": len(values), "median": statistics.median(values) if values else None, "mean": statistics.fmean(values) if values else None}


def test_queries(dataset, split):
    """Held-out condition identities for model adapters; carries no readouts."""
    by_id = {c["id"]: c for c in dataset["conditions"]}
    return {cid: tuple(by_id[cid]["targets"]) for cid in split["assignments"]["test"]}


def evaluate(dataset, spec, split, prediction_docs=()):
    split_digest = check_split(dataset, spec, split)
    spec_digest, _ = validate_spec(spec)
    rules = spec["evaluation"]
    train = training_view(dataset, split)
    baselines = [run_baseline(name, split, train, test_queries(dataset, split)) for name in BASELINES]
    truth = evaluation_view(dataset, split)
    control = truth.mean(truth.control)
    test_ids = split["assignments"]["test"]
    queries = test_queries(dataset, split)
    support = {cid: {"readouts": readout_support(truth.genes, queries[cid]),
                     "design": comparison_support(dataset, queries[cid], cid)} for cid in test_ids}
    additive = {r["id"]: r["mean"] for r in baselines[list(BASELINES).index("additive")]["conditions"]}

    models = []
    for document in [*baselines, *prediction_docs]:
        prediction_digest = check_predictions(document)
        model_id = document["model"]["id"]
        if any(m["model"]["id"] == model_id for m in models):
            raise Invalid("evaluation_model_duplicate", model_id)
        if document["split_digest"] != split_digest:
            raise Invalid("prediction_split_stale", model_id)
        if document["output"] != OUTPUT_CONDITION_MEAN:
            # Distribution outputs need distribution metrics; a centroid must
            # not be scored as a distribution or vice versa (v0 has neither).
            raise Invalid("prediction_output_unsupported", model_id)
        if document["scale"] != truth.scale:
            raise Invalid("prediction_scale_mismatch", model_id)
        if tuple(document["genes"]) != truth.genes:
            raise Invalid("prediction_gene_order_mismatch", model_id)
        rows = {r["id"]: r["mean"] for r in document["conditions"]}
        extra = sorted(set(rows) - set(test_ids))
        if extra:
            raise Invalid("prediction_condition_not_test", extra[0])
        per_condition = []
        for cid in test_ids:
            condition_support = copy.deepcopy(support[cid])
            if model_id == "train_mean" and any(train.batch_ids(t) != train.batch_ids(train.control) for t in train.ids()):
                condition_support["design"]["status"] = "unmatched"
                condition_support["design"]["reasons"].append("training_batch_sets_mismatch")
            if cid not in rows:
                per_condition.append({"id": cid, "status": "failed", "reason": "prediction_missing", "support": condition_support})
                continue
            if len(rows[cid]) != len(truth.genes):
                per_condition.append({"id": cid, "status": "failed", "reason": "prediction_gene_count", "support": condition_support})
                continue
            observed = _delta(truth.mean(cid), control)
            predicted = _delta(rows[cid], control)
            residual_truth = [t - a for t, a in zip(truth.mean(cid), additive[cid])]
            residual_pred = [p - a for p, a in zip(rows[cid], additive[cid])]
            result = {
                "id": cid,
                "status": "evaluated",
                "delta_mse": _mse(predicted, observed),
                "delta_pearson": _pearson(predicted, observed),
                "residual_pearson": _pearson(residual_pred, residual_truth),
                "support": condition_support,
            }
            if model_id in BASELINES:
                # Sensitivity to pooling is a technical diagnostic, never an
                # uncertainty interval or an independent biological replicate.
                pooled = baseline_mean(model_id, train, queries[cid], pooled=True)
                result["pooling_sensitivity"] = {
                    "pooled_delta_mse": _mse(pooled, truth.pooled_mean(cid)),
                    "truth_shift_mse": _mse(truth.mean(cid), truth.pooled_mean(cid)),
                    "prediction_shift_mse": _mse(rows[cid], pooled),
                }
            per_condition.append(result)
        models.append({"model": document["model"], "predictions_digest": prediction_digest, "conditions": per_condition})

    reference = next((m for m in models if m["model"]["id"] == rules["reference"]), None)
    if reference is None:
        raise Invalid("evaluation_reference_missing", rules["reference"])
    reference_mse = {c["id"]: c["delta_mse"] for c in reference["conditions"] if c["status"] == "evaluated"}

    for entry in models:
        evaluated = [c for c in entry["conditions"] if c["status"] == "evaluated"]
        skill, skill_excluded = [], []
        for c in evaluated:
            ref = reference_mse.get(c["id"])
            if ref is None:
                skill_excluded.append({"id": c["id"], "reason": "reference_failed"})
            elif ref == 0:
                skill_excluded.append({"id": c["id"], "reason": "reference_exact"})
            else:
                c["skill_vs_reference"] = 1 - c["delta_mse"] / ref
                skill.append(c["skill_vs_reference"])
        failed = len(entry["conditions"]) - len(evaluated)
        entry["denominator"] = {"attempted": len(test_ids), "evaluated": len(evaluated), "failed": failed}
        entry["delta_mse"] = _summary([c["delta_mse"] for c in evaluated])
        entry["delta_pearson"] = _summary([c["delta_pearson"] for c in evaluated if c["delta_pearson"] is not None])
        entry["residual_pearson"] = _summary([c["residual_pearson"] for c in evaluated if c["residual_pearson"] is not None])
        entry["skill_vs_reference"] = {**_summary(skill), "wins": sum(1 for s in skill if s > 0), "excluded": skill_excluded}
        incomplete = bool(failed or skill_excluded or not skill)
        entry["metric_status"] = ("reference" if entry is reference else "incomplete" if incomplete else
                                  "above_threshold" if statistics.median(skill) > rules["min_skill"] else "below_threshold")
        entry["claim"] = "reference" if entry is reference else "incomplete" if incomplete else "non_blind"
        model_support = [c["support"] for c in entry["conditions"]]
        entry["coverage"] = {
            "predictions": entry["denominator"],
            "target_readouts_complete": sum(s["readouts"]["status"] == "complete" for s in model_support),
            "batch_matched": sum(s["design"]["status"] == "matched" for s in model_support),
            "attempted": len(test_ids),
        }
        entry["scientific_evidence"] = {"status": "insufficient", "reasons": [
            *split["blind_reasons"], "uncertainty_not_computed", "calibration_not_computed",
            "independent_dataset_not_evaluated",
            *(["readout_coverage_incomplete"] if any(s["readouts"]["status"] != "complete" for s in model_support) else []),
            *(["control_matching_incomplete"] if any(s["design"]["status"] != "matched" for s in model_support) else []),
        ]}
        entry["acceptance"] = {"status": "not_reviewed", "authority": "Host/Project Decision"}

    return sealed({
        "schema": EVALUATION_SCHEMA,
        "method": METHOD,
        "spec_digest": spec_digest,
        "dataset_digest": split["dataset_digest"],
        "split_digest": split_digest,
        "generalization": split["generalization"],
        "blind": split["blind"],
        "blind_reasons": split["blind_reasons"],
        "isolation": "unverified",
        "feature_fit_eligible": split["feature_fit_eligible"],
        "purpose": spec["purpose"],
        "aggregation": "equal_batch",
        "primary": rules["primary"],
        "reference": rules["reference"],
        "aggregate": rules["aggregate"],
        "min_skill": rules["min_skill"],
        "denominators": {**split["counts"], "excluded": split["excluded"]},
        # Cells are not independent biological replicates; a replicate- or
        # perturbation-stratified bootstrap is later work, so none is shown.
        "intervals": {"status": "not_computed", "reason": "uncertainty_protocol_not_implemented"},
        "models": models,
    })
