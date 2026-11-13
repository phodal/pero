"""Fixed local entry points: split, queries, evaluation and candidate proposal.

No user code, shell, URL or model download. Inputs are local JSON artifacts;
outputs are new files and an existing output is never overwritten, because a
frozen split or evaluation is immutable once referenced.
"""
import argparse
from dataclasses import replace
import json
from pathlib import Path
import sys

from contract import Invalid, canonical
from candidates import propose
from evaluation import ComparisonInputs, compare, evaluate, test_queries
from split import check_split, freeze_split

MAX_INPUT_BYTES = 512 * 1024 * 1024


def load(path):
    file = Path(path)
    if file.stat().st_size > MAX_INPUT_BYTES:
        raise Invalid("input_too_large", path)
    return json.loads(file.read_text(encoding="utf-8"))


def write_new(path, value):
    with open(path, "xb") as handle:  # fails if the artifact already exists
        handle.write(canonical(value) + b"\n")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="virtual-cell")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("split", "queries", "evaluate", "candidates"):
        command = commands.add_parser(name)
        command.add_argument("--dataset", required=True)
        command.add_argument("--spec", required=True)
        if name != "split":
            command.add_argument("--split", required=True)
        if name == "evaluate":
            command.add_argument("--predictions", action="append", default=[])
        if name == "candidates":
            command.add_argument("--plan", required=True)
        command.add_argument("--out", required=True)
    command = commands.add_parser("compare")
    command.add_argument("--bundle", required=True, help="Frozen input bundle or exported local comparison")
    command.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "compare":
            document = load(args.bundle)
            bundle = document.get("bundle", document) if isinstance(document, dict) else document
            inputs = ComparisonInputs.parse_bundle(bundle)
            endpoint = document.get("run", {}).get("modelEndpoint")
            if endpoint:
                # Offline rerun needs no live endpoint. Recompute its declared
                # CPU baseline from frozen training inputs under the same ID.
                from baselines import run_baseline
                from contract import sealed
                from dataset import training_view
                from model_endpoint import MODEL
                if endpoint.get("model") != MODEL:
                    raise Invalid("comparison_model_unsupported")
                prediction = run_baseline("additive", inputs.split, training_view(inputs.dataset, inputs.split), test_queries(inputs.dataset, inputs.split))
                prediction = sealed({**prediction, "model": {**endpoint["model"], "kind": "empirical_baseline"}})
                inputs = replace(inputs, predictions=(*inputs.predictions, prediction))
            comparison = compare(inputs)
            result = {"evaluation": comparison.evaluation, "predictions": [*comparison.predictions, *([prediction] if endpoint else [])]}
        else:
            dataset, spec = load(args.dataset), load(args.spec)
        if args.command == "split":
            result = freeze_split(dataset, spec)
        elif args.command != "compare":
            split = load(args.split)
            if args.command == "queries":
                check_split(dataset, spec, split)
                result = {"split_digest": split["digest"], "genes": dataset["genes"], "scale": dataset["scale"],
                          "aggregation": "equal_batch", "isolation": "unverified",
                          "queries": {cid: list(t) for cid, t in test_queries(dataset, split).items()}}
            elif args.command == "candidates":
                result = propose(dataset, spec, split, load(args.plan))
            else:
                result = evaluate(dataset, spec, split, [load(p) for p in args.predictions])
        write_new(args.out, result)
    except Invalid as error:
        print(json.dumps({"error": error.code, "detail": error.detail}), file=sys.stderr)
        return 2
    except FileExistsError:
        print(json.dumps({"error": "output_exists"}), file=sys.stderr)
        return 2
    print(json.dumps({"out": args.out, "digest": result.get("digest")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
