"""Synthetic sparse-cell tests only; not real Norman/scPerturb acceptance."""
import copy
from itertools import combinations
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

TOOLS = Path(__file__).resolve().parents[1] / "tools" / "norman"
sys.path.insert(0, str(TOOLS))
try:
    import numpy as np
    from scipy import sparse
except ImportError:
    np = sparse = None
if np is not None:
    from transform import (Annotation, Cell, CellTable, CONTROL, FrozenRecipe, RULES, choose_features,
                           condition_rows, inspect_cells, prepare_cells)
    from counts import CSCCounts, group_sums, library_sums, training_moments
    from prepare import SOURCE_MANIFEST, artifact_sizes, check_inspection, implementation
    from contract import Invalid, digest, sealed
    from dataset import validate_dataset
    from evaluation import evaluate


def synthetic_source():
    """Small invented counts, duplicate barcodes, 28 pairs; never public data."""
    genes = tuple(list("ABCDEFGH") + [f"Z{i:03}" for i in range(252)])
    cells, counts, mapping = [], [], []
    for index, targets in enumerate([(), *((t,) for t in "ABCDEFGH"), *combinations("ABCDEFGH", 2)]):
        label = "+".join(targets) if targets else "control"
        guide = "synthetic_" + label
        mapping.append({"perturbation": label, "guide_id": guide,
                        "kind": "perturbation" if targets else "negative_control",
                        "targets": list(targets), "evidence": "Explicit synthetic test annotation; not real guide evidence"})
        for row in range(20):
            cells.append(Cell(f"duplicate-{row}", label, guide, f"batch{row % 2}", True, 1))
            values = np.zeros(len(genes))
            values[(index + row) % 8] = row + 1
            values[8 + index % 252] = 10
            counts.append(values)
    # The misleading upstream control label must NOT make this a control cell.
    cells.append(Cell("no-read", "control", "no_reads_found", "batch0", True, 1))
    counts.append(np.ones(len(genes)))
    mapping.append({"perturbation": "control", "guide_id": "no_reads_found", "kind": "exclude",
                    "targets": [], "evidence": "No assigned guide reads; synthetic case"})
    table = CellTable(genes, tuple(cells), CSCCounts.from_sparse(sparse.csr_matrix(counts)))
    inspected = sealed({"schema": "pero.virtual-cell.norman-inspection.v1", "cells": inspect_cells(table),
                        "source": {"id": "synthetic-only-not-public-data"}})
    return table, inspected, mapping


def fixture_matrix(table):
    """Reconstruct only these tiny synthetic inputs for mutation regressions."""
    counts = table.counts
    return sparse.csc_matrix((counts.data, counts.indices, counts.indptr), shape=counts.shape, copy=True)


class BoundedArray:
    """Counts-reader seam enforcing the promised maximum read, not call order."""
    def __init__(self, values, limit):
        self.values, self.limit = np.asarray(values), limit
        self.ndim = self.values.ndim

    def __len__(self):
        return len(self.values)

    def __getitem__(self, selection):
        if (not isinstance(selection, slice) or selection.start is None or selection.stop is None
                or selection.stop - selection.start > self.limit):
            raise AssertionError("unbounded count array read")
        return self.values[selection]


