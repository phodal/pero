"""Typed dataset views. JSON is admitted/projected at this App boundary only."""
from dataclasses import dataclass
from hashlib import sha256
import json
from dataset import Chart, ChartSpec, Dataset, Filter, Invalid, Query, Selection, export_records


@dataclass(frozen=True)
class DatasetView:
    query: Query
    selection: Selection
    chart: ChartSpec | None
    offset: int
    limit: int
    columns: tuple[str, ...]

    @classmethod
    def admit(cls, value, dataset: Dataset):
        if not isinstance(value, dict) or set(value) - {"dataset", "filter", "sort", "selection", "chart", "offset", "limit", "columns"}:
            raise Invalid("Invalid dataset view")
        fields = {field.name for field in dataset.fields}
        filter_value, sort_value, chart_value = value.get("filter"), value.get("sort"), value.get("chart")
        filter = None
        if filter_value is not None:
            if not isinstance(filter_value, dict) or set(filter_value) != {"field", "operator", "value"} or filter_value["field"] not in fields or not isinstance(filter_value["value"], str) or len(filter_value["value"]) > 4096:
                raise Invalid("Choose a field and a valid filter value")
            filter = Filter(filter_value["field"], filter_value["operator"], filter_value["value"])
        sort = None
        descending = False
        if sort_value is not None:
            if not isinstance(sort_value, dict) or set(sort_value) != {"field", "descending"} or sort_value["field"] not in fields or not isinstance(sort_value["descending"], bool):
                raise Invalid("Choose a valid sort field and order")
            sort, descending = sort_value["field"], sort_value["descending"]
        chart = None
        if chart_value is not None:
            if not isinstance(chart_value, dict) or set(chart_value) != {"category", "measure", "aggregation"} or chart_value["category"] not in fields or chart_value["measure"] not in fields:
                raise Invalid("Choose valid chart fields")
            chart = ChartSpec(chart_value["category"], chart_value["measure"], chart_value["aggregation"])
        selected = value.get("selection", [])
        if not isinstance(selected, list) or len(selected) > 1000 or any(type(index) is not int or index < 0 or index >= len(dataset.records) for index in selected) or len(set(selected)) != len(selected):
            raise Invalid("Choose up to 1,000 distinct record identities")
        offset, limit = value.get("offset", 0), value.get("limit", 50)
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 200:
            raise Invalid("A page must contain 1–200 records")
        columns = value.get("columns", [field.name for field in dataset.fields[:8]])
        if not isinstance(columns, list) or len(columns) > 32 or any(not isinstance(name, str) or name not in fields for name in columns) or len(set(columns)) != len(columns):
            raise Invalid("Choose up to 32 displayed fields")
        return cls(Query(filter, sort, descending), Selection(tuple(selected)), chart, offset, limit, tuple(columns))

    def spec(self):
        filter = self.query.filter
        return {"filter": {"field": filter.field, "operator": filter.operator, "value": filter.value} if filter else None,
                "sort": {"field": self.query.sort, "descending": self.query.descending} if self.query.sort is not None else None,
                "selection": list(self.selection.ordinals), "columns": list(self.columns),
                "chart": {"category": self.chart.category, "measure": self.chart.measure, "aggregation": self.chart.aggregation} if self.chart else None}

    def project(self, dataset: Dataset):
        rows = self.query.apply(dataset)
        selected = self.selection.apply(rows)
        chart = Chart.calculate(selected, self.chart) if self.chart else None
        identity = sha256((dataset.id + json.dumps(self.spec(), sort_keys=True)).encode()).hexdigest()
        return {"dataset": metadata(dataset), "view": self.spec(), "viewId": identity, "matching": len(rows), "selected": len(selected), "offset": self.offset,
                "sample": record_window(selected, self.columns[:8], 0, 10),
                "rows": [{"ordinal": row.ordinal, "pointer": row.pointer, "line": row.line,
                          "cells": {name: {"kind": cell.kind.value, "display": cell.display[:240], "truncated": len(cell.display) > 240} for name, cell in row.cells if name in self.columns}}
                         for row in rows[self.offset:self.offset + self.limit]],
                "chart": {"points": [{"label": point.label, "exact": point.exact, "ratio": point.ratio, "count": point.count} for point in chart.points],
                          "omittedGroups": chart.omitted_groups, "excludedValues": chart.excluded_values} if chart else None}

    def read(self, dataset: Dataset):
        if self.limit > 20 or len(self.columns) > 8:
            raise Invalid("An Agent read contains at most 20 records and 8 fields")
        rows = self.selection.apply(self.query.apply(dataset))
        return {"dataset":dataset.id,"revision":1,**record_window(rows,self.columns,self.offset,self.limit)}

    def export(self, dataset: Dataset):
        rows = self.selection.apply(self.query.apply(dataset))
        manifest = {"schema": "pero.dataset-export.v1", "dataset": dataset.id, "name": dataset.name,
                    "sourceFormat": "json_lines" if dataset.json_lines else "json", "sourceRevision": 1,
                    "view": self.spec(), "records": len(rows),
                    "provenance": [{"ordinal": row.ordinal, "pointer": row.pointer, "line": row.line} for row in rows]}
        content = '{"manifest":' + json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + ',"rows":' + export_records(rows) + '}\n'
        identity = sha256(content.encode()).hexdigest()
        return {"id": identity, "name": dataset.name + ".export.json", "records": len(rows), "bytes": len(content.encode()), "content": content}


def metadata(dataset: Dataset):
    return {"id": dataset.id, "name": dataset.name, "revision": 1, "format": "json_lines" if dataset.json_lines else "json",
            "bytes": len(dataset.source.encode()), "rowCount": len(dataset.records),
            "fields": [{"name": field.name, "kinds": [kind.value for kind in field.kinds], "missing": field.missing, "nulls": field.nulls} for field in dataset.fields]}


def record_window(rows, columns, offset, limit):
    result, used = [], 0
    for row in rows[offset:offset + limit]:
        value = {"ordinal":row.ordinal,"pointer":row.pointer,"line":row.line,
                 "cells":{name:{"kind":cell.kind.value,"display":cell.display[:240],"truncated":len(cell.display)>240} for name,cell in row.cells if name in columns}}
        size = len(json.dumps(value,ensure_ascii=False).encode())
        if size > 24 * 1024:
            value = {"ordinal":row.ordinal,"pointer":row.pointer,"line":row.line,"cells":{},"needsSource":True}
            size = len(json.dumps(value).encode())
        if used + size > 24 * 1024:
            break
        result.append(value);used += size
    end = offset + len(result)
    return {"records":result,"total":len(rows),"offset":offset,"nextOffset":end if end < len(rows) else None}
