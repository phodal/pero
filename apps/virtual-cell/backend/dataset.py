"""Condition-mean (pseudobulk) datasets and the read-scoped views over them.

The core consumes per-condition means already computed by a pinned data
adapter (AnnData/Scanpy, SC0). Cell-level matrices, h5ad parsing and
normalization stay in that adapter; the core never reconstructs cells from a
mean. A condition ID is the sorted target list joined by "+", so "B+A" cannot
silently duplicate "A+B"; the control has no targets.
"""
from contract import Invalid, digest, finite, text

DATASET_SCHEMA = "point.virtual-cell.condition-means.v1"
LIMITS = {"genes": 20000, "conditions": 4000, "targets": 2}
SCALES = ("log1p_cp10k", "log1p_cpm", "counts_mean")


def condition_id(targets):
    return "+".join(sorted(targets))


def validate_dataset(document):
    """Validate a dataset document and return its content digest."""
    if not isinstance(document, dict) or document.get("schema") != DATASET_SCHEMA:
        raise Invalid("dataset_schema")
    source = document.get("source")
    if not isinstance(source, dict) or not text(source.get("id")) or not text(source.get("revision")):
        raise Invalid("dataset_source")
    if document.get("scale") not in SCALES:
        raise Invalid("dataset_scale")
    measurement = document.get("measurement")
    if not isinstance(measurement, dict) or set(measurement) != {"readout", "assay"} or not all(text(v) for v in measurement.values()):
        raise Invalid("dataset_measurement")
    genes = document.get("genes")
    if not isinstance(genes, list) or not 0 < len(genes) <= LIMITS["genes"] or not all(text(g, 64) for g in genes):
        raise Invalid("dataset_genes")
    if len(set(genes)) != len(genes):
        raise Invalid("dataset_genes_duplicate")
    design = document.get("design")
    if not isinstance(design, dict) or set(design) != {"batch_key", "guide_key"}:
        raise Invalid("dataset_design")
    if any(value is not None and not text(value) for value in design.values()):
        raise Invalid("dataset_design")
    conditions = document.get("conditions")
    if not isinstance(conditions, list) or not 0 < len(conditions) <= LIMITS["conditions"]:
        raise Invalid("dataset_conditions")
    seen = set()
    controls = 0
    for condition in conditions:
        if not isinstance(condition, dict) or set(condition) != {"id", "targets", "cells", "mean", "pooled_mean", "strata"}:
            raise Invalid("condition_fields")
        targets = condition["targets"]
        if not isinstance(targets, list) or not all(text(t, 64) for t in targets) or len(set(targets)) != len(targets):
            raise Invalid("condition_targets", condition.get("id"))
        if len(targets) > LIMITS["targets"]:
            raise Invalid("condition_order_unsupported", condition["id"])
        if not targets:
            controls += 1
            if condition["id"] != document.get("control"):
                raise Invalid("control_id_mismatch", condition["id"])
        elif condition["id"] != condition_id(targets):
            raise Invalid("condition_id_not_canonical", condition["id"])
        if condition["id"] in seen:
            raise Invalid("condition_duplicate", condition["id"])
        seen.add(condition["id"])
        if not isinstance(condition["cells"], int) or isinstance(condition["cells"], bool) or condition["cells"] < 0:
            raise Invalid("condition_cells", condition["id"])
        mean = condition["mean"]
        if not isinstance(mean, list) or len(mean) != len(genes):
            raise Invalid("condition_gene_count", condition["id"])
        if not all(finite(v) for v in mean):
            raise Invalid("condition_mean_not_finite", condition["id"])
        strata = condition["strata"]
        if not isinstance(strata, list) or not 0 < len(strata) <= 64:
            raise Invalid("condition_strata", condition["id"])
        batches = set()
        for row in strata:
            if not isinstance(row, dict) or set(row) != {"batch", "cells", "mean", "guide_counts"}:
                raise Invalid("stratum_fields")
            if not text(row["batch"]) or row["batch"] in batches:
                raise Invalid("stratum_batch")
            batches.add(row["batch"])
            if not isinstance(row["cells"], int) or isinstance(row["cells"], bool) or row["cells"] < 1:
                raise Invalid("stratum_cells")
            if not isinstance(row["mean"], list) or len(row["mean"]) != len(genes) or not all(finite(v) for v in row["mean"]):
                raise Invalid("stratum_mean")
            guides = row["guide_counts"]
            if not isinstance(guides, dict) or len(guides) > 128 or any(
                not text(g, 1000) or not isinstance(n, int) or isinstance(n, bool) or n < 1 for g, n in guides.items()
            ) or (sum(guides.values()) != row["cells"] if design["guide_key"] else bool(guides)):
                raise Invalid("stratum_guides")
        if not design["batch_key"] and batches != {"unrecorded"}:
            raise Invalid("stratum_batch_unknown")
        if sum(r["cells"] for r in strata) != condition["cells"]:
            raise Invalid("condition_cell_total")
        pooled = condition["pooled_mean"]
        if not isinstance(pooled, list) or len(pooled) != len(genes) or not all(finite(v) for v in pooled):
            raise Invalid("condition_pooled_mean")
        # Means are rounded once by the adapter; allow its 6-decimal error.
        for g in range(len(genes)):
            if abs(mean[g] - sum(r["mean"][g] for r in strata) / len(strata)) > 1.1e-6:
                raise Invalid("condition_batch_mean")
            if abs(pooled[g] - sum(r["mean"][g] * r["cells"] for r in strata) / condition["cells"]) > 1.1e-6:
                raise Invalid("condition_pooled_mean")
    if controls != 1:
        raise Invalid("control_required")
    return digest(document)


