"""Combination-level split for "seen components, unseen combination".

Every supported single goes to train. Supported doubles are shuffled with the
spec seed over their sorted IDs and partitioned whole into train/validation/
test, so a combination's cells never span two partitions. A double is
supported only when both component singles are themselves in train with the
minimum cell support, which is what the empirical additive baseline needs.
Everything else stays in the denominator with a reason; nothing is chosen by
test performance.
"""
import random

from contract import Invalid, check_sealed, sealed, validate_spec
from dataset import condition_id, validate_dataset

SPLIT_SCHEMA = "point.virtual-cell.split.v1"
GENERALIZATION = "seen_components_unseen_combination"
PARTITIONS = ("train", "validation", "test")


def freeze_split(dataset, spec):
    dataset_digest = validate_dataset(dataset)
    spec_digest, facts = validate_spec(spec)
    if spec["dataset"]["digest"] != dataset_digest:
        raise Invalid("spec_dataset_mismatch")
    if any(spec["context"][key]["value"] != dataset["measurement"][key] for key in ("readout", "assay")):
        raise Invalid("spec_measurement_mismatch")
    rules = spec["split"]
    excluded = []
    singles, doubles = [], []
    for condition in sorted(dataset["conditions"], key=lambda c: c["id"]):
        if not condition["targets"]:
            if condition["cells"] < rules["min_cells"]:
                raise Invalid("control_low_support")
            continue
        if condition["cells"] < rules["min_cells"]:
            excluded.append({"id": condition["id"], "reason": "low_support"})
        elif len(condition["targets"]) == 1:
            singles.append(condition["id"])
        else:
            doubles.append(condition)
    train_singles = set(singles)
    supported = []
    for condition in doubles:
        if all(t in train_singles for t in condition["targets"]):
            supported.append(condition["id"])
        else:
            excluded.append({"id": condition["id"], "reason": "component_single_missing"})

    order = sorted(supported)
    random.Random(rules["seed"]).shuffle(order)
    n_test = round(len(order) * rules["test_fraction"])
    n_validation = round(len(order) * rules["validation_fraction"])
    test, validation, train_doubles = order[:n_test], order[n_test:n_test + n_validation], order[n_test + n_validation:]
    if not test:
        raise Invalid("split_infeasible", "no test combinations")
    if not train_doubles:
        # GEARS needs some combinations in training (ADR-0173 §2).
        raise Invalid("split_infeasible", "no training combinations")

    # No Host isolation verifier is wired here. Neither a spec assertion nor a
    # prediction JSON is authority to promote this to a blind execution.
    blind_reasons = ["execution_isolation_unverified"]
    if not facts["feature_fit_eligible"]:
        blind_reasons.append(f"features_fitted_on_{spec['features']['fitted_on']}")
    candidates = sum(1 for c in dataset["conditions"] if len(c["targets"]) == 2)
    split = {
        "schema": SPLIT_SCHEMA,
        "spec_digest": spec_digest,
        "dataset_digest": dataset_digest,
        "generalization": GENERALIZATION,
        "blind": False,
        "feature_fit_eligible": facts["feature_fit_eligible"],
        "isolation": "unverified",
        "blind_reasons": blind_reasons,
        "assignments": {
            "train": sorted(singles) + sorted(train_doubles),
            "validation": sorted(validation),
            "test": sorted(test),
        },
        "excluded": sorted(excluded, key=lambda e: e["id"]),
        "counts": {
            "combination_candidates": candidates,
            "combination_train": len(train_doubles),
            "combination_validation": len(validation),
            "combination_test": len(test),
            "combination_excluded": sum(1 for e in excluded if "+" in e["id"]),
            "single_train": len(singles),
            "single_excluded": sum(1 for e in excluded if "+" not in e["id"]),
        },
    }
    return sealed(split)


def check_split(dataset, spec, split):
    """Re-verify a loaded split against its dataset and spec; return its digest."""
    split_digest = check_sealed(split, "split_digest_mismatch")
    if split.get("schema") != SPLIT_SCHEMA:
        raise Invalid("split_schema")
    if split["dataset_digest"] != validate_dataset(dataset):
        raise Invalid("split_dataset_stale")
    spec_digest, _ = validate_spec(spec)
    if split["spec_digest"] != spec_digest:
        raise Invalid("split_spec_stale")
    if split["blind"] is not False or split.get("isolation") != "unverified":
        raise Invalid("split_blind_mismatch")
    by_id = {c["id"]: c for c in dataset["conditions"]}
    placed = {}
    for partition in PARTITIONS:
        for cid in split["assignments"][partition]:
            if cid not in by_id or cid == dataset["control"]:
                raise Invalid("split_unknown_condition", cid)
            if cid in placed:
                raise Invalid("split_overlap", cid)
            placed[cid] = partition
    for entry in split["excluded"]:
        if entry["id"] in placed:
            raise Invalid("split_overlap", entry["id"])
        placed[entry["id"]] = "excluded"
    missing = sorted(set(by_id) - {dataset["control"]} - set(placed))
    if missing:
        raise Invalid("split_denominator_incomplete", missing[0])
    for partition in ("validation", "test"):
        for cid in split["assignments"][partition]:
            targets = by_id[cid]["targets"]
            if len(targets) != 2:
                raise Invalid("split_heldout_not_combination", cid)
            for target in targets:
                if placed.get(condition_id([target])) != "train":
                    raise Invalid("split_component_unseen", cid)
    # Re-sealing edited assignments/counts is not sufficient: v1 implements
    # exactly the frozen deterministic protocol, including all exclusions.
    if split != freeze_split(dataset, spec):
        raise Invalid("split_protocol_mismatch")
    return split_digest
