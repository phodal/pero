"""Independent, stdlib-only check of an exported comparison's delta-MSE evidence.

No production evaluator, baseline or input-contract module is imported. This
checks recorded numerical consistency, not model correctness, preprocessing,
biological validity, execution isolation, uncertainty or scientific acceptance.
"""
import argparse
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys

CHECK_SCHEMA = "pero.virtual-cell.comparison-check.v1"
CHECKER = "virtual-cell.delta-mse-check.v1"
EXPORT_SCHEMA = "pero.virtual-cell.local-comparison-export.v1"
LIMITATIONS = [
    "Checks delta-MSE and its denominator/summary against recorded predictions and frozen condition means only.",
    "Does not independently regenerate model predictions or validate biological data, preprocessing, blind isolation, uncertainty or scientific acceptance.",
    "Other reported metrics and scientific claims are outside this check.",
]


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def digest(value):
    return "sha256:" + hashlib.sha256(canonical(value)).hexdigest()


class CheckFailed(ValueError):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code, self.detail = code, detail


def require(condition, code, detail):
    if not condition:
        raise CheckFailed(code, detail)


def sealed_digest(document, label):
    require(isinstance(document, dict), "integrity", f"{label} must be an object")
    actual = digest({key: value for key, value in document.items() if key != "digest"})
    require(document.get("digest") == actual, "integrity", f"{label} digest differs from its content")
    return actual


def vector(value, width, label):
    require(isinstance(value, list) and len(value) == width and all(
        isinstance(number, (int, float)) and not isinstance(number, bool) and math.isfinite(number)
        for number in value), "supported_input", f"{label} must contain {width} finite numbers")
    return tuple(float(number) for number in value)


def close(actual, expected):
    return (isinstance(actual, (int, float)) and not isinstance(actual, bool)
            and math.isfinite(actual) and math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-12))