@unittest.skipIf(np is None, "Optional preparation-only numpy/scipy unavailable; App remains stdlib-only")
class PreparationTests(unittest.TestCase):
    def assert_invalid(self, code, fn, *args):
        with self.assertRaises(Invalid) as caught:
            fn(*args)
        self.assertEqual(caught.exception.code, code)

    def test_normalize_before_gene_selection_and_means(self):
        counts = CSCCounts.from_sparse(sparse.csr_matrix([[1, 9], [9, 1], [0, 0]]))
        libraries = library_sums(counts)
        np.testing.assert_array_equal(libraries, [10, 10, 0])
        values = group_sums(counts, libraries, [0], np.array([0, 1, -1]), 2)
        self.assertAlmostEqual(values[0, 0], np.log1p(1000))
        self.assertNotAlmostEqual(values.mean(), np.log1p(5000))
        rows = condition_rows({"A": {"one": (1, np.array([2.]), {"g1": 1}),
                                      "two": (3, np.array([18.]), {"g2": 3})}}, {"A": ("A",)})
        self.assertEqual(rows[0]["mean"], [4.])
        self.assertEqual(rows[0]["pooled_mean"], [5.])
        self.assertEqual([r["batch"] for r in rows[0]["strata"]], ["one", "two"])

    def test_invalid_counts_and_gene_axis_are_rejected(self):
        for value in (-1, 0.1, float("nan"), float("inf")):
            with self.subTest(value=value):
                self.assert_invalid("source_not_nonnegative_integer_counts", library_sums, CSCCounts.from_sparse(sparse.csr_matrix([[value]])))
        cell = Cell("barcode", "A", "guide", "batch", True, 1)
        self.assert_invalid("source_gene_duplicate", CellTable, ("A", "A"), (cell,), CSCCounts.from_sparse(sparse.csr_matrix([[1, 2]])))
        self.assert_invalid("source_gene_ids", CellTable, ("A+B",), (cell,), CSCCounts.from_sparse(sparse.csr_matrix([[1]])))

    def test_csc_streaming_matches_dense_reference_with_implicit_zeros(self):
        matrix = np.array([[1, 0, 9, 0], [0, 2, 8, 0], [3, 0, 7, 0], [0, 0, 0, 0]])
        expected = np.log1p(matrix[:3] * 1000.)
        for limit in (1, 2, 65536):
            with self.subTest(max_nnz=limit):
                csc = sparse.csc_matrix(matrix)
                counts = CSCCounts(csc.shape, BoundedArray(csc.data, limit), BoundedArray(csc.indices, limit), csc.indptr, limit)
                libraries = library_sums(counts)
                np.testing.assert_array_equal(libraries, [10, 10, 10, 0])
                sums, squares, n = training_moments(counts, libraries, np.array([True, True, True, False]))
                np.testing.assert_allclose(sums, expected.sum(axis=0), rtol=1e-14)
                np.testing.assert_allclose(squares, np.square(expected).sum(axis=0), rtol=1e-14)
                self.assertEqual(n, 3)  # implicit zeros count, including the entirely zero fourth gene
                np.testing.assert_allclose(squares / n - (sums / n) ** 2, expected.var(axis=0), atol=1e-14)
                actual = group_sums(counts, libraries, [3, 0, 1], np.array([0, 1, 0, -1]), 2)
                np.testing.assert_allclose(actual, np.array([expected[[0, 2]].sum(axis=0), expected[1]])[:, [3, 0, 1]])

    def test_invalid_csc_indices_are_rejected_including_across_chunk_boundary(self):
        for rows in ([1, 1], [1, 0], [-1, 1], [0, 3], [0., 1.]):
            with self.subTest(rows=rows):
                counts = CSCCounts((3, 1), np.array([1., 1.]), np.asarray(rows), np.array([0, 2]), 1)
                self.assert_invalid("source_csc_indices_invalid", library_sums, counts)
        self.assert_invalid("source_csc_indptr", CSCCounts, (3, 1), np.array([1.]), np.array([0]), np.array([0, 2]))

    def test_inspection_preserves_full_denominator_and_duplicate_barcodes(self):
        table, inspection, _ = synthetic_source()
        observed = inspection["cells"]
        self.assertEqual(sum(e["cells"] for e in observed["inventory"]), len(table.cells))
        self.assertGreater(observed["duplicate_barcodes"], 0)
        self.assertEqual(observed["qc_exclusion_counts_overlapping"], {"unassigned_guide": 1})
        self.assertEqual(inspect_cells(table), observed)

    def test_review_requires_all_mappings_explicit_negative_controls_and_exact_targets(self):
        _, inspected, mapping = synthetic_source()
        cells = inspected["cells"]
        self.assert_invalid("mapping_denominator_incomplete_or_duplicate", Annotation.read_all, mapping[:-1], cells)
        bad = copy.deepcopy(mapping)
        bad[-1]["kind"] = "negative_control"
        self.assert_invalid("unassigned_guide_not_control_or_perturbation", Annotation.read_all, bad, cells)
        bad = copy.deepcopy(mapping)
        bad[1]["targets"] = ["unknown_alias"]
        self.assert_invalid("target_missing_or_ambiguous", Annotation.read_all, bad, cells)
        bad = copy.deepcopy(mapping)
        bad[1]["targets"] = ["A", "A"]
        self.assert_invalid("mapping_unreviewed", Annotation.read_all, bad, cells)
        bad = copy.deepcopy(mapping)
        bad[0]["kind"] = "exclude"
        self.assert_invalid("reviewed_negative_control_required", Annotation.read_all, bad, cells)
        bad = copy.deepcopy(mapping)
        bad[1]["evidence"] = ""
        self.assert_invalid("mapping_unreviewed", Annotation.read_all, bad, cells)

    def test_feature_ranking_ties_and_mandatory_targets(self):
        selected = choose_features(("Z", "B", "A"), {"Z"}, np.zeros(3), np.array([0., 2., 2.]), 1, 2)
        self.assertEqual(selected, ("A", "Z"))

    def test_prepared_fixture_is_deterministic_train_only_and_core_compatible(self):
        table, inspected, mapping = synthetic_source()
        recipe = FrozenRecipe.freeze(inspected, mapping, 0.05)
        self.assertEqual(recipe.document, FrozenRecipe.freeze(inspected, list(reversed(mapping)), 0.05).document)
        self.assertEqual(recipe.document, FrozenRecipe.read(recipe.document).document)
        self.assertEqual(recipe.document["evaluation"]["min_skill"], 0.05)
        self.assertNotEqual(recipe.document["digest"], FrozenRecipe.freeze(inspected, mapping, 0.1).document["digest"])
        stale = copy.deepcopy(recipe.document)
        stale["evaluation"]["min_skill"] = 0.1
        self.assert_invalid("recipe_digest_mismatch", FrozenRecipe.read, stale)
        self.assert_invalid("spec_evaluation_min_skill", FrozenRecipe.freeze, inspected, mapping, 0)
        self.assertEqual(len([cid for cid in recipe.selected if "+" in cid]), 24)
        bundle, audit = prepare_cells(table, recipe)
        self.assertEqual(bundle, prepare_cells(table, recipe)[0])
        tiny_chunks = CellTable(table.genes, table.cells, CSCCounts.from_sparse(fixture_matrix(table), max_nnz=1))
        self.assertEqual(bundle, prepare_cells(tiny_chunks, recipe)[0])
        provenance = bundle["dataset"]["source"]["preparation"]
        self.assertEqual(provenance["recipe"], recipe.document)
        self.assertEqual(provenance["row_audit"]["row_dispositions"], audit["row_dispositions"])
        self.assertEqual(bundle["spec"]["evaluation"]["min_skill"], 0.05)
        self.assertEqual(bundle["dataset"]["genes"], sorted(bundle["dataset"]["genes"]))
        self.assertEqual(bundle["split"]["assignments"], recipe.assignments)
        self.assertEqual(sum(audit["row_dispositions"].values()), len(table.cells))
        self.assertEqual(audit["row_dispositions"]["qc_excluded"], 1)
        self.assertEqual(audit["row_dispositions"]["condition_not_selected"], 80)
        self.assertTrue(audit["feature_fit_control_included"])
        self.assertEqual(len(bundle["dataset"]["genes"]), RULES["feature_count"])
        self.assertTrue(validate_dataset(bundle["dataset"]).startswith("sha256:"))
        evaluation = evaluate(bundle["dataset"], bundle["spec"], bundle["split"])
        self.assertEqual(len(evaluation["models"]), 3)
        self.assertFalse(evaluation["blind"])
        sizes = artifact_sizes(bundle)
        self.assertLess(sizes["import_envelope_bytes"], sizes["http_max_bytes"])
        # Alter ONLY held-out counts; normalized held-out values change, feature fit cannot.
        altered = fixture_matrix(table).tolil()
        heldout = set(recipe.assignments["test"] + recipe.assignments["validation"])
        for index, cell in enumerate(table.cells):
            if cell.perturbation in heldout:
                altered[index, -1] = 10**8
        other = CellTable(table.genes, table.cells, CSCCounts.from_sparse(altered))
        other_bundle, other_audit = prepare_cells(other, recipe)
        self.assertEqual(other_bundle["dataset"]["genes"], bundle["dataset"]["genes"])
        self.assertEqual(other_audit["feature_fit_cells"], audit["feature_fit_cells"])
        self.assertNotEqual(other_bundle["dataset"], bundle["dataset"])

    def test_qc_exclusions_and_insufficient_support_do_not_silently_relax_recipe(self):
        table, inspected, mapping = synthetic_source()
        counts = fixture_matrix(table).tolil()
        counts[0, :] = 0
        cells = list(table.cells)
        cells[1] = Cell("bad", "control", "synthetic_control", "batch1", False, 2)
        changed = inspect_cells(CellTable(table.genes, tuple(cells), CSCCounts.from_sparse(counts)))
        self.assertEqual(changed["qc_exclusion_counts_overlapping"], {
            "bad_coverage": 1, "not_single_cell": 1, "unassigned_guide": 1, "zero_library": 1})
        insufficient = sealed({**inspected, "cells": changed})
        self.assert_invalid("reviewed_control_low_support", FrozenRecipe.freeze, insufficient, mapping, 0.05)

    def test_recipe_and_input_transport_limits_are_enforced(self):
        table, inspected, mapping = synthetic_source()
        recipe = FrozenRecipe.freeze(inspected, mapping, 0.05)
        altered = copy.deepcopy(recipe.document)
        altered["rules"]["feature_count"] = 5
        self.assert_invalid("recipe_protocol_mismatch", FrozenRecipe.read, sealed(altered))
        bundle, _ = prepare_cells(table, recipe)
        bundle["spec"]["oversize"] = '"' * (9 * 1024 * 1024)
        self.assert_invalid("web_bundle_bytes_limit", artifact_sizes, bundle)

    def test_old_inspection_rejects_changed_scientific_dependency(self):
        # A synthetic snapshot of identity metadata, not a claim of source download.
        manifest = json.loads(SOURCE_MANIFEST.read_text())
        snapshot = {"source": {"manifest": manifest, "manifest_digest": digest(manifest),
                               "md5": manifest["md5"], "bytes": manifest["bytes"], "sha256": manifest["sha256"]},
                    "implementation": implementation()}
        check_inspection(sealed(snapshot))
        for filename in ("contract.py", "dataset.py", "split.py"):
            with self.subTest(filename=filename):
                old = copy.deepcopy(snapshot)
                old["implementation"]["apps/virtual-cell/backend/" + filename] = "0" * 64
                self.assert_invalid("preparation_code_changed", check_inspection, sealed(old))

    def test_cli_help_and_no_overwrite_need_no_h5ad(self):
        help_result = subprocess.run([sys.executable, str(TOOLS / "prepare.py"), "--help"], capture_output=True, text=True)
        self.assertEqual(help_result.returncode, 0, help_result.stderr)
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run([sys.executable, str(TOOLS / "prepare.py"), "inspect", "--source", "absent.h5ad", "--out", folder],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(json.loads(result.stderr)["error"], "output_exists")
            self.assertFalse(list(Path(folder).iterdir()))


if __name__ == "__main__":
    unittest.main()