def readout_support(genes, targets, endpoint_genes=()):
    """Coverage is about the requested readout, separate from prediction rows."""
    present = set(genes)
    missing_targets = sorted(set(targets) - present)
    missing_endpoints = sorted(set(endpoint_genes) - present)
    return {"targets_expected": len(set(targets)), "targets_present": len(set(targets) & present),
            "targets_missing": missing_targets, "endpoints_missing": missing_endpoints,
            "status": "complete" if not missing_targets and not missing_endpoints else "incomplete"}


def comparison_support(document, targets, observed_id=None):
    """Check the same batch universe for control, singles and optional truth.

    Partial intersections are deliberately not used: dropping unmatched batches
    would silently change the estimand. Unknown designs remain diagnostic only.
    """
    by_id = {c["id"]: c for c in document["conditions"]}
    ids = [document["control"], *targets, *([observed_id] if observed_id else [])]
    reasons = []
    sets = [{r["batch"] for r in by_id[cid]["strata"]} for cid in ids if cid in by_id]
    if len(sets) != len(ids):
        reasons.append("component_single_missing")
    if not document["design"]["batch_key"]:
        reasons.append("batch_unknown")
    if sets and any(s != sets[0] for s in sets[1:]):
        reasons.append("batch_sets_mismatch")
    return {"status": "matched" if not reasons else "unmatched", "reasons": reasons,
            "batches": sorted(sets[0]) if sets and not reasons else [],
            "weighting": "equal_batch", "guide": "retained_unvalidated" if document["design"]["guide_key"] else "unknown"}


class ReadoutView:
    """Read-only means for an explicit set of conditions.

    A view only holds the readouts it was built with. Model adapters receive
    the training view and the test *identities*; test readouts are built into
    a separate view that only the evaluator is handed. This is structural
    separation inside one process, not Host-enforced isolation (ADR-0173 §6).
    """

    def __init__(self, document, allowed, role):
        self.role = role
        self.genes = tuple(document["genes"])
        self.scale = document["scale"]
        self.control = document["control"]
        by_id = {c["id"]: c for c in document["conditions"]}
        self._means = {cid: tuple(float(v) for v in by_id[cid]["mean"]) for cid in allowed}
        self._targets = {cid: tuple(by_id[cid]["targets"]) for cid in allowed}
        self._pooled = {cid: tuple(by_id[cid]["pooled_mean"]) for cid in allowed}
        self._strata = {cid: {r["batch"]: tuple(r["mean"]) for r in by_id[cid]["strata"]} for cid in allowed}

    def ids(self):
        return sorted(self._means)

    def has(self, cid):
        return cid in self._means

    def mean(self, cid):
        if cid not in self._means:
            raise Invalid("readout_not_in_view", f"{self.role}:{cid}")
        return self._means[cid]

    def targets(self, cid):
        return self._targets[cid]

    def pooled_mean(self, cid):
        self.mean(cid)  # enforce the same read scope
        return self._pooled[cid]

    def batch_mean(self, cid, batch):
        self.mean(cid)
        return self._strata[cid][batch]

    def batch_ids(self, cid):
        self.mean(cid)
        return set(self._strata[cid])


def training_view(document, split, include_validation=False):
    allowed = [document["control"], *split["assignments"]["train"]]
    if include_validation:
        allowed += split["assignments"]["validation"]
    return ReadoutView(document, allowed, "train+validation" if include_validation else "train")


def evaluation_view(document, split):
    return ReadoutView(document, [document["control"], *split["assignments"]["test"]], "test")