@dataclass(frozen=True)
class ComparisonEvidence:
    """The admitted artifact values needed by this bounded numerical check."""
    test_ids: tuple
    means: dict
    control: tuple
    predictions: dict
    models: tuple

    @classmethod
    def parse(cls, document):
        require(isinstance(document, dict) and document.get("schema") == EXPORT_SCHEMA,
                "supported_input", "Expected a Virtual Cell local-comparison export v1")
        run, bundle, output = document["run"], document["bundle"], document["output"]
        require(run["status"] == "succeeded" and run["process"]["exitObserved"] is True
                and run["process"]["exitCode"] == 0 and isinstance(output, dict),
                "execution_evidence", "A successful observed process and its output are required")
        input_id = hashlib.sha256(canonical({"kind": "inputs", "bundle": bundle})).hexdigest()
        output_id = hashlib.sha256(canonical(output)).hexdigest()
        require(run["inputId"] == input_id == output["inputId"] and run["outputId"] == output_id,
                "artifact_bindings", "Run input/output identities differ from the exported artifacts")
        data, spec, split, result = bundle["dataset"], bundle["spec"], bundle["split"], output["result"]
        require(data["schema"] == "point.virtual-cell.condition-means.v1"
                and spec["schema"] == "point.virtual-cell.task-spec.v1"
                and split["schema"] == "point.virtual-cell.split.v1"
                and result["schema"] == "point.virtual-cell.evaluation.v1"
                and result["method"] == "virtual-cell.evaluation.v1"
                and result["primary"] == spec["evaluation"]["primary"] == "delta_mse"
                and result["aggregate"] == spec["evaluation"]["aggregate"] == "median"
                and result["aggregation"] == "equal_batch"
                and data["scale"] in ("counts_mean", "log1p_cp10k", "log1p_cpm"),
                "supported_input", "Only v1 condition means with equal-batch delta-MSE/median are supported")
        dataset_digest, spec_digest = digest(data), digest(spec)
        split_digest = sealed_digest(split, "split")
        sealed_digest(result, "evaluation")
        require(spec["dataset"]["digest"] == split["dataset_digest"] == result["dataset_digest"] == dataset_digest
                and split["spec_digest"] == result["spec_digest"] == spec_digest
                and result["split_digest"] == split_digest,
                "artifact_bindings", "Dataset, spec, split and evaluation references do not agree")
        genes = data["genes"]
        require(isinstance(genes, list) and genes and all(isinstance(gene, str) for gene in genes)
                and len(set(genes)) == len(genes), "supported_input", "Unique ordered genes are required")
        width = len(genes)
        means = {}
        for condition in data["conditions"]:
            identity = condition["id"]
            require(isinstance(identity, str) and identity not in means, "supported_input", "Condition IDs must be unique")
            mean = vector(condition["mean"], width, identity)
            strata = condition["strata"]
            require(isinstance(strata, list) and strata, "supported_input", "Condition strata are required")
            rows = [vector(row["mean"], width, identity + " stratum") for row in strata]
            # The recorded mean is the equal-batch estimand. Re-pooling by cell
            # counts would silently change it. The adapter rounds to 6 decimals.
            require(all(abs(mean[index] - sum(row[index] for row in rows) / len(rows)) <= 1.1e-6
                        for index in range(width)), "equal_batch_means", f"{identity} differs from its recorded equal-batch strata")
            means[identity] = mean
        control = means[data["control"]]
        test_ids = split["assignments"]["test"]
        require(isinstance(test_ids, list) and test_ids and all(isinstance(value, str) for value in test_ids)
                and len(set(test_ids)) == len(test_ids) and set(test_ids) <= means.keys(),
                "supported_input", "Unique nonempty held-out condition IDs must have recorded means")
        require(result["denominators"] == {**split["counts"], "excluded": split["excluded"]},
                "denominators", "Evaluation does not retain the frozen split denominators")
        prediction_docs = [*output["predictions"], *bundle.get("predictions", [])]
        predictions = {}
        for prediction in prediction_docs:
            identity = prediction["model"]["id"]
            require(isinstance(identity, str) and identity not in predictions,
                    "supported_input", "Prediction model IDs must be unique")
            sealed_digest(prediction, "prediction " + identity)
            require(prediction["schema"] == "point.virtual-cell.predictions.v1"
                    and prediction["output"] == "condition_mean" and prediction["aggregation"] == "equal_batch"
                    and prediction["split_digest"] == split_digest and prediction["genes"] == genes
                    and prediction["scale"] == data["scale"],
                    "prediction_alignment", f"{identity} has unsupported or misaligned predictions")
            rows = prediction["conditions"]
            require(isinstance(rows, list) and all(isinstance(row["id"], str) for row in rows)
                    and len({row["id"] for row in rows}) == len(rows)
                    and {row["id"] for row in rows} <= set(test_ids),
                    "prediction_alignment", f"{identity} prediction conditions differ from held-out IDs")
            predictions[identity] = prediction
        endpoint = run.get("modelEndpoint")
        if endpoint is not None:
            require(isinstance(endpoint, dict) and endpoint["inputId"] == input_id
                    and endpoint["source"] in ("local", "remote")
                    and any(endpoint["predictionDigest"] == prediction["digest"]
                            and endpoint["model"] == {key: prediction["model"][key] for key in ("id", "version")}
                            for prediction in output["predictions"]),
                    "model_endpoint_binding", "Endpoint provenance differs from its frozen input or output prediction")
        models = result["models"]
        require(isinstance(models, list) and models and len({entry["model"]["id"] for entry in models}) == len(models)
                and {entry["model"]["id"] for entry in models} == predictions.keys(),
                "prediction_alignment", "Evaluation models differ from exported prediction evidence")
        return cls(tuple(test_ids), means, control, predictions, tuple(models))

    def check_metrics(self):
        for model in self.models:
            identity = model["model"]["id"]
            prediction = self.predictions[identity]
            require(model["model"] == prediction["model"] and model["predictions_digest"] == prediction["digest"],
                    "prediction_alignment", f"{identity} evaluation references a different prediction")
            predicted = {row["id"]: row["mean"] for row in prediction["conditions"]}
            results = model["conditions"]
            require(isinstance(results, list) and len(results) == len(self.test_ids)
                    and {row["id"] for row in results} == set(self.test_ids),
                    "denominators", f"{identity} must retain every held-out condition exactly once")
            values = []
            for row in results:
                condition = row["id"]
                mean = predicted.get(condition)
                if mean is None or len(mean) != len(self.control):
                    reason = "prediction_missing" if mean is None else "prediction_gene_count"
                    require(row["status"] == "failed" and row["reason"] == reason,
                            "denominators", f"{identity}/{condition} missing or incomplete prediction was not counted as failed")
                    continue
                mean = vector(mean, len(self.control), identity + "/" + condition)
                truth = self.means[condition]
                # Recompute the declared deltas independently; do not trust a
                # precomputed per-condition or aggregate metric in the export.
                mse = sum(((p - c) - (t - c)) ** 2 for p, t, c in zip(mean, truth, self.control)) / len(truth)
                require(row["status"] == "evaluated" and close(row["delta_mse"], mse),
                        "delta_mse", f"{identity}/{condition} delta-MSE differs from its frozen readout and prediction")
                values.append(mse)
            require(model["denominator"] == {"attempted": len(self.test_ids), "evaluated": len(values),
                                              "failed": len(self.test_ids) - len(values)},
                    "denominators", f"{identity} attempted/evaluated/failed counts differ")
            summary = model["delta_mse"]
            require(summary["n"] == len(values) and (all(summary[key] is None for key in ("median", "mean"))
                    if not values else close(summary["median"], statistics.median(values))
                    and close(summary["mean"], statistics.fmean(values))),
                    "delta_mse_summary", f"{identity} delta-MSE summary differs from its condition values")


