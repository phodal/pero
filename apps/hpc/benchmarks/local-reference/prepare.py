"""Create a self-contained, inspectable input and program bundle."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from definition import BenchmarkDefinition


def prepare_bundle(output: Path, definition_path: Path | None = None) -> dict:
    source = Path(__file__).resolve().parent
    definition_path = definition_path or source / "benchmark.json"
    definition = BenchmarkDefinition.admit(json.loads(definition_path.read_text()))
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError("Run directory must be empty; an existing run is never overwritten")
    for name in ("definition.py", "compute.py", "verify.py",
                 "reframe_check.py", "README.md"):
        shutil.copyfile(source / name, output / name)
    shutil.copyfile(definition_path, output / "benchmark.json")
    (output / "input.json").write_text(json.dumps(definition.input(), indent=2) + "\n")
    manifest = {"schemaVersion": 1, "benchmarkId": definition.id,
                "benchmarkVersion": definition.version, "executionKind": "local-reference",
                "files": {file.name: hashlib.sha256(file.read_bytes()).hexdigest()
                          for file in sorted(output.iterdir()) if file.is_file()}}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--definition", type=Path, help="Fixed benchmark definition; defaults to pi")
    args = parser.parse_args()
    print(json.dumps(prepare_bundle(args.output, args.definition)))
