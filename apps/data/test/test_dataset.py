import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "harness/go/charts/python"))
sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))
from dataset import Chart, ChartSpec, Dataset, Filter, Invalid, Query, Selection, export_records


class DatasetBehavior(unittest.TestCase):
    def test_exact_source_queries_selection_and_exports(self):
        source = '[{"group":"A","n":9007199254740993,"optional":null},{"group":"B","n":1.2300e-20},{"group":"A","n":0},{"group":"A"}]'
        data = Dataset.parse(source, "values.json")
        fields = {field.name: field for field in data.fields}
        self.assertEqual((fields["optional"].missing, fields["optional"].nulls), (3, 1))
        self.assertEqual(data.source, source)
        for query, expected in [
            (Query(sort="n"), (2, 1, 0, 3)),
            (Query(sort="n", descending=True), (0, 1, 2, 3)),
            (Query(Filter("n", "gte", "9007199254740993")), (0,)),
            (Query(Filter("optional", "missing", "")), (1, 2, 3)),
            (Query(Filter("optional", "null", "")), (0,)),
            (Query(Filter("group", "contains", "a")), (0, 2, 3)),
        ]:
            with self.subTest(query=query):
                self.assertEqual(tuple(row.ordinal for row in query.apply(data)), expected)
        selected = Selection((0, 1)).apply(Query().apply(data))
        exported = export_records(selected)
        self.assertIn('9007199254740993', exported)
        self.assertIn('1.2300e-20', exported)
        self.assertEqual([row.pointer for row in selected], ["/0", "/1"])
        with self.assertRaises(Invalid):
            Selection((0, 99)).apply(data.records)

    def test_chart_uses_exact_values_and_distinguishes_missing_from_zero(self):
        data = Dataset.parse('[{"g":"A","n":9007199254740993},{"g":"A","n":1},{"g":"B","n":null},{"g":"C","n":0}]', 'chart.json')
        chart = Chart.calculate(data.records, ChartSpec("g", "n", "sum"))
        self.assertEqual([(point.label, point.exact) for point in chart.points], [("A", "9007199254740994"), ("C", "0")])
        self.assertEqual(chart.excluded_values, 1)
        count = Chart.calculate(data.records, ChartSpec("g", "n", "count"))
        self.assertEqual(sum(point.count for point in count.points), 4)
        precise = Dataset.parse('[{"g":"A","n":1234567890123456789012345678901234567890},{"g":"A","n":0.000000000000000000000001}]', 'precise.json')
        total = Chart.calculate(precise.records, ChartSpec("g", "n", "sum")).points[0]
        self.assertEqual(total.exact, '1234567890123456789012345678901234567890.000000000000000000000001')

    def test_admission_and_nested_json(self):
        data = Dataset.parse('{"x":{"a/b":[1,true,null]},"y":2}\n\n{"y":3}', "rows.jsonl", True)
        self.assertEqual([row.line for row in data.records], [1, 3])
        self.assertEqual(data.records[0].cell("x").token, '{"a/b":[1,true,null]}')
        nested = Dataset.parse('[{"x":[{"n":1}]}]', 'nested.json')
        self.assertEqual(nested.records[0].cell("x").token, '[{"n":1}]')
        separator = Dataset.parse('{"s":"a\u2028b"}\n{"s":"c"}', 'unicode.jsonl', True)
        self.assertEqual([row.line for row in separator.records], [1, 2])
        for source in ['{"a":1,"a":2}', '[NaN]', '[{"a":Infinity}]', '[1]', 'true']:
            with self.subTest(source=source), self.assertRaises(Invalid):
                Dataset.parse(source, 'invalid.json')


if __name__ == "__main__":
    unittest.main()
