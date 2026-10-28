"""Deterministic synthetic condition means with known additive structure.

Not biological data: six single targets with fixed effects over twelve genes,
every pair as a double whose truth is additive plus a known interaction. This
lets tests assert exact baseline values and evaluator behaviour.
"""
import copy
from itertools import combinations
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from contract import digest
from dataset import DATASET_SCHEMA, condition_id

GENES = list("ABCDEF") + [f"G{i}" for i in range(6, 12)]
TARGETS = ["A", "B", "C", "D", "E", "F"]
CONTROL = [1.0 + 0.1 * g for g in range(len(GENES))]


def effect(target):
    k = TARGETS.index(target) + 1
    return [((k * (g + 3)) % 7 - 3) * 0.25 for g in range(len(GENES))]


def interaction(a, b):
    k = TARGETS.index(a) * 6 + TARGETS.index(b) + 1
    return [((k * (g + 1)) % 5 - 2) * 0.05 for g in range(len(GENES))]


def additive_truth(a, b):
    return [c + x + y for c, x, y in zip(CONTROL, effect(a), effect(b))]


def double_truth(a, b):
    return [v + i for v, i in zip(additive_truth(a, b), interaction(a, b))]


def dataset(cells=50):
    conditions = [{"id": "ctrl", "targets": [], "cells": 500, "mean": CONTROL}]
    for target in TARGETS:
        conditions.append({"id": target, "targets": [target], "cells": cells,
                           "mean": [c + e for c, e in zip(CONTROL, effect(target))]})
    for a, b in combinations(TARGETS, 2):
        conditions.append({"id": condition_id([a, b]), "targets": [a, b], "cells": cells, "mean": double_truth(a, b)})
    for row in conditions:
        row["pooled_mean"] = list(row["mean"])
        row["strata"] = [{"batch": "batch1", "cells": row["cells"], "mean": list(row["mean"]),
                          "guide_counts": {"synthetic": row["cells"]}}]
    return {
        "schema": DATASET_SCHEMA,
        "measurement": {"readout": "transcript_expression", "assay": "scRNA-seq"},
        "design": {"batch_key": "synthetic_batch", "guide_key": "synthetic_guide"},
        "source": {"id": "synthetic-additive-interaction", "revision": "v0"},
        "scale": "log1p_cp10k",
        "genes": list(GENES),
        "control": "ctrl",
        "conditions": conditions,
    }


def spec(data, **overrides):
    value = {
        "schema": "point.virtual-cell.task-spec.v1",
        "task": "seen-components-unseen-combination",
        "purpose": "retrospective_benchmark",
        "context": {
            "organism": {"value": "Homo sapiens"},
            "cell_line": {"value": "K562", "source": "synthetic fixture"},
            "intervention": {"value": "CRISPRa"},
            "readout": {"value": "transcript_expression"},
            "assay": {"value": "scRNA-seq"},
            "dose": {"status": "not_applicable"},
            "time": {"status": "unknown"},
            "replicate": {"status": "unknown"},
            "batch": {"status": "unknown"},
        },
        "dataset": {"digest": digest(data)},
        "features": {"fitted_on": "train"},
        "split": {"seed": 7, "validation_fraction": 0.2, "test_fraction": 0.4, "min_cells": 20},
        "baselines": ["control", "train_mean", "additive"],
        "evaluation": {"primary": "delta_mse", "reference": "additive", "aggregate": "median", "min_skill": 0.05},
    }
    for path, replacement in overrides.items():
        node = value
        *parents, leaf = path.split(".")
        for key in parents:
            node = node[key]
        node[leaf] = replacement
    return copy.deepcopy(value)