def check_export(document):
    """Return a sealed PASS/FAIL receipt; unsupported/malformed inputs fail closed."""
    checks = []
    subject = {"inputId": None, "outputId": None, "exportDigest": None}
    try:
        export_content = document
        if isinstance(document, dict) and isinstance(document.get("run"), dict):
            # A saved receipt is a later observation of this same execution;
            # including it would make repeated checks refer to themselves.
            export_content = {**document, "run": {key: value for key, value in document["run"].items() if key != "check"}}
            subject.update({key: document["run"].get(key) for key in ("inputId", "outputId")})
        subject["exportDigest"] = digest(export_content)
        evidence = ComparisonEvidence.parse(document)
        checks.append({"id": "artifact_bindings_and_equal_batch_inputs", "status": "PASS"})
        evidence.check_metrics()
        checks.append({"id": "delta_mse_and_denominators", "status": "PASS"})
    except CheckFailed as error:
        checks.append({"id": error.code, "status": "FAIL", "detail": error.detail})
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        checks.append({"id": "supported_input", "status": "FAIL", "detail": "Malformed or unsupported export: " + str(error)})
    receipt = {"schema": CHECK_SCHEMA, "checker": CHECKER,
               "status": "FAIL" if any(check["status"] == "FAIL" for check in checks) else "PASS",
               "scope": "numerical_consistency", "checkedMetrics": ["delta_mse"],
               "limitations": LIMITATIONS, "subject": subject, "checks": checks}
    return {**receipt, "digest": digest(receipt)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", required=True, dest="source")
    parser.add_argument("--out", required=True, help="New receipt file; existing files are never overwritten")
    args = parser.parse_args(argv)
    receipt = check_export(json.loads(Path(args.source).read_text(encoding="utf-8")))
    with open(args.out, "xb") as stream:
        stream.write(canonical(receipt) + b"\n")
    print(json.dumps({"status": receipt["status"], "digest": receipt["digest"], "out": args.out}))
    return 0 if receipt["status"] == "PASS" else 2


if __name__ == "__main__":
    sys.exit(main())
