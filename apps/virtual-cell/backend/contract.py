"""Virtual Cell core contract v1: canonical digests, errors and the task spec.

Standard library only. The task spec is a domain artifact referenced by a
ContextSnapshot/ArtifactVersion (ADR-0173 §5); it is not a Task, Run or
scheduler record. Any change to its content produces a new digest, and splits,
predictions and evaluations bound to the old digest become stale.
"""
import hashlib
import json
import math

SPEC_SCHEMA = "point.virtual-cell.task-spec.v1"
TASK = "seen-components-unseen-combination"

# Fields the Norman-style task must state. A missing key is an error; the
# author writes {"status": "unknown"} or {"status": "not_applicable"} instead
# of letting the code default a time, dose or replicate structure.
CONTEXT_FIELDS = ("organism", "cell_line", "intervention", "readout", "assay", "dose", "time", "replicate", "batch")
INTERVENTIONS = ("CRISPRa", "CRISPRi", "knockout", "drug")
FEATURE_FIT = ("train", "external", "all_conditions", "unknown")
BLIND_FEATURE_FIT = ("train", "external")
BASELINES = ("control", "train_mean", "additive")
PRIMARY_METRICS = ("delta_mse",)
AGGREGATES = ("median",)


class Invalid(ValueError):
    def __init__(self, code, detail=None):
        super().__init__(code if detail is None else f"{code}: {detail}")
        self.code = code
        self.detail = detail


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def digest(value):
    return "sha256:" + hashlib.sha256(value if isinstance(value, bytes) else canonical(value)).hexdigest()


def sealed(document):
    """Return the document with a digest over every other field."""
    body = {k: v for k, v in document.items() if k != "digest"}
    return {**body, "digest": digest(body)}


def check_sealed(document, code):
    if not isinstance(document, dict) or document.get("digest") != digest({k: v for k, v in document.items() if k != "digest"}):
        raise Invalid(code)
    return document["digest"]


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def text(value, limit=200):
    return isinstance(value, str) and 0 < len(value) <= limit and value.strip() == value


def context_field(name, field):
    if not isinstance(field, dict):
        raise Invalid("context_field_missing", name)
    status = field.get("status", "known")
    if status in ("unknown", "not_applicable"):
        if set(field) != {"status"}:
            raise Invalid("context_field_invalid", name)
        return status
    if status != "known" or not text(field.get("value")) or not set(field) <= {"status", "value", "source"}:
        raise Invalid("context_field_invalid", name)
    if "source" in field and not text(field["source"], 500):
        raise Invalid("context_field_invalid", name)
    return "known"


def validate_spec(spec):
    """Validate a task spec and return (spec digest, normalized facts)."""
    if not isinstance(spec, dict) or spec.get("schema") != SPEC_SCHEMA:
        raise Invalid("spec_schema")
    if spec.get("task") != TASK:
        raise Invalid("spec_task_unsupported")
    if spec.get("purpose") != "retrospective_benchmark":
        raise Invalid("spec_purpose")
    context = spec.get("context")
    if not isinstance(context, dict) or set(context) != set(CONTEXT_FIELDS):
        raise Invalid("spec_context_fields")
    statuses = {name: context_field(name, context[name]) for name in CONTEXT_FIELDS}
    for required in ("organism", "cell_line", "intervention", "readout", "assay"):
        if statuses[required] != "known":
            raise Invalid("context_required_known", required)
    if context["intervention"]["value"] not in INTERVENTIONS:
        raise Invalid("intervention_unsupported")
    if context["intervention"]["value"].startswith("CRISPR") and statuses["dose"] != "not_applicable":
        raise Invalid("crispr_dose_must_be_not_applicable")

    dataset = spec.get("dataset")
    if not isinstance(dataset, dict) or not text(dataset.get("digest"), 80) or not dataset["digest"].startswith("sha256:"):
        raise Invalid("spec_dataset_digest")
    features = spec.get("features")
    if not isinstance(features, dict) or features.get("fitted_on") not in FEATURE_FIT:
        raise Invalid("spec_features")

    split = spec.get("split")
    if not isinstance(split, dict) or set(split) != {"seed", "validation_fraction", "test_fraction", "min_cells"}:
        raise Invalid("spec_split_fields")
    if not isinstance(split["seed"], int) or isinstance(split["seed"], bool) or not 0 <= split["seed"] < 2 ** 32:
        raise Invalid("spec_split_seed")
    fractions = (split["validation_fraction"], split["test_fraction"])
    if not all(finite(f) and 0 <= f < 1 for f in fractions) or split["test_fraction"] <= 0 or sum(fractions) >= 1:
        raise Invalid("spec_split_fractions")
    if not isinstance(split["min_cells"], int) or isinstance(split["min_cells"], bool) or split["min_cells"] < 1:
        raise Invalid("spec_split_min_cells")

    baselines = spec.get("baselines")
    if not isinstance(baselines, list) or sorted(set(baselines)) != sorted(BASELINES) or len(baselines) != len(BASELINES):
        raise Invalid("spec_baselines_required")

    evaluation = spec.get("evaluation")
    if not isinstance(evaluation, dict) or set(evaluation) != {"primary", "reference", "aggregate", "min_skill"}:
        raise Invalid("spec_evaluation_fields")
    if evaluation["primary"] not in PRIMARY_METRICS or evaluation["aggregate"] not in AGGREGATES:
        raise Invalid("spec_evaluation_metric")
    if evaluation["reference"] != "additive":
        raise Invalid("spec_evaluation_reference")
    # A zero/negative threshold cannot express a meaningful improvement.
    # The actual minimum is chosen and frozen by the researcher, not by us.
    if not finite(evaluation["min_skill"]) or not 0 < evaluation["min_skill"] < 1:
        raise Invalid("spec_evaluation_min_skill")

    return digest(spec), {"statuses": statuses,
                          "feature_fit_eligible": features["fitted_on"] in BLIND_FEATURE_FIT}
