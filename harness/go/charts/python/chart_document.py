"""Declarative chart documents, independent of any rendering surface."""
from __future__ import annotations
from dataclasses import dataclass
from decimal import Decimal
import math
import struct

from dataset import Chart, ChartSpec, Dataset, Invalid, Kind
from view import DatasetView


TYPES = ("line", "bar", "area", "pie", "radar", "candlestick", "sankey")
COMMON = {"type", "x", "xLabel", "yLabel"}
FIELDS = {
    "line": {"y", "series"}, "bar": {"y"}, "area": {"y"}, "pie": {"y"}, "radar": {"y"},
    "candlestick": {"open", "high", "low", "close"}, "sankey": {"target", "y"},
}


@dataclass(frozen=True)
class ChartMapping:
    kind: str
    fields: tuple[tuple[str, str], ...]

    @classmethod
    def admit(cls, value):
        if not isinstance(value, dict) or value.get("type") not in TYPES:
            raise Invalid("Choose a supported chart type")
        kind = value["type"]
        required = FIELDS[kind] - {"series"}
        if set(value) - (COMMON | FIELDS[kind]) or not ({"type", "x"} | required) <= set(value):
            raise Invalid("Chart fields do not match the selected chart type; series are not yet supported")
        fields = tuple((key, item) for key, item in value.items() if key != "type")
        if any(not isinstance(item, str) or not item.strip() or len(item) > 160 for _, item in fields):
            raise Invalid("Chart field names and labels must contain 1–160 characters")
        labels = {value for key, value in fields if key in ("x", "target", "series")}
        numbers = {value for key, value in fields if key in ("y", "open", "high", "low", "close")}
        if labels & numbers:
            raise Invalid("Label and value fields must be different")
        return cls(kind, fields)

    def get(self, name):
        return next((value for key, value in self.fields if key == name), None)

    def json(self):
        return {"type": self.kind, **dict(self.fields)}

    def validate_rows(self, rows):
        numeric = ("open", "high", "low", "close") if self.kind == "candlestick" else ("y",)
        labels = ("x", "target") if self.kind == "sankey" else ("x", "series") if self.get("series") else ("x",)
        edges, coordinates = [], set()
        for row in rows:
            for field in labels:
                value = row.get(self.get(field))
                if not isinstance(value, str) or not value.strip():
                    raise Invalid("Chart labels must be non-empty strings; missing values cannot be plotted")
            for field in numeric:
                name = self.get(field)
                if name not in row:
                    raise Invalid("Every chart row must contain its mapped fields")
                value = row[name]
                if self.kind == "line" and value is None:
                    continue
                try:
                    coordinate = float(value) if not isinstance(value, bool) else float("nan")
                except (TypeError, ValueError, OverflowError):
                    coordinate = float("nan")
                if not isinstance(value, (int, float)) or not math.isfinite(coordinate):
                    raise Invalid("Chart values must be finite numbers; missing values cannot be plotted")
                if self.kind in ("pie", "radar", "sankey") and value < 0:
                    raise Invalid("Pie, radar and Sankey chart values cannot be negative")
                if self.kind == "pie":
                    try:
                        pie_value = struct.unpack("f", struct.pack("f", coordinate))[0]
                    except OverflowError:
                        raise Invalid("Pie values must fit in a 32-bit float") from None
                    if not math.isfinite(pie_value) or (coordinate != 0 and pie_value == 0):
                        raise Invalid("Pie values must fit in a 32-bit float")
            if self.kind == "candlestick":
                o, h, l, c = (row[self.get(key)] for key in numeric)
                if l > min(o, c) or h < max(o, c) or l > h:
                    raise Invalid("Candlestick values require low ≤ open/close ≤ high")
            if self.kind == "sankey":
                coordinate = (row[self.get("x")], row[self.get("target")])
                edges.append(coordinate)
            else:
                coordinate = (row[self.get("x")], row[self.get("series")]) if self.get("series") else row[self.get("x")]
            if coordinate in coordinates:
                raise Invalid("Repeated chart coordinates cannot be represented distinctly; choose or aggregate the data explicitly")
            coordinates.add(coordinate)
        if self.kind == "sankey":
            graph = {}
            for origin, target in edges:
                graph.setdefault(origin, []).append(target)
            visited, visiting = set(), set()
            def visit(node):
                if node in visiting:
                    raise Invalid("Sankey links must not form a cycle")
                if node in visited:
                    return
                visiting.add(node)
                for target in graph.get(node, ()):
                    visit(target)
                visiting.remove(node)
                visited.add(node)
            try:
                for node in graph:
                    visit(node)
            except RecursionError:
                raise Invalid("The Sankey graph is too deep") from None
        if self.get("series") and len({row[self.get("series")] for row in rows}) > 5:
            raise Invalid("A line chart supports up to five distinct series")


