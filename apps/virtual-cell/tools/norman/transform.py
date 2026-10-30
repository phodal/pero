"""Preparation-only functional core; never imported by the App runtime.

Cells retain source row identity even when upstream barcodes are not unique.
No model scores enter inspection, condition selection, or feature fitting.
"""
from collections import Counter, defaultdict
import copy
from dataclasses import dataclass
import hashlib
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from contract import Invalid, canonical, check_sealed, digest, sealed, text, validate_spec
from dataset import DATASET_SCHEMA, condition_id, validate_dataset
from split import freeze_split
from counts import MAX_NNZ, CSCCounts, group_sums, library_sums, training_moments

VERSION = "norman-preparation.v1"
CONTROL = "negative_control"
RULES = {
    "double_count": 24, "feature_count": 256,
    "count_reading": {"encoding": "csc_matrix", "max_nnz": MAX_NNZ},
    "selection": "sha256(seed:canonical-condition-id), ascending; no score input",
    "split": {"seed": 58, "validation_fraction": 0.20, "test_fraction": 0.25, "min_cells": 20},
    "qc": "good_coverage=true; number_of_cells=1; positive full-library sum; reviewed assigned guide",
    "normalization": "log1p(10000 * count / sum_all_source_genes), per cell before any gene subset or mean",
    "features": "population variance of training+control cells; measured targets first; variance descending then gene ascending; exactly 256",
    "aggregation": "float64 per-batch mean, equal-batch mean, cell-weighted pooled mean; round once to 6 decimals",
    "order": "source row index; genes/conditions/batches/guides lexicographic",
}


@dataclass(frozen=True)
class Cell:
    barcode: str
    perturbation: str
    guide: str
    batch: str
    good_coverage: bool
    number_of_cells: int

    def __post_init__(self):
        if not all(isinstance(v, str) for v in (self.barcode, self.perturbation, self.guide, self.batch)):
            raise Invalid("source_metadata_type")
        if not text(self.batch) or not isinstance(self.good_coverage, bool):
            raise Invalid("source_qc_type")
        if isinstance(self.number_of_cells, bool) or not isinstance(self.number_of_cells, int) or self.number_of_cells < 0:
            raise Invalid("source_qc_type")

    @property
    def key(self):
        return (self.perturbation, self.guide)

    def reasons(self, library):
        return tuple(reason for reason, failed in (
            ("bad_coverage", not self.good_coverage),
            ("not_single_cell", self.number_of_cells != 1),
            ("zero_library", library == 0),
            ("unassigned_guide", unassigned(self.guide)),
        ) if failed)


def unassigned(guide):
    return not guide.strip() or any(token in guide.casefold() for token in (
        "no_reads_found", "unassigned", "unmapped", "no_guide")) or guide.casefold() in ("nan", "none", "null")


@dataclass(frozen=True)
class CellTable:
    genes: tuple
    cells: tuple
    counts: CSCCounts

    def __post_init__(self):
        if not self.genes or not all(text(g, 64) and "+" not in g for g in self.genes):
            raise Invalid("source_gene_ids")
        if len(set(self.genes)) != len(self.genes):
            raise Invalid("source_gene_duplicate", "No automatic suffixing or alias repair is allowed")
        if self.counts.shape != (len(self.cells), len(self.genes)) or not self.cells:
            raise Invalid("source_matrix_shape")

def inspect_cells(table, libraries=None):
    libraries = library_sums(table.counts) if libraries is None else libraries
    inventory = {}
    row_hash = hashlib.sha256()
    all_reasons = Counter()
    for index, (cell, library) in enumerate(zip(table.cells, libraries)):
        row_hash.update(canonical([index, cell.barcode, cell.perturbation, cell.guide, cell.batch]) + b"\n")
        entry = inventory.setdefault(cell.key, {"perturbation": cell.perturbation, "guide_id": cell.guide,
                                                "cells": 0, "source_batches": Counter(), "eligible_batches": Counter(), "exclusions": Counter()})
        entry["cells"] += 1
        entry["source_batches"][cell.batch] += 1
        reasons = cell.reasons(library)
        if reasons:
            entry["exclusions"].update(reasons)
            all_reasons.update(reasons)
        else:
            entry["eligible_batches"][cell.batch] += 1
    return {"genes": list(table.genes), "rows": len(table.cells),
            "duplicate_barcodes": len(table.cells) - len({c.barcode for c in table.cells}),
            "row_identity": "zero-based source row index; barcode is descriptive, not unique",
            "row_identity_digest": "sha256:" + row_hash.hexdigest(),
            "matrix": "X; CSC; finite nonnegative integer counts and sorted unique row indices verified in bounded nnz slices",
            "matrix_shape": list(table.counts.shape),
            "qc_exclusion_counts_overlapping": dict(sorted(all_reasons.items())),
            "inventory": [{**e, "source_batches": dict(sorted(e["source_batches"].items())),
                           "eligible_batches": dict(sorted(e["eligible_batches"].items())),
                           "exclusions": dict(sorted(e["exclusions"].items()))}
                          for _, e in sorted(inventory.items())]}


