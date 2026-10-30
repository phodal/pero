import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "harness/go/charts/python"))
sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))
from chart_document import ChartDocument, document_for_view
from dataset import Dataset, Invalid
from view import DatasetView


def chart(mapping, rows):
    return {"schemaVersion": 1, "id": "test", "title": "Example", "chart": mapping,
            "rows": rows, "source": {"label": "Fixture", "caveats": []}}


class ChartDocuments(unittest.TestCase):
    def test_chart_families_and_invalid_inputs(self):
        simple = [{"name": "A", "value": 2}, {"name": "B", "value": 3}]
        for kind in ("line", "bar", "area", "pie", "radar"):
            with self.subTest(kind=kind):
                doc = chart({"type": kind, "x": "name", "y": "value"}, simple)
                self.assertEqual(ChartDocument.admit(doc).json()["rows"], simple)
        candles = chart({"type": "candlestick", "x": "date", "open": "o", "high": "h", "low": "l", "close": "c"},
                        [{"date": "Mon", "o": 3, "h": 5, "l": 2, "c": 4}])
        flows = chart({"type": "sankey", "x": "from", "target": "to", "y": "value"},
                      [{"from": "A", "to": "B", "value": 3}, {"from": "B", "to": "C", "value": 2}])
        for valid in (candles, flows):
            ChartDocument.admit(valid)
        bad_candle = {**candles, "rows": [{"date": "Mon", "o": 3, "h": 2, "l": 2, "c": 4}]}
        cycle = {**flows, "rows": flows["rows"] + [{"from": "C", "to": "A", "value": 1}]}
        for invalid in (
            chart({"type": "line", "x": "name", "y": "value", "series": "group"}, simple),
            chart({"type": "bar", "x": "name", "y": "value"}, [{"name": "A", "value": None}]),
            chart({"type": "bar", "x": "name", "y": "value"}, [{"name": "A", "value": 1}, {"name": "A", "value": 2}]),
            chart({"type": "pie", "x": "name", "y": "value"}, [{"name": "A", "value": -1}]),
            {**flows, "rows": flows["rows"] + [flows["rows"][0]]},
            bad_candle, cycle,
            {**flows, "source": {"label": "Claim", "dataset": "invented"}},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(Invalid):
                ChartDocument.admit(invalid)

    def test_view_chart_and_aggregation_share_selection_and_provenance(self):
        data = Dataset.parse('[{"g":"A","n":9007199254740993},{"g":"B","n":2},{"g":"A","n":3}]', 'data.json')
        view = DatasetView.admit({"filter": {"field": "g", "operator": "eq", "value": "A"}, "selection": [2]}, data)
        request = {"title": "Groups", "chart": {"type": "bar", "x": "g", "y": "n"}}
        result = document_for_view(data, view, request)
        self.assertEqual(result["rows"], [{"g": "A", "n": 3.0}])
        self.assertEqual(result["source"]["dataset"], data.id)
        self.assertEqual(result["source"]["viewId"], view.project(data)["viewId"])
        self.assertEqual(result["source"]["records"], [{"ordinal": 2, "pointer": "/2", "line": None}])
        request["chart"] = {"type": "bar", "x": "label", "y": "value"}
        result = document_for_view(data, view, request, {"category": "g", "measure": "n", "aggregation": "sum"})
        self.assertEqual(result["rows"], [{"label": "A", "value": 3.0}])
        self.assertEqual(result["source"]["exactValues"], ["3"])
        self.assertEqual(result["source"]["records"][0]["pointer"], "/2")

    def test_each_chart_family_uses_the_selected_dataset_rows(self):
        data = Dataset.parse(json.dumps([
            {"name": "A", "value": 2, "from": "A", "to": "B", "date": "2026-01-01", "o": 2, "h": 5, "l": 1, "c": 4},
            {"name": "B", "value": 3, "from": "B", "to": "C", "date": "2026-01-02", "o": 4, "h": 6, "l": 3, "c": 5},
        ]), "all.json")
        view = DatasetView.admit({"selection": [1]}, data)
        mappings = [{"type": kind, "x": "name", "y": "value"} for kind in ("line", "bar", "area", "pie", "radar")]
        mappings += [{"type": "candlestick", "x": "date", "open": "o", "high": "h", "low": "l", "close": "c"},
                     {"type": "sankey", "x": "from", "target": "to", "y": "value"}]
        for mapping in mappings:
            with self.subTest(kind=mapping["type"]):
                document = document_for_view(data, view, {"title": "Selected", "chart": mapping})
                self.assertEqual(len(document["rows"]), 1)
                self.assertEqual(document["source"]["records"][0]["pointer"], "/1")

    def test_point_line_series_preserves_null_and_order(self):
        document = chart({"type": "line", "x": "week", "y": "activeUsers", "series": "plan"}, [
            {"week": "2026-07-13", "plan": "Pro", "activeUsers": 12400},
            {"week": "2026-07-13", "plan": "Team", "activeUsers": 8200},
            {"week": "2026-07-20", "plan": "Pro", "activeUsers": 13150},
            {"week": "2026-07-20", "plan": "Team", "activeUsers": None},
            {"week": "2026-07-27", "plan": "Pro", "activeUsers": 13800},
            {"week": "2026-07-27", "plan": "Team", "activeUsers": 9040},
        ])
        admitted = ChartDocument.admit(document).json()
        self.assertEqual(admitted["rows"], document["rows"])
        self.assertIsNone(admitted["rows"][3]["activeUsers"])
        self.assertEqual(admitted["chart"]["series"], "plan")
        missing = json.loads(json.dumps(document))
        del missing["rows"][3]["activeUsers"]
        with self.assertRaises(Invalid):
            ChartDocument.admit(missing)

    def test_chart_identity_matches_non_ascii_dataset_view(self):
        data = Dataset.parse('[{"组别":"甲","数量":2}]', '中文.json')
        view = DatasetView.admit({"filter": {"field": "组别", "operator": "eq", "value": "甲"}}, data)
        result = document_for_view(data, view, {"title": "中文", "chart": {"type": "bar", "x": "组别", "y": "数量"}})
        self.assertEqual(result["source"]["viewId"], view.project(data)["viewId"])


if __name__ == '__main__':
    unittest.main()
