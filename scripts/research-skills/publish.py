"""Write the packaged marketplace catalog. The review JSON stays in docs."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from catalog import runtime_catalog
from general import merge_catalog


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--input",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "docs/design-docs/research-skills-catalog.json",
    )
    parser.add_argument("--general", type=Path, default=Path(__file__).resolve().parents[2] / "docs/design-docs/general-skills-catalog.json")
    parser.add_argument("--research-only", action="store_true")
    args = parser.parse_args()
    document = json.loads(args.input.read_text(encoding="utf-8"))
    if not args.research_only:
        document = merge_catalog(document, json.loads(args.general.read_text(encoding="utf-8")))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(runtime_catalog(document), ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