@dataclass(frozen=True)
class ChartDocument:
    id: str
    title: str
    description: str
    mapping: ChartMapping
    rows: tuple[tuple[tuple[str, object], ...], ...]
    label: str
    caveats: tuple[str, ...]
    query_id: str = ""
    generated_at: str = ""
    executed_at: str = ""
    sql: str = ""

    @classmethod
    def admit(cls, value):
        allowed = {"schemaVersion", "id", "title", "description", "queryId", "generatedAt", "chart", "rows", "source"}
        if not isinstance(value, dict) or set(value) - allowed or type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 1:
            raise Invalid("Chart document must use schemaVersion 1 and supported fields")
        identity, title, description = value.get("id"), value.get("title"), value.get("description", "")
        if not isinstance(identity, str) or not identity.strip() or len(identity) > 128 or not isinstance(title, str) or not title.strip() or len(title) > 160 or not isinstance(description, str) or len(description) > 2048:
            raise Invalid("Chart document needs a valid id and title")
        mapping = ChartMapping.admit(value.get("chart"))
        rows = value.get("rows")
        if not isinstance(rows, list) or not 1 <= len(rows) <= 2000 or any(not isinstance(row, dict) for row in rows):
            raise Invalid("A chart needs 1–2,000 rows")
        for row in rows:
            if any(not isinstance(key, str) or not isinstance(item, (str, int, float, bool, type(None))) or isinstance(item, float) and not math.isfinite(item) for key, item in row.items()):
                raise Invalid("Chart rows must contain scalar JSON values")
        mapping.validate_rows(rows)
        source = value.get("source")
        if not isinstance(source, dict) or set(source) - {"label", "caveats", "executedAt", "sql"} or not isinstance(source.get("label"), str) or not source["label"].strip() or len(source["label"]) > 256:
            raise Invalid("A chart needs a source label; externally supplied provenance is a declaration")
        caveats = source.get("caveats", [])
        if not isinstance(caveats, list) or len(caveats) > 20 or any(not isinstance(item, str) or len(item) > 1000 for item in caveats):
            raise Invalid("Invalid source caveats")
        query_id, generated_at = value.get("queryId", ""), value.get("generatedAt", "")
        executed_at, sql = source.get("executedAt", ""), source.get("sql", "")
        if any(not isinstance(item, str) or len(item) > limit for item, limit in ((query_id, 128), (generated_at, 64), (executed_at, 64), (sql, 4096))):
            raise Invalid("Invalid chart source metadata")
        return cls(identity, title, description, mapping, tuple(tuple(row.items()) for row in rows), source["label"], tuple(caveats), query_id, generated_at, executed_at, sql)

    def json(self):
        result = {"schemaVersion": 1, "id": self.id, "title": self.title, "description": self.description,
                "chart": self.mapping.json(), "rows": [dict(row) for row in self.rows],
                "source": {"label": self.label, "caveats": list(self.caveats)}}
        for key, value in (("queryId", self.query_id), ("generatedAt", self.generated_at)):
            if value:
                result[key] = value
        for key, value in (("executedAt", self.executed_at), ("sql", self.sql)):
            if value:
                result["source"][key] = value
        return result


def document_for_view(dataset: Dataset, view: DatasetView, request, aggregation=None):
    if not isinstance(request, dict) or set(request) - {"title", "description", "chart"}:
        raise Invalid("A chart request needs a title and chart mapping")
    mapping = ChartMapping.admit(request.get("chart"))
    records = view.selection.apply(view.query.apply(dataset))
    if not 1 <= len(records) <= 2000:
        raise Invalid("Select 1–2,000 records to make a chart")
    omitted = excluded = 0
    if aggregation is not None:
        if not isinstance(aggregation, dict) or set(aggregation) != {"category", "measure", "aggregation"}:
            raise Invalid("Aggregation needs category, measure and aggregation")
        fields = {field.name for field in dataset.fields}
        if aggregation["category"] not in fields or aggregation["measure"] not in fields:
            raise Invalid("Choose valid aggregation fields")
        if mapping.get("x") != "label" or mapping.get("y") != "value" or mapping.kind not in ("line", "bar", "area", "pie", "radar"):
            raise Invalid("Aggregated charts use x=label and y=value")
        summary = Chart.calculate(records, ChartSpec(aggregation["category"], aggregation["measure"], aggregation["aggregation"]))
        rows = []
        for point in summary.points:
            exact_value = Decimal(point.exact)
            coordinate = float(exact_value)
            if not math.isfinite(coordinate) or (exact_value != 0 and coordinate == 0):
                raise Invalid("An aggregated value is outside the finite plotting range")
            rows.append({"label": point.label, "value": coordinate})
        exact = [point.exact for point in summary.points]
        omitted, excluded = summary.omitted_groups, summary.excluded_values
    else:
        names = {value for key, value in mapping.fields if key not in ("xLabel", "yLabel")}
        rows = []
        exact = []
        for record in records:
            row = {}
            for name in names:
                cell = record.cell(name)
                if cell is None:
                    raise Invalid("A chart field is missing; use an explicit null for a missing line observation")
                if cell.kind == Kind.NULL:
                    row[name] = None
                elif cell.kind == Kind.NUMBER:
                    if name in {mapping.get("x"), mapping.get("target"), mapping.get("series")}:
                        row[name] = cell.display
                    else:
                        coordinate = float(cell.number)
                        if not math.isfinite(coordinate) or (cell.number != 0 and coordinate == 0):
                            raise Invalid("A chart value is outside the finite plotting range")
                        row[name] = coordinate
                elif cell.kind == Kind.STRING:
                    row[name] = cell.display
                else:
                    raise Invalid("Chart fields must contain strings or numbers")
            rows.append(row)
    value = {"schemaVersion": 1, "id": "dataset-chart", "title": request.get("title"),
             "description": request.get("description", ""), "chart": mapping.json(), "rows": rows,
             "source": {"label": dataset.name, "caveats": ["Plot coordinates use floating-point values; the source retains exact numbers."]}}
    document = ChartDocument.admit(value).json()
    identity = view.identity(dataset)
    document["source"].update({"dataset": dataset.id, "revision": 1, "viewId": identity, "view": view.spec(),
        "records": [{"ordinal": row.ordinal, "pointer": row.pointer, "line": row.line} for row in records],
        "aggregation": aggregation, "exactValues": exact, "omittedGroups": omitted, "excludedValues": excluded})
    return document