@dataclass(frozen=True)
class Annotation:
    perturbation: str
    guide: str
    kind: str
    targets: tuple
    evidence: str

    @property
    def key(self):
        return (self.perturbation, self.guide)

    @property
    def identity(self):
        return CONTROL if self.kind == "negative_control" else condition_id(self.targets)

    @classmethod
    def read_all(cls, document, inspection):
        if not isinstance(document, list):
            raise Invalid("mapping_list_required")
        entries = []
        genes = set(inspection["genes"])
        for row in document:
            if not isinstance(row, dict) or set(row) != {"perturbation", "guide_id", "kind", "targets", "evidence"}:
                raise Invalid("mapping_fields")
            targets = row["targets"]
            if (row["kind"] not in ("negative_control", "perturbation", "exclude")
                    or not text(row["evidence"], 2000) or not isinstance(targets, list)
                    or not all(text(t, 64) for t in targets) or len(set(targets)) != len(targets)
                    or not isinstance(row["perturbation"], str) or not isinstance(row["guide_id"], str)):
                raise Invalid("mapping_unreviewed")
            if row["kind"] == "perturbation":
                if not 1 <= len(targets) <= 2 or set(targets) - genes or CONTROL in targets:
                    raise Invalid("target_missing_or_ambiguous", row["perturbation"])
            elif targets:
                raise Invalid("mapping_targets")
            if row["kind"] != "exclude" and unassigned(row["guide_id"]):
                raise Invalid("unassigned_guide_not_control_or_perturbation", row["guide_id"])
            entries.append(cls(row["perturbation"], row["guide_id"], row["kind"], tuple(sorted(targets)), row["evidence"]))
        keys = [e.key for e in entries]
        expected = {(e["perturbation"], e["guide_id"]) for e in inspection["inventory"]}
        if len(set(keys)) != len(keys) or set(keys) != expected:
            raise Invalid("mapping_denominator_incomplete_or_duplicate")
        # An upstream label may have multiple guides, but not multiple biological meanings.
        meanings = defaultdict(set)
        for entry in entries:
            if entry.kind != "exclude":
                meanings[entry.perturbation].add((entry.kind, entry.targets))
        if any(len(values) > 1 for values in meanings.values()):
            raise Invalid("mapping_ambiguous_perturbation")
        if not any(e.kind == "negative_control" for e in entries):
            raise Invalid("reviewed_negative_control_required")
        return tuple(sorted(entries, key=lambda e: e.key))

    def document(self):
        return {"perturbation": self.perturbation, "guide_id": self.guide, "kind": self.kind,
                "targets": list(self.targets), "evidence": self.evidence}


def task_spec(dataset, recipe_digest, min_skill):
    context = {k: {"value": value} for k, value in (
        ("organism", "Homo sapiens"), ("cell_line", "K562"), ("intervention", "CRISPRa"),
        ("readout", "transcript_expression"), ("assay", "scRNA-seq"))}
    context.update(dose={"status": "not_applicable"}, time={"status": "unknown"},
                   replicate={"status": "unknown"}, batch={"value": "gemgroup (technical, not biological replicate)"})
    return {"schema": "point.virtual-cell.task-spec.v1", "task": "seen-components-unseen-combination",
            "purpose": "retrospective_benchmark", "context": context, "dataset": {"digest": digest(dataset)},
            "features": {"fitted_on": "train", "control_included": True, "rule": RULES["features"], "recipe_digest": recipe_digest},
            "split": dict(RULES["split"]), "baselines": ["control", "train_mean", "additive"],
            "evaluation": {"primary": "delta_mse", "reference": "additive", "aggregate": "median", "min_skill": min_skill}}


def dataset_document(genes, conditions, revision):
    return {"schema": DATASET_SCHEMA, "source": {"id": "scperturb-norman-local-demo", "revision": revision},
            "measurement": {"readout": "transcript_expression", "assay": "scRNA-seq"},
            "design": {"batch_key": "gemgroup", "guide_key": "guide_id"}, "scale": "log1p_cp10k",
            "genes": list(genes), "control": CONTROL, "conditions": conditions}


