"""App-local immutable artifacts. Host owns the process, proxy and data root.

No arbitrary paths, commands, downloads, task store or scientific acceptance.
The four operations call the same domain functions as the CLI.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import platform
import tempfile
import threading

from candidates import propose
from contract import Invalid, canonical, digest
from evaluation import evaluate, test_queries
from split import check_split, freeze_split

MAX_BODY = 16 * 1024 * 1024
MAX_VALUES = 2_000_000
IDENTITY = re.compile(r"^[a-f0-9]{64}$")
OPERATIONS = ("split", "queries", "evaluate", "candidates")


class Workbench:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        backend = Path(__file__).parent
        self.source = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                       for p in sorted(backend.glob("*.py"))}

    def put(self, value):
        body = canonical(value)
        identity = hashlib.sha256(body).hexdigest()
        target = self.root / (identity + ".json")
        if not target.exists():
            fd, name = tempfile.mkstemp(dir=self.root, prefix=".artifact-")
            try:
                with os.fdopen(fd, "wb") as handle:
                    handle.write(body)
                os.replace(name, target)  # same ID always has the same bytes
            finally:
                Path(name).unlink(missing_ok=True)
        return identity

    def read(self, identity):
        if not isinstance(identity, str) or not IDENTITY.fullmatch(identity):
            raise Invalid("artifact_id_invalid")
        try:
            body = (self.root / (identity + ".json")).read_bytes()
        except FileNotFoundError:
            raise Invalid("artifact_missing") from None
        if hashlib.sha256(body).hexdigest() != identity:
            raise Invalid("artifact_digest_mismatch")
        return json.loads(body)

    def import_bundle(self, bundle):
        if not isinstance(bundle, dict) or not {"dataset", "spec"} <= bundle.keys() or not set(bundle) <= {"dataset", "spec", "split", "predictions", "plan"}:
            raise Invalid("bundle_fields")
        data = bundle["dataset"]
        if not isinstance(data, dict):
            raise Invalid("dataset_schema")
        # Bound the HTTP adapter's CPU/memory exposure, including stratum means.
        genes, conditions = data.get("genes"), data.get("conditions")
        if not isinstance(genes, list) or not isinstance(conditions, list):
            raise Invalid("dataset_schema")
        strata = sum(len(c.get("strata", [])) for c in conditions if isinstance(c, dict) and isinstance(c.get("strata", []), list))
        if len(genes) * (len(conditions) * 2 + strata) > MAX_VALUES:
            raise Invalid("web_dataset_limit", MAX_VALUES)
        predictions = bundle.get("predictions", [])
        if not isinstance(predictions, list) or len(predictions) > 8:
            raise Invalid("web_prediction_limit")
        split = freeze_split(data, bundle["spec"])
        if "split" in bundle:
            check_split(data, bundle["spec"], bundle["split"])
        normalized = {**bundle, "split": split, "predictions": predictions}
        identity = self.put({"kind": "inputs", "bundle": normalized})
        return self.describe(identity, normalized)

    def import_documents(self, documents):
        # Keep original JSON number types. JavaScript JSON.parse/stringify turns
        # Python's 1.0 into 1, invalidating pinned dataset/spec digests.
        if not isinstance(documents, list) or not 1 <= len(documents) <= 12 or not all(isinstance(d, str) for d in documents):
            raise Invalid("documents_required")
        bundle, predictions = {}, []
        schemas = {"point.virtual-cell.condition-means.v1": "dataset", "point.virtual-cell.task-spec.v1": "spec",
                   "point.virtual-cell.split.v1": "split", "point.virtual-cell.candidate-plan.v1": "plan"}
        for text in documents:
            doc = json.loads(text)
            if not isinstance(doc, dict):
                raise Invalid("document_invalid")
            if "dataset" in doc and "spec" in doc:
                fields = doc
            elif doc.get("schema") == "point.virtual-cell.predictions.v1":
                predictions.append(doc)
                continue
            elif doc.get("schema") in schemas:
                fields = {schemas[doc["schema"]]: doc}
            else:
                raise Invalid("document_schema")
            if bundle.keys() & fields.keys():
                raise Invalid("duplicate_input_document")
            bundle.update(fields)
        if predictions:
            if "predictions" in bundle:
                raise Invalid("duplicate_input_document")
            bundle["predictions"] = predictions
        return self.import_bundle(bundle)

    def describe(self, identity, bundle):
        return {"id": identity, "source": bundle["dataset"]["source"],
                "genes": len(bundle["dataset"]["genes"]), "conditions": len(bundle["dataset"]["conditions"]),
                "datasetDigest": bundle["split"]["dataset_digest"], "specDigest": bundle["split"]["spec_digest"],
                "splitDigest": bundle["split"]["digest"], "counts": bundle["split"]["counts"],
                "hasPlan": "plan" in bundle, "predictions": len(bundle["predictions"])}

    def catalog(self):
        items = []
        for file in sorted(self.root.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True):
            doc = self.read(file.stem)
            if doc.get("kind") == "inputs":
                items.append(self.describe(file.stem, doc["bundle"]))
            if len(items) >= 100:
                break
        return {"items": items, "limit": 100}

    def execute(self, identity, operation):
        if operation not in OPERATIONS:
            raise Invalid("operation_invalid")
        doc = self.read(identity)
        if doc.get("kind") != "inputs":
            raise Invalid("input_artifact_required")
        b = doc["bundle"]
        data, spec, split = b["dataset"], b["spec"], b["split"]
        check_split(data, spec, split)
        # Serialized bounded, deterministic computation; no background retry loop.
        with self.lock:
            if operation == "split":
                result = split
            elif operation == "queries":
                result = {"split_digest": split["digest"], "genes": data["genes"], "scale": data["scale"],
                          "aggregation": "equal_batch", "isolation": "unverified",
                          "queries": {cid: list(t) for cid, t in test_queries(data, split).items()}}
            elif operation == "evaluate":
                result = evaluate(data, spec, split, b["predictions"])
            else:
                if "plan" not in b:
                    raise Invalid("candidate_plan_required")
                result = propose(data, spec, split, b["plan"])
            output = {"kind": "output", "inputId": identity, "operation": operation,
                      "sourceHashes": self.source, "result": result,
                      "environment": {"python": platform.python_version(), "system": platform.system(), "machine": platform.machine()},
                      "scope": "app_local", "isolation": "unverified", "acceptance": "not_reviewed"}
            output_id = self.put(output)
        return {"id": output_id, **output}
