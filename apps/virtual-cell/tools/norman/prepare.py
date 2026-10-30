#!/usr/bin/env python3
"""Offline inspect -> reviewed mapping -> frozen recipe -> prepared JSON bundle."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import sys

HERE = Path(__file__).resolve().parent
SOURCE_MANIFEST = HERE.parents[1] / "backend" / "data_sources" / "norman.json"
sys.path.insert(0, str(HERE.parents[1] / "backend"))
from cli import MAX_INPUT_BYTES, load, write_new
from contract import Invalid, canonical, check_sealed, digest, sealed
from workbench import MAX_BODY, MAX_VALUES


def source_identity(path):
    manifest = json.loads(SOURCE_MANIFEST.read_text())
    if path.stat().st_size != manifest["bytes"]:
        raise Invalid("source_size_mismatch", {"expected": manifest["bytes"], "actual": path.stat().st_size})
    md5, sha = hashlib.md5(), hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            md5.update(chunk)
            sha.update(chunk)
    if md5.hexdigest() != manifest["md5"]:
        raise Invalid("source_md5_mismatch", md5.hexdigest())
    if sha.hexdigest() != manifest["sha256"]:
        raise Invalid("source_sha256_mismatch", sha.hexdigest())
    return {"manifest": manifest, "manifest_digest": digest(manifest), "bytes": path.stat().st_size,
            "md5": md5.hexdigest(), "sha256": sha.hexdigest()}


def implementation():
    app = HERE.parents[1]
    paths = [*HERE.glob("*.py"), *(app / "backend" / name for name in ("contract.py", "dataset.py", "split.py"))]
    return {str(p.relative_to(HERE.parents[3])): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}


def read_source(path):
    try:
        import anndata
        import numpy as np
        import pandas as pd
        from transform import Cell, CellTable
        from counts import CSCCounts
    except ImportError as error:
        raise Invalid("preparation_dependency_missing", "Use a separate preparation environment with numpy, scipy, pandas, h5py and anndata; App runtime is unchanged. " + str(error)) from None
    source = source_identity(path)
    adata = anndata.read_h5ad(path, backed="r")
    try:
        required = ("perturbation", "guide_id", "gemgroup", "good_coverage", "number_of_cells")
        missing = sorted(set(required) - set(adata.obs.columns))
        if missing:
            raise Invalid("source_obs_fields_missing", missing)
        if "X" not in adata.file:
            raise Invalid("source_X_required")
        counts = CSCCounts.from_hdf5(adata.file["X"])
        cells = []
        for barcode, row in zip(adata.obs_names, adata.obs.loc[:, required].itertuples(index=False, name=None)):
            perturbation, guide, batch, coverage, n_cells = row
            labels = []
            for value in (perturbation, guide):
                if pd.isna(value):
                    labels.append("")
                elif isinstance(value, str):
                    labels.append(value)
                else:
                    raise Invalid("source_label_type", type(value).__name__)
            if not isinstance(barcode, str) or pd.isna(batch) or isinstance(batch, (bool, np.bool_)):
                raise Invalid("source_identity_type")
            if not isinstance(batch, (str, int, np.integer)):
                raise Invalid("source_batch_type", type(batch).__name__)
            if not isinstance(coverage, (bool, np.bool_, int, np.integer, float, np.floating)) or coverage not in (0, 1):
                raise Invalid("source_coverage_type", str(coverage))
            if (isinstance(n_cells, (bool, np.bool_)) or not isinstance(n_cells, (int, np.integer, float, np.floating))
                    or not np.isfinite(n_cells) or n_cells != int(n_cells)):
                raise Invalid("source_number_of_cells_type", str(n_cells))
            cells.append(Cell(barcode, *labels, str(batch), bool(coverage), int(n_cells)))
        table = CellTable(tuple(adata.var_names), tuple(cells), counts)
        environment = {name: importlib.metadata.version(name) for name in ("numpy", "scipy", "pandas", "h5py", "anndata")}
        environment["python"] = platform.python_version()
        return adata, table, source, environment
    except BaseException:
        adata.file.close()
        raise


def inspection_document(table, source, environment):
    from transform import VERSION, inspect_cells
    return sealed({"schema": "pero.virtual-cell.norman-inspection.v1", "tool": VERSION,
                   "source": source, "environment": environment, "implementation": implementation(),
                   "cells": inspect_cells(table)})


def check_inspection(document):
    check_sealed(document, "inspection_digest_mismatch")
    manifest = json.loads(SOURCE_MANIFEST.read_text())
    source = document.get("source", {})
    if (source.get("manifest") != manifest or source.get("manifest_digest") != digest(manifest)
            or source.get("md5") != manifest["md5"] or source.get("bytes") != manifest["bytes"]
            or source.get("sha256") != manifest["sha256"]):
        raise Invalid("inspection_source_mismatch")
    sha = source.get("sha256", "")
    if len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
        raise Invalid("inspection_source_sha256_required")
    if document.get("implementation") != implementation():
        raise Invalid("preparation_code_changed", "Re-inspect and review a new recipe before evaluation")


def artifact_sizes(bundle):
    data = bundle["dataset"]
    values = len(data["genes"]) * (2 * len(data["conditions"]) + sum(len(c["strata"]) for c in data["conditions"]))
    if values > MAX_VALUES:
        raise Invalid("web_dataset_limit", {"actual": values, "maximum": MAX_VALUES})
    encoded = canonical(bundle) + b"\n"
    # Import transports original JSON text inside documents[], including escaping.
    envelope = canonical({"documents": [encoded.decode("utf-8")]})
    if max(len(encoded), len(envelope)) > MAX_BODY:
        raise Invalid("web_bundle_bytes_limit", {"bundle": len(encoded), "envelope": len(envelope), "maximum": MAX_BODY})
    sizes = {name: len(canonical(value)) + 1 for name, value in bundle.items()}
    if max(sizes.values()) > MAX_INPUT_BYTES:
        raise Invalid("cli_input_bytes_limit")
    return {"numeric_values": values, "bundle_bytes": len(encoded), "import_envelope_bytes": len(envelope),
            "document_bytes": sizes, "http_max_bytes": MAX_BODY, "cli_max_bytes": MAX_INPUT_BYTES}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("inspect", "freeze", "prepare"):
        command = sub.add_parser(name)
        command.add_argument("--out", type=Path, required=True, help="New output directory; never overwritten")
        if name in ("inspect", "prepare"):
            command.add_argument("--source", type=Path, required=True, help="Already-downloaded pinned H5AD; no network access")
        if name == "freeze":
            command.add_argument("--inspection", required=True)
            command.add_argument("--mapping", required=True)
            command.add_argument("--min-skill", type=float, required=True, help="Researcher-declared threshold before evaluation; no default")
        if name == "prepare":
            command.add_argument("--recipe", required=True)
    args = parser.parse_args(argv)
    if args.out.exists():
        print(json.dumps({"error": "output_exists", "detail": str(args.out)}), file=sys.stderr)
        return 2
    args.out.mkdir(parents=True)
    adata = None
    try:
        try:
            from transform import FrozenRecipe, prepare_cells
        except ImportError as error:
            raise Invalid("preparation_dependency_missing", "Preparation only requires numpy/scipy; inspect/prepare also require pandas/h5py/anndata. " + str(error)) from None
        if args.command == "freeze":
            inspected = load(args.inspection)
            check_inspection(inspected)
            recipe = FrozenRecipe.freeze(inspected, load(args.mapping), args.min_skill)
            write_new(args.out / "recipe.json", recipe.document)
            result = {"recipe_digest": recipe.document["digest"], "selected_conditions": len(recipe.selected),
                      "assignments": recipe.assignments, "status": "frozen_not_evaluated"}
        else:
            recipe = FrozenRecipe.read(load(args.recipe)) if args.command == "prepare" else None
            if recipe:
                check_inspection(recipe.inspection)
            adata, table, source, environment = read_source(args.source)
            inspected = inspection_document(table, source, environment)
            write_new(args.out / "inspection.json", inspected)
            if args.command == "inspect":
                template = [{"perturbation": row["perturbation"], "guide_id": row["guide_id"],
                             "kind": "REVIEW_REQUIRED", "targets": [], "evidence": ""}
                            for row in inspected["cells"]["inventory"]]
                write_new(args.out / "mapping-template.json", template)
                result = {"inspection_digest": inspected["digest"], "status": "mapping_review_required"}
            else:
                if inspected != recipe.inspection:
                    raise Invalid("source_inspection_changed", "Source, metadata, environment or preparation code changed")
                bundle, audit = prepare_cells(table, recipe)
                sizes = artifact_sizes(bundle)
                for name, value in bundle.items():
                    write_new(args.out / (name + ".json"), value)
                write_new(args.out / "bundle.json", bundle)
                write_new(args.out / "recipe.json", recipe.document)
                audit = sealed({**audit, "source": source, "environment": environment, "implementation": implementation(),
                                "recipe_digest": recipe.document["digest"], "sizes": sizes,
                                "artifact_digests": {name: digest(value) for name, value in bundle.items()},
                                "bundle_digest": digest(bundle), "scope": "non_blind_scperturb_derived_demonstration"})
                write_new(args.out / "audit.json", audit)
                result = {"status": "prepared_not_evaluated", "audit_digest": audit["digest"], **sizes}
        write_new(args.out / "status.json", result)
        print(json.dumps({"out": str(args.out), **result}))
        return 0
    except (Invalid, OSError, ValueError, KeyError, TypeError) as error:
        result = {"status": "failed", "error": error.code if isinstance(error, Invalid) else type(error).__name__,
                  "detail": error.detail if isinstance(error, Invalid) else str(error)}
        write_new(args.out / "failure.json", result)
        print(json.dumps(result), file=sys.stderr)
        return 2
    finally:
        if adata is not None:
            adata.file.close()


if __name__ == "__main__":
    sys.exit(main())