def condition_rows(strata, targets):
    rows = []
    for cid, batches in sorted(strata.items()):
        batch_rows = []
        for batch, (count, values, guides) in sorted(batches.items()):
            batch_rows.append({"batch": batch, "cells": count, "mean": np.round(values / count, 6).tolist(),
                               "guide_counts": dict(sorted(guides.items()))})
        # Compute both estimands from unrounded float64 sums, not rounded strata.
        cells = sum(v[0] for v in batches.values())
        mean = sum(v[1] / v[0] for v in batches.values()) / len(batches)
        pooled = sum(v[1] for v in batches.values()) / cells
        rows.append({"id": cid, "targets": list(targets[cid]), "cells": cells,
                     "mean": np.round(mean, 6).tolist(), "pooled_mean": np.round(pooled, 6).tolist(), "strata": batch_rows})
    return rows


def select_conditions(inspection, annotations, min_skill):
    by_key = {e.key: e for e in annotations}
    support = defaultdict(lambda: defaultdict(Counter))
    targets = {}
    for row in inspection["inventory"]:
        entry = by_key[(row["perturbation"], row["guide_id"])]
        if entry.kind != "exclude":
            targets[entry.identity] = entry.targets
            for batch, count in row["eligible_batches"].items():
                support[entry.identity][batch][entry.guide] += count
    minimum = RULES["split"]["min_cells"]
    counts = {cid: sum(sum(g.values()) for g in batches.values()) for cid, batches in support.items()}
    if counts.get(CONTROL, 0) < minimum:
        raise Invalid("reviewed_control_low_support")
    reasons = {}
    for cid, target in sorted(targets.items()):
        reason = []
        if counts.get(cid, 0) < minimum:
            reason.append("low_support")
        if set(support[cid]) != set(support[CONTROL]):
            reason.append("batch_sets_mismatch")
        if len(target) == 2:
            for single in target:
                if counts.get(single, 0) < minimum:
                    reason.append("component_single_missing_or_low_support")
                elif set(support[single]) != set(support[CONTROL]):
                    reason.append("component_single_batch_sets_mismatch")
        reasons[cid] = sorted(set(reason))
    eligible = [cid for cid in targets if len(targets[cid]) == 2 and not reasons[cid]]
    order = sorted(eligible, key=lambda cid: (hashlib.sha256(f"58:{cid}".encode()).hexdigest(), cid))
    if len(order) < RULES["double_count"]:
        raise Invalid("insufficient_eligible_doubles", {"required": RULES["double_count"], "eligible": len(order), "condition_reasons": reasons})
    selected = {CONTROL, *order[:RULES["double_count"]]}
    selected.update(t for cid in tuple(selected) for t in targets[cid])
    audit = [{"id": cid, "targets": list(targets[cid]), "cells": counts.get(cid, 0),
              "batches": sorted(support[cid]), "selected": cid in selected,
              "reasons": reasons[cid] or ([] if cid in selected else ["not_selected_by_fixed_hash_or_not_required_single"])}
             for cid in sorted(targets)]
    # Metadata-only means freeze the existing split protocol before feature fitting.
    strata = {cid: {b: (sum(g.values()), np.zeros(1), g) for b, g in support[cid].items()} for cid in selected}
    scaffold = dataset_document(["metadata_only"], condition_rows(strata, targets), "identity-only-not-an-expression-dataset")
    assignments = freeze_split(scaffold, task_spec(scaffold, "identity-only", min_skill))["assignments"]
    return tuple(sorted(selected)), assignments, audit


@dataclass(frozen=True)
class FrozenRecipe:
    inspection: dict
    annotations: tuple
    selected: tuple
    assignments: dict
    min_skill: float
    audit: list
    document: dict

    @classmethod
    def freeze(cls, inspection, mapping, min_skill):
        check_sealed(inspection, "inspection_digest_mismatch")
        if inspection.get("schema") != "pero.virtual-cell.norman-inspection.v1":
            raise Invalid("inspection_schema")
        annotations = Annotation.read_all(mapping, inspection["cells"])
        selected, assignments, audit = select_conditions(inspection["cells"], annotations, min_skill)
        if len(inspection["cells"]["genes"]) < RULES["feature_count"]:
            raise Invalid("insufficient_source_genes")
        document = sealed({"schema": "pero.virtual-cell.norman-recipe.v1", "tool": VERSION,
                           "inspection": inspection, "mapping": [a.document() for a in annotations],
                           "rules": copy.deepcopy(RULES), "selected": list(selected), "assignments": assignments,
                           "evaluation": {"min_skill": min_skill, "threshold_source": "explicit researcher input before evaluation"},
                           "condition_selection_audit": audit})
        return cls(inspection, annotations, selected, assignments, min_skill, audit, document)

    @classmethod
    def read(cls, document):
        check_sealed(document, "recipe_digest_mismatch")
        expected = cls.freeze(document["inspection"], document["mapping"], document["evaluation"]["min_skill"])
        if document != expected.document:
            raise Invalid("recipe_protocol_mismatch")
        return expected


