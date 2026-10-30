"""Prepared Sample data for Desktop acceptance, never public Norman evidence.

Reuses the scientific fixture without changing it. All files pass through the
normal UI import; no server, process substitution or artificial delay is used.
"""
import copy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps/virtual-cell/test"))
import fixture
from baselines import run_baseline
from contract import canonical, digest, sealed
from dataset import training_view
from evaluation import ComparisonInputs, test_queries
from split import freeze_split
from workbench import MAX_BODY, MAX_VALUES


def prepared(data):
    spec = fixture.spec(data)
    return {"dataset": data, "spec": spec, "split": freeze_split(data, spec)}


def generate(destination):
    destination.mkdir(parents=True, exist_ok=True)
    data = fixture.dataset()
    data["source"] = {"id": "synthetic-desktop-comparison-sample", "revision": "v1"}
    # Retain a predeclared low-coverage condition in the frozen exclusions.
    data["conditions"][-1]["cells"] = 5
    data["conditions"][-1]["strata"][0]["cells"] = 5
    data["conditions"][-1]["strata"][0]["guide_counts"]["synthetic"] = 5
    bundle = prepared(data)
    external = run_baseline("additive", bundle["split"], training_view(data, bundle["split"]),
                            test_queries(data, bundle["split"]))
    external["model"]["id"] = "sample-external"
    partial = copy.deepcopy(external)
    partial["conditions"].pop()
    incompatible = copy.deepcopy(external)
    incompatible["genes"].reverse()

    # Same bounded real-work fixture as test_comparisons, with a wider matrix
    # to expose the UI cancellation action. Remains below both Web budgets.
    large = fixture.dataset()
    large["source"] = {"id": "synthetic-desktop-cancellation-sample", "revision": "v1"}
    width = 18000
    large["genes"] += [f"extra-{i}" for i in range(width - len(large["genes"]))]
    for condition in large["conditions"]:
        for row, key in [(condition, "mean"), (condition, "pooled_mean"), (condition["strata"][0], "mean")]:
            row[key] = (row[key] * (width // len(row[key]) + 1))[:width]
    documents = {
        "prepared": bundle,
        "partial": {**bundle, "predictions": [sealed(partial)]},
        "incompatible": {**bundle, "predictions": [sealed(incompatible)]},
        "cancel": prepared(large),
    }
    manifest = {"label": "Sample data", "publicNormanValidation": False, "files": {}}
    for name, document in documents.items():
        ComparisonInputs.parse_bundle(document)
        body = canonical(document)
        request_bytes = len(canonical({"documents": [body.decode()]}))
        dataset = document["dataset"]
        values = len(dataset["genes"]) * (2 * len(dataset["conditions"]) + sum(len(c["strata"]) for c in dataset["conditions"]))
        assert request_bytes <= MAX_BODY, (name, request_bytes)
        assert values <= MAX_VALUES, (name, values)
        path = destination / (name + ".json")
        path.write_bytes(body)
        manifest["files"][name] = {"path": str(path), "bytes": len(body), "requestBytes": request_bytes,
                                   "meanValues": values, "digest": digest(body),
                                   "source": dataset["source"], "testIds": document["split"]["assignments"]["test"],
                                   "counts": document["split"]["counts"], "excluded": document["split"]["excluded"]}
    print(json.dumps(manifest))


if __name__ == "__main__":
    generate(Path(sys.argv[1]).resolve())
