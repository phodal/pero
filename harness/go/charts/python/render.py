"""Chart tool boundary. Uses the same value core as Data Agent; no App server."""
from __future__ import annotations
import json
from hashlib import sha256
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
from chart_document import ChartDocument, document_for_view
from dataset import Dataset, Invalid
from view import DatasetView


def render(value):
    if not isinstance(value, dict):
        raise Invalid("Supply a chart document or a dataset chart request")
    source = None
    if set(value) == {"document"}:
        document = ChartDocument.admit(value["document"]).json()
    elif set(value) <= {"dataset", "view", "chartDocument", "aggregation"} and {"dataset", "chartDocument"} <= set(value):
        supplied = value["dataset"]
        if not isinstance(supplied, dict) or set(supplied) != {"name", "content", "format"} or supplied["format"] not in ("json", "json_lines"):
            raise Invalid("Dataset needs name, content and json/json_lines format")
        dataset = Dataset.parse(supplied["content"], supplied["name"], supplied["format"] == "json_lines")
        view = DatasetView.admit(value.get("view", {}), dataset)
        document = document_for_view(dataset, view, value["chartDocument"], value.get("aggregation"))
        source = {"title": dataset.name, "text": dataset.source, "format": supplied["format"]}
    else:
        raise Invalid("Supply either document or dataset/chartDocument with optional view and aggregation")
    content = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    result = {"kind": "pero.chart.v1", "artifactId": sha256(content.encode()).hexdigest(), "content": content}
    if source is not None:
        result["sourceDocument"] = source
    return result


if __name__ == "__main__":
    try:
        value = json.loads(sys.stdin.read(2 * 1024 * 1024 + 1))
        output = json.dumps(render(value), ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        if len(output.encode()) > 4 * 1024 * 1024:
            raise Invalid("Chart receipt exceeds 4 MiB; reduce the plotted projection")
        print(output)
    except (Invalid, ValueError, TypeError, KeyError, OverflowError, RecursionError) as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