def choose_features(genes, target_genes, sums, squares, count, width):
    if count < 1 or len(target_genes) > width:
        raise Invalid("feature_selection_infeasible")
    variance = np.maximum(0, squares / count - (sums / count) ** 2)
    ranked = sorted(range(len(genes)), key=lambda i: (-variance[i], genes[i]))
    selected = set(target_genes)
    for index in ranked:
        if len(selected) >= width:
            break
        selected.add(genes[index])
    if len(selected) != width:
        raise Invalid("feature_selection_infeasible")
    return tuple(sorted(selected))


def prepare_cells(table, recipe):
    libraries = library_sums(table.counts)
    if inspect_cells(table, libraries) != recipe.inspection["cells"]:
        raise Invalid("source_inspection_changed")
    mapping = {a.key: a for a in recipe.annotations}
    selected = set(recipe.selected)
    train = {CONTROL, *recipe.assignments["train"]}
    training = np.zeros(len(table.cells), dtype=bool)
    retained = []
    row_dispositions = Counter()
    retained_hash = hashlib.sha256()
    for index, (cell, library) in enumerate(zip(table.cells, libraries)):
        entry = mapping[cell.key]
        reason = ("qc_excluded" if cell.reasons(library) else "mapping_excluded" if entry.kind == "exclude"
                  else "condition_not_selected" if entry.identity not in selected else "retained")
        row_dispositions[reason] += 1
        if reason == "retained":
            retained_hash.update(canonical([index, entry.identity, cell.batch, cell.guide]) + b"\n")
            retained.append((index, entry.identity, cell.batch, cell.guide))
            training[index] = entry.identity in train
    sums, squares, count = training_moments(table.counts, libraries, training)
    targets = {a.identity: a.targets for a in recipe.annotations if a.kind != "exclude"}
    measured = {t for cid in selected for t in targets[cid]}
    genes = choose_features(table.genes, measured, sums, squares, count, RULES["feature_count"])
    axis = {g: i for i, g in enumerate(table.genes)}
    keys = sorted({(cid, batch) for _, cid, batch, _ in retained})
    group_ids = {key: index for index, key in enumerate(keys)}
    groups = np.full(len(table.cells), -1, dtype=np.int64)
    cell_counts, guides = Counter(), defaultdict(Counter)
    for index, cid, batch, guide in retained:
        group = group_ids[(cid, batch)]
        groups[index] = group
        cell_counts[group] += 1
        guides[group][guide] += 1
    grouped = group_sums(table.counts, libraries, [axis[g] for g in genes], groups, len(keys))
    strata = defaultdict(dict)
    for group, (cid, batch) in enumerate(keys):
        strata[cid][batch] = (cell_counts[group], grouped[group], guides[group])
    row_audit = {
        "row_dispositions": dict(sorted(row_dispositions.items())), "feature_fit_cells": count,
        "feature_fit_conditions": sorted(train), "feature_fit_control_included": True,
        "retained_source_rows_digest": "sha256:" + retained_hash.hexdigest(), "gene_order_digest": digest(list(genes))}
    data = dataset_document(genes, condition_rows(strata, targets), recipe.document["digest"])
    # Keep license, source checksums and the complete excluded denominator when
    # the App imports/exports only bundle.json. No external path is authoritative.
    data["source"]["preparation"] = {"recipe": recipe.document, "row_audit": row_audit}
    validate_dataset(data)
    spec = task_spec(data, recipe.document["digest"], recipe.min_skill)
    validate_spec(spec)
    split = freeze_split(data, spec)
    if split["assignments"] != recipe.assignments:
        raise Invalid("frozen_assignments_changed")
    return {"dataset": data, "spec": spec, "split": split}, {
        **row_audit, "condition_selection": recipe.audit, "mapping": [a.document() for a in recipe.annotations]}
